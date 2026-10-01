package com.mss.core.player

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.audiofx.Equalizer
import android.os.Build
import android.media.AudioAttributes as PlatformAudioAttributes
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import com.mss.core.connectors.SpotifyDomState
import com.mss.core.connectors.SpotifyWebSession
import com.mss.core.connectors.YandexConnector
import com.mss.core.datastore.MssPreferences
import com.mss.core.model.PlaybackReport
import com.mss.core.model.PlaybackSettings
import com.mss.core.model.SourceId
import com.mss.core.model.UnifiedTrack
import com.mss.core.network.PlayReporter
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class PlayerUiState(
    val current: UnifiedTrack? = null,
    val queue: List<UnifiedTrack> = emptyList(),
    val index: Int = 0,
    val playing: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val shuffle: Boolean = false,
    val repeat: RepeatMode = RepeatMode.OFF,
    val radio: Boolean = false,
    val sleepEndsAt: Long? = null,
    val sleepUntilTrackEnd: Boolean = false,
    val volume: Float = 1f,
    val liked: Boolean = false,
)

enum class RepeatMode { OFF, ALL, ONE }

@OptIn(UnstableApi::class)
@Singleton
class PlayerController @Inject constructor(
    @ApplicationContext private val context: Context,
    private val resolver: PlaybackResolver,
    private val spotifyWeb: SpotifyWebSession,
    private val preferences: MssPreferences,
    private val reporter: PlayReporter,
    private val yandex: YandexConnector,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val exoA = buildExo()
    private val exoB = buildExo()
    private var active: ExoPlayer = exoA
    private var eqA: Equalizer? = null
    private var eqB: Equalizer? = null
    private val _state = MutableStateFlow(PlayerUiState())
    val state: StateFlow<PlayerUiState> = _state.asStateFlow()
    private val nowPlaying = NowPlayingPlayer(
        Looper.getMainLooper(),
        object : NowPlayingPlayer.Controls {
            override fun play() = resume()
            override fun pause() = this@PlayerController.pause()
            override fun next() = this@PlayerController.next()
            override fun previous() = skipPrevious()
            override fun seekTo(positionMs: Long) = this@PlayerController.seekTo(positionMs)
            override fun setRepeat(mode: RepeatMode) = this@PlayerController.setRepeat(mode)
            override fun setShuffle(enabled: Boolean) = this@PlayerController.setShuffle(enabled)
        },
    )

    private var queue: MutableList<UnifiedTrack> = mutableListOf()
    private var index = 0
    /** Очередь до перемешивания: по ней восстанавливаем порядок, когда перемешивание выключают. */
    private var sourceOrder: List<UnifiedTrack> = emptyList()
    private var playedMs = 0L
    private var tickJob: Job? = null
    private var deviceProbe: Job? = null
    private var spotifyTicks = 0
    private var usingSpotify = false
    private var waveSessionId: String? = null
    private var waveBatchId: String? = null
    private var loadingWave = false
    private var preloadedNext = false
    private var playGen = 0
    private var consecutiveErrors = 0
    private var awaitingStart = false
    /** После команды веб-плеер отвечает не сразу: до этого момента верим своему состоянию, а не старому DOM. */
    private var commandHoldUntil = 0L
    private var endedGen = -1
    private var seekTarget: Long? = null
    /** Веб-плеер может не отработать перемотку: дольше этого срока цель не ждём. */
    private var seekDeadline = 0L
    /** Пока новый трек резолвится, прошлый Exo ещё доигрывает — его STATE_ENDED относится к старому треку. */
    private var exoStarting = false
    private var fadeJob: Job? = null
    /** Пока веб-плеер переключается на новый трек, в DOM ещё старый — его позицию и конец не учитываем. */
    private var spotifyStarting = false
    /** Веб-плеер уже показывал наш трек: смена заголовка после этого — автоплей Spotify, а не запоздалый DOM. */
    private var sawOwnSpotifyTitle = false
    private var lastSpotifyPos = 0L
    private var foreignTitleTicks = 0
    private var lastTickPos = 0L
    private var playbackServiceRunning = false
    private var lastSettings: PlaybackSettings? = null
    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var focusRequest: AudioFocusRequest? = null
    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            if (usingSpotify && _state.value.playing) pause()
        }
    }

    init {
        listOf(exoA, exoB).forEach { player ->
            player.addListener(object : Player.Listener {
                override fun onIsPlayingChanged(isPlaying: Boolean) {
                    if (player !== active || usingSpotify) return
                    if (isPlaying) {
                        consecutiveErrors = 0
                        awaitingStart = false
                        _state.value = _state.value.copy(playing = true)
                    } else if (!awaitingStart && (!player.playWhenReady || player.playbackState == Player.STATE_IDLE || player.playbackState == Player.STATE_ENDED)) {
                        _state.value = _state.value.copy(playing = false)
                    }
                }

                override fun onPlaybackStateChanged(playbackState: Int) {
                    if (player !== active || usingSpotify || exoStarting) return
                    if (playbackState != Player.STATE_ENDED || endedGen == playGen) return
                    endedGen = playGen
                    onEnded()
                }

                override fun onAudioSessionIdChanged(audioSessionId: Int) {
                    reattachEq(player)
                }

                override fun onPlayerError(error: PlaybackException) {
                    if (player !== active || usingSpotify) return
                    failPlayback(playGen)
                }
            })
        }
        scope.launch {
            preferences.playbackSettings.collect { applySettings(it) }
        }
        scope.launch {
            state.collect { nowPlaying.publish(it) }
        }
        scope.launch {
            spotifyWeb.dom.collect { if (usingSpotify && tickJob?.isActive == true) safeTick() }
        }
    }

    private fun holdCommand() {
        commandHoldUntil = android.os.SystemClock.elapsedRealtime() + COMMAND_HOLD_MS
    }

    /** До подтверждения перемотки веб-плеером верим своей позиции, но не дольше SEEK_WAIT_MS. */
    private fun awaitSeek(ms: Long) {
        seekTarget = ms
        seekDeadline = android.os.SystemClock.elapsedRealtime() + SEEK_WAIT_MS
    }

    fun exoPlayer(): ExoPlayer = active

    fun sessionPlayer(): Player = nowPlaying

    fun audioSessionId(): Int = active.audioSessionId

    private fun session(level: String, category: String, message: String) {
        onSession?.invoke(level, category, message)
    }

    @Volatile
    var onToggleLike: (() -> Unit)? = null

    @Volatile
    var onError: ((String) -> Unit)? = null

    @Volatile
    var onSession: ((level: String, category: String, message: String) -> Unit)? = null

    fun setLiked(liked: Boolean) {
        if (_state.value.liked == liked) return
        _state.value = _state.value.copy(liked = liked)
    }

    fun toggleLike() {
        scope.launch { onToggleLike?.invoke() }
    }

    fun setWaveSession(sessionId: String, batchId: String) {
        waveSessionId = sessionId
        waveBatchId = batchId
    }

    fun playTracks(tracks: List<UnifiedTrack>, startIndex: Int = 0, radio: Boolean = false) {
        // Выбор трека из текущей очереди — это переход внутри неё, а не повод перемешать заново.
        val sameQueue = tracks.size == queue.size && tracks.indices.all { trackKey(tracks[it]) == trackKey(queue[it]) }
        queue = tracks.toMutableList()
        index = startIndex.coerceIn(0, (queue.size - 1).coerceAtLeast(0))
        preloadedNext = false
        if (!sameQueue) sourceOrder = emptyList()
        if (!radio) {
            waveSessionId = null
            waveBatchId = null
        }
        val shuffle = !radio && _state.value.shuffle
        // У волны нет конца списка, поэтому повтор всего списка туда не переносим.
        val repeat = if (radio && _state.value.repeat == RepeatMode.ALL) RepeatMode.OFF else _state.value.repeat
        _state.value = _state.value.copy(queue = queue.toList(), radio = radio, shuffle = shuffle, repeat = repeat)
        if (shuffle && !sameQueue) reorderQueue(shuffled = true)
        session("info", "player", "queue ${queue.size} from=${index} radio=$radio")
        playCurrent(crossfade = false)
    }

    private fun trackKey(track: UnifiedTrack) = "${track.source}:${track.id}"

    /**
     * Перемешивание меняет саму очередь, а не выбор следующего трека: список «Далее» и кнопка «назад»
     * показывают тот же порядок, в котором треки прозвучат. Текущий трек остаётся на месте.
     */
    private fun reorderQueue(shuffled: Boolean) {
        val current = queue.getOrNull(index)
        if (shuffled) {
            sourceOrder = queue.toList()
            val rest = queue.filterIndexed { i, _ -> i != index }.shuffled()
            queue = (listOfNotNull(current) + rest).toMutableList()
        } else {
            if (sourceOrder.isEmpty()) return
            val remaining = queue.toMutableList()
            val restored = mutableListOf<UnifiedTrack>()
            for (track in sourceOrder) {
                val at = remaining.indexOfFirst { trackKey(it) == trackKey(track) }
                if (at >= 0) restored += remaining.removeAt(at)
            }
            // Добавленные уже после включения перемешивания остаются в конце.
            restored += remaining
            queue = restored
            sourceOrder = emptyList()
        }
        index = current?.let { c -> queue.indexOfFirst { trackKey(it) == trackKey(c) } }?.takeIf { it >= 0 } ?: 0
        _state.value = _state.value.copy(queue = queue.toList(), index = index)
    }

    fun enqueue(track: UnifiedTrack) = enqueue(listOf(track))

    fun enqueue(tracks: List<UnifiedTrack>) {
        if (tracks.isEmpty()) return
        queue.addAll(tracks)
        _state.value = _state.value.copy(queue = queue.toList())
    }

    fun playNext(track: UnifiedTrack) = playNext(listOf(track))

    fun playNext(tracks: List<UnifiedTrack>) {
        if (tracks.isEmpty()) return
        val insert = (index + 1).coerceAtMost(queue.size)
        queue.addAll(insert, tracks)
        _state.value = _state.value.copy(queue = queue.toList())
    }

    fun removeAt(i: Int) {
        if (i !in queue.indices) return
        val wasCurrent = i == index
        queue.removeAt(i)
        if (i < index) index--
        if (queue.isEmpty()) {
            index = 0
            playGen += 1
            awaitingStart = false
            if (usingSpotify) spotifyWeb.pause() else active.pause()
            dropSpotifyFocus()
            _state.value = _state.value.copy(queue = emptyList(), index = 0, current = null, playing = false)
            return
        }
        index = index.coerceIn(0, queue.lastIndex)
        _state.value = _state.value.copy(queue = queue.toList(), index = index)
        // Удалили играющий трек — дальше должен пойти тот, что встал на его место.
        if (wasCurrent) playCurrent(crossfade = false)
    }

    fun move(from: Int, to: Int) {
        if (from !in queue.indices || to !in queue.indices) return
        val item = queue.removeAt(from)
        queue.add(to, item)
        index = when {
            index == from -> to
            from < index && to >= index -> index - 1
            from > index && to <= index -> index + 1
            else -> index
        }
        _state.value = _state.value.copy(queue = queue.toList(), index = index)
    }

    fun toggle() {
        if (_state.value.playing) pause() else resume()
    }

    fun pause() {
        awaitingStart = false
        playGen += 1
        spotifyStarting = false
        if (usingSpotify) {
            holdCommand()
            spotifyWeb.pause()
        } else {
            active.pause()
        }
        _state.value = _state.value.copy(playing = false)
        session("info", "player", "pause")
    }

    fun resume() {
        if (usingSpotify) {
            holdCommand()
            awaitingStart = true
            spotifyWeb.wake()
            spotifyWeb.resume()
        } else {
            active.play()
        }
        _state.value = _state.value.copy(playing = true)
        session("info", "player", "resume")
    }

    fun next() {
        // Пропуск засчитываем только если очередь действительно сдвинулась.
        if (!canAdvance(auto = false)) return
        session("info", "player", "next")
        recordPlay(false)
        advance(auto = false)
    }

    private fun canAdvance(auto: Boolean): Boolean {
        if (queue.isEmpty()) return false
        val mode = _state.value.repeat
        if (auto && mode == RepeatMode.ONE) return true
        return mode != RepeatMode.OFF || index + 1 < queue.size
    }

    /** Повтор трека действует только на естественный конец трека; кнопка «вперёд» всегда переключает. */
    private fun advance(auto: Boolean, crossfade: Boolean = false) {
        if (queue.isEmpty()) return
        val mode = _state.value.repeat
        val nextIdx = when {
            auto && mode == RepeatMode.ONE -> index
            mode != RepeatMode.OFF -> (index + 1) % queue.size
            else -> if (index + 1 < queue.size) index + 1 else return
        }
        if (nextIdx == index) {
            restartCurrent()
            return
        }
        index = nextIdx
        playCurrent(crossfade = crossfade)
    }

    /**
     * Повтор трека перематывает в начало: заново запрашивать ссылку не нужно, а веб-плеер Spotify
     * вдобавок игнорирует запуск уже открытого трека. Если источник уже ушёл дальше, открываем трек заново.
     */
    private fun restartCurrent() {
        val track = queue.getOrNull(index) ?: return
        if (!usingSpotify) {
            if (active.currentMediaItem == null || active.playbackState == Player.STATE_IDLE) {
                playCurrent(crossfade = false)
                return
            }
            playGen += 1
            playedMs = 0
            lastTickPos = 0
            preloadedNext = false
            awaitingStart = true
            active.seekTo(0)
            active.play()
            _state.value = _state.value.copy(positionMs = 0, playing = true)
            notifyWaveStarted(track)
            return
        }
        val d = spotifyWeb.dom.value
        if (track.source != SourceId.SPOTIFY || !d.ready || !spotifyTitleMatches(d.title, track.title)) {
            playCurrent(crossfade = false)
            return
        }
        playGen += 1
        playedMs = 0
        lastTickPos = 0
        preloadedNext = false
        lastSpotifyPos = 0
        foreignTitleTicks = 0
        awaitingStart = false
        holdCommand()
        awaitSeek(0)
        spotifyWeb.seek(0)
        spotifyWeb.resume()
        _state.value = _state.value.copy(positionMs = 0, playing = true)
    }

    fun prev() {
        if (queue.isEmpty()) return
        if (_state.value.positionMs > 3000) {
            seekTo(0)
            return
        }
        skipPrevious()
    }

    fun skipPrevious() {
        if (queue.isEmpty()) return
        index = if (index > 0) index - 1 else 0
        playCurrent(crossfade = false)
    }

    fun seekTo(ms: Long) {
        lastTickPos = ms
        if (usingSpotify) {
            holdCommand()
            awaitSeek(ms)
            spotifyWeb.seek(ms)
        } else {
            active.seekTo(ms)
        }
        _state.value = _state.value.copy(positionMs = ms)
    }

    fun setShuffle(enabled: Boolean) {
        // В волне следующий трек подбирает Яндекс, перемешивать нечего.
        if (_state.value.radio || _state.value.shuffle == enabled) return
        _state.value = _state.value.copy(shuffle = enabled)
        reorderQueue(shuffled = enabled)
    }

    fun cycleRepeat() {
        val current = _state.value.repeat
        val next = if (_state.value.radio) {
            // У волны нет списка целиком, поэтому доступен только повтор трека.
            if (current == RepeatMode.ONE) RepeatMode.OFF else RepeatMode.ONE
        } else {
            when (current) {
                RepeatMode.OFF -> RepeatMode.ALL
                RepeatMode.ALL -> RepeatMode.ONE
                RepeatMode.ONE -> RepeatMode.OFF
            }
        }
        _state.value = _state.value.copy(repeat = next)
    }

    fun setRepeat(mode: RepeatMode) {
        if (_state.value.radio && mode == RepeatMode.ALL) return
        _state.value = _state.value.copy(repeat = mode)
    }

    fun setSleepTimer(minutes: Int?) {
        _state.value = _state.value.copy(
            sleepEndsAt = minutes?.let { System.currentTimeMillis() + it * 60_000L },
            sleepUntilTrackEnd = false,
        )
    }

    fun setSleepUntilEnd() {
        _state.value = _state.value.copy(sleepUntilTrackEnd = true, sleepEndsAt = null)
    }

    fun setVolume(volume: Float) {
        val v = volume.coerceIn(0f, 1f)
        exoA.volume = v
        exoB.volume = v
        spotifyWeb.setVolume(v)
        _state.value = _state.value.copy(volume = v)
    }

    /** После выбора «это приложение» в списке устройств Spotify запускает текущий трек здесь. */
    fun replaySpotifyHere() {
        val track = _state.value.current ?: return
        if (track.source != SourceId.SPOTIFY) return
        val pos = _state.value.positionMs
        usingSpotify = true
        silenceExo()
        scope.launch { spotifyWeb.play(track.id, pos, fast = preferences.loadPlaybackSettings().spotifyFastStart) }
    }

    fun tickProgress() {
        val pos: Long
        val dur: Long
        val playing: Boolean
        if (usingSpotify) {
            val d = spotifyWeb.dom.value
            val fallbackDur = _state.value.current?.durationMs ?: 0L
            val holding = android.os.SystemClock.elapsedRealtime() < commandHoldUntil
            val wanted = _state.value.playing
            val target = seekTarget
            val seekLanded = target != null && kotlin.math.abs(d.positionMs - target) < 2_000
            if (target != null && (seekLanded || android.os.SystemClock.elapsedRealtime() >= seekDeadline)) seekTarget = null
            val ours = domIsOurTrack(d)
            if (ours) sawOwnSpotifyTitle = true
            // Сразу после команды в панели ещё прошлый трек: его позицию не берём, но и не ждём вечно.
            val trustDom = ours || sawOwnSpotifyTitle || !holding
            dur = (if (trustDom) d.durationMs.takeIf { it > 0 } else null) ?: fallbackDur
            if (spotifyStarting || !trustDom) {
                pos = _state.value.positionMs
                playing = true
            } else if (awaitingStart && !d.playing) {
                pos = d.positionMs.takeIf { it > 0 } ?: _state.value.positionMs
                playing = true
            } else if (holding && d.playing != wanted) {
                pos = _state.value.positionMs
                playing = wanted
            } else {
                if (d.playing && ours) awaitingStart = false
                pos = if (seekTarget != null) _state.value.positionMs else d.positionMs
                playing = d.playing
            }
            if (!spotifyStarting && ours && d.ready && dur > 0 && pos >= dur - 1_500 && playing && endedGen != playGen) {
                endedGen = playGen
                onEnded()
                return
            }
            if (spotifyLeftTrack(d, dur, holding)) {
                endedGen = playGen
                onEnded()
                return
            }
        } else {
            pos = active.currentPosition
            dur = active.duration.coerceAtLeast(0)
            playing = awaitingStart || active.isPlaying || (active.playWhenReady && active.playbackState == Player.STATE_BUFFERING)
        }
        // Считаем прослушанное, а не максимум позиции: перемотка назад иначе завышала бы отчёт.
        val step = pos - lastTickPos
        if (step in 1..5_000 && playing) playedMs += step
        lastTickPos = pos
        _state.value = _state.value.copy(positionMs = pos, durationMs = dur, playing = playing)
        val ends = _state.value.sleepEndsAt
        if (ends != null && System.currentTimeMillis() >= ends) {
            pauseSleep()
        }
        if (dur > 0 && dur - pos <= 30_000 && !preloadedNext) {
            preloadedNext = true
            preloadNext()
        }
        maybeLoadWave()
    }

    /**
     * Трек в Spotify — отдельный контекст, и после него Spotify сам включает автоплей.
     * Секундные часы панели могут проскочить окно конца трека — тогда ловим смену трека в самом веб-плеере.
     */
    private fun spotifyLeftTrack(d: SpotifyDomState, dur: Long, holding: Boolean): Boolean {
        val stable = !spotifyStarting && !awaitingStart && !holding && seekTarget == null &&
            d.ready && d.playing && !d.ad && endedGen != playGen
        // Пока состояние не устоялось, позиция в DOM относится к прошлому треку: запоминать её нельзя.
        if (!stable) return false
        val lastPos = lastSpotifyPos
        lastSpotifyPos = d.positionMs
        if (domIsOurTrack(d)) {
            sawOwnSpotifyTitle = true
            foreignTitleTicks = 0
            return false
        }
        val wrapped = sawOwnSpotifyTitle && dur > 0 && lastPos >= dur - 15_000 && d.positionMs < 5_000
        if (wrapped) return true
        // Автоплей начинает новый трек с нуля; чужое название посреди трека — не переключение.
        if (!sawOwnSpotifyTitle || d.title.isBlank() || d.positionMs >= AUTOPLAY_START_MS) {
            foreignTitleTicks = 0
            return false
        }
        foreignTitleTicks += 1
        return foreignTitleTicks >= 2
    }

    /** Пустое название — «неизвестно», а не совпадение: иначе пустой DOM считался бы нашим треком. */
    private fun spotifyTitleMatches(dom: String, title: String): Boolean {
        fun norm(s: String) = s.lowercase().filter { it.isLetterOrDigit() }
        val a = norm(dom)
        val b = norm(title)
        if (a.isEmpty() || b.isEmpty()) return false
        return a == b || a.contains(b) || b.contains(a)
    }

    private fun domIsOurTrack(d: SpotifyDomState): Boolean {
        val title = _state.value.current?.title ?: return false
        return spotifyTitleMatches(d.title, title)
    }

    private fun onEnded() {
        if (_state.value.sleepUntilTrackEnd) {
            recordPlay(true)
            pauseSleep()
            return
        }
        recordPlay(true)
        advance(auto = true, crossfade = true)
    }

    private fun pauseSleep() {
        awaitingStart = false
        playGen += 1
        spotifyStarting = false
        if (usingSpotify) {
            holdCommand()
            spotifyWeb.pause()
        } else {
            active.pause()
        }
        _state.value = _state.value.copy(sleepEndsAt = null, sleepUntilTrackEnd = false, playing = false)
    }

    private fun playCurrent(crossfade: Boolean) {
        val track = queue.getOrNull(index) ?: return
        val gen = ++playGen
        awaitingStart = true
        _state.value = _state.value.copy(current = track, queue = queue.toList(), index = index, playing = true)
        session("info", "player", "play ${track.source} ${track.id} «${track.title}»")
        playedMs = 0
        lastTickPos = 0
        preloadedNext = false
        sawOwnSpotifyTitle = false
        lastSpotifyPos = 0
        foreignTitleTicks = 0
        // Пока трек резолвится, прошлый источник ещё доигрывает: его конец не должен засчитаться как наш.
        spotifyStarting = usingSpotify
        exoStarting = !usingSpotify
        if (usingSpotify) _state.value = _state.value.copy(positionMs = 0)
        ensurePlaybackService()
        startTicker()
        if (!track.playable) {
            spotifyStarting = false
            exoStarting = false
            failPlayback(gen)
            return
        }
        scope.launch {
            val resolved = runCatching { resolver.resolve(track) }.getOrElse {
                if (gen == playGen) {
                    spotifyStarting = false
                    exoStarting = false
                }
                failPlayback(gen)
                return@launch
            }
            if (gen != playGen) return@launch
            if (resolved !is ResolvedPlayback.SpotifyWeb) spotifyStarting = false
            when (resolved) {
                is ResolvedPlayback.SpotifyWeb -> {
                    usingSpotify = true
                    exoStarting = false
                    silenceExo()
                    spotifyWeb.wake()
                    spotifyStarting = true
                    _state.value = _state.value.copy(positionMs = 0)
                    val fast = preferences.loadPlaybackSettings().spotifyFastStart
                    val result = runCatching { spotifyWeb.play(resolved.trackId, fast = fast) }
                    if (gen == playGen) {
                        // Панель веб-плеера обновляется с задержкой: ещё немного верим своему состоянию.
                        holdCommand()
                        spotifyStarting = false
                    }
                    result
                        .onSuccess {
                            if (gen != playGen) return@launch
                            holdSpotifyFocus()
                            val d = spotifyWeb.dom.value
                            val ours = domIsOurTrack(d)
                            if (d.playing && ours) awaitingStart = false
                            _state.value = _state.value.copy(
                                playing = true,
                                durationMs = (if (ours) d.durationMs.takeIf { it > 0 } else null) ?: track.durationMs ?: 0,
                                positionMs = if (ours) d.positionMs else 0,
                            )
                        }
                        .onFailure { err ->
                            if (gen != playGen) return@launch
                            awaitingStart = false
                            usingSpotify = false
                            restoreExoFocus()
                            _state.value = _state.value.copy(playing = false)
                            session("error", "player", err.message ?: "Spotify play failed")
                            err.message?.let { onError?.invoke(it) }
                        }
                }
                is ResolvedPlayback.Url -> {
                    usingSpotify = false
                    restoreExoFocus()
                    val settings = preferences.loadPlaybackSettings()
                    val fade = crossfade && settings.crossfadeMs > 0
                    playUrl(track, resolved.url, fade, settings.crossfadeMs)
                    exoStarting = false
                    awaitingStart = false
                    notifyWaveStarted(track)
                }
            }
        }
        preloadNext()
        maybeLoadWave()
    }

    /** Битый файл волны не должен оставлять плеер на паузе: берём следующий трек. */
    private fun failPlayback(gen: Int) {
        if (gen != playGen) return
        consecutiveErrors += 1
        val track = queue.getOrNull(index)
        session("warn", "player", "fail ${track?.source} ${track?.id} «${track?.title}» n=$consecutiveErrors")
        // Повтор трека здесь не используем: битый трек иначе крутился бы бесконечно.
        if (consecutiveErrors < 5 && queue.size > 1 && canAdvance(auto = false)) {
            advance(auto = false)
            return
        }
        awaitingStart = false
        if (usingSpotify) dropSpotifyFocus()
        active.pause()
        _state.value = _state.value.copy(playing = false)
    }

    private fun notifyWaveStarted(track: UnifiedTrack) {
        if (!_state.value.radio || track.source != SourceId.YANDEX) return
        val sid = waveSessionId ?: return
        val bid = waveBatchId ?: return
        scope.launch { runCatching { yandex.waveFeedback(sid, bid, "trackStarted", track) } }
    }

    private fun playUrl(track: UnifiedTrack, url: String, fade: Boolean, fadeMs: Int) {
        val item = MediaItem.Builder()
            .setUri(url)
            .setMediaId("${track.source}:${track.id}")
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(track.title)
                    .setArtist(track.artist)
                    .setAlbumTitle(track.album)
                    .setArtworkUri(track.coverUrl?.let { android.net.Uri.parse(it) })
                    .build(),
            )
            .build()
        if (!fade) {
            active.setMediaItem(item)
            active.prepare()
            active.play()
            applyLoudness(active, track)
            _state.value = _state.value.copy(current = track, playing = true)
            return
        }
        val outgoing = active
        val incoming = if (active === exoA) exoB else exoA
        incoming.setMediaItem(item)
        incoming.prepare()
        incoming.play()
        applyLoudness(incoming, track)
        incoming.volume = 0f
        outgoing.volume = _state.value.volume
        // Активным считаем новый плеер сразу: конец уходящего трека больше не наш.
        active = incoming
        val gen = playGen
        fadeJob?.cancel()
        fadeJob = scope.launch {
            val steps = 20
            val step = (fadeMs / steps).toLong()
            repeat(steps) { i ->
                delay(step)
                if (gen != playGen) {
                    outgoing.pause()
                    return@launch
                }
                val t = (i + 1) / steps.toFloat()
                incoming.volume = t * _state.value.volume
                outgoing.volume = (1 - t) * _state.value.volume
            }
            outgoing.pause()
            incoming.volume = _state.value.volume
        }
        _state.value = _state.value.copy(current = track, playing = true)
    }

    private fun applyLoudness(player: ExoPlayer, track: UnifiedTrack) {
        scope.launch {
            val settings = preferences.loadPlaybackSettings()
            if (!settings.normalize) {
                player.volume = _state.value.volume
                return@launch
            }
            val lufs = track.loudnessLufs ?: return@launch
            val gain = ((-14.0 - lufs) / 20.0).let { Math.pow(10.0, it).toFloat() }.coerceIn(0.25f, 2.5f)
            player.volume = (_state.value.volume * gain).coerceAtMost(1f)
        }
    }

    private fun preloadNext() {
        val nextIdx = index + 1
        val next = queue.getOrNull(nextIdx) ?: return
        if (next.source == SourceId.SPOTIFY && !resolver.hasDownloadedFile(next)) return
        scope.launch {
            delay(1_000)
            runCatching { resolver.resolve(next) }
        }
    }

    private fun maybeLoadWave() {
        if (!_state.value.radio || loadingWave) return
        val sid = waveSessionId ?: return
        if (queue.size - index > 2) return
        loadingWave = true
        scope.launch {
            runCatching {
                val more = yandex.waveMore(sid, queue.map { it.id }.takeLast(5))
                waveBatchId = more.batchId
                if (more.tracks.isNotEmpty()) {
                    queue.addAll(more.tracks)
                    _state.value = _state.value.copy(queue = queue.toList())
                }
            }
            loadingWave = false
        }
    }

    private fun recordPlay(finished: Boolean) {
        val track = _state.value.current ?: return
        val seconds = playedMs / 1000.0
        reporter.record(track, seconds, finished)
        if (track.source == SourceId.YANDEX) {
            scope.launch {
                runCatching {
                    yandex.reportPlay(
                        PlaybackReport(
                            trackId = track.id,
                            albumId = track.albumId,
                            trackLengthSeconds = (track.durationMs ?: 0) / 1000.0,
                            totalPlayedSeconds = seconds,
                            endPositionSeconds = seconds,
                        ),
                    )
                    val sid = waveSessionId
                    val bid = waveBatchId
                    if (_state.value.radio && sid != null && bid != null) {
                        yandex.waveFeedback(sid, bid, if (finished) "trackFinished" else "skip", track, seconds)
                    }
                }
            }
        }
    }

    private fun startTicker() {
        tickJob?.cancel()
        tickJob = scope.launch {
            while (true) {
                safeTick()
                if (usingSpotify) {
                    spotifyWeb.pollState()
                    spotifyTicks += 1
                    if (spotifyTicks % 20 == 0 && deviceProbe?.isActive != true && !awaitingStart && !_state.value.playing) {
                        deviceProbe = scope.launch { spotifyWeb.refreshDevices() }
                    }
                }
                delay(500)
            }
        }
    }

    fun notifyPlaybackServiceStarted() {
        playbackServiceRunning = true
    }

    fun notifyPlaybackServiceStopped() {
        playbackServiceRunning = false
    }

    /**
     * Повторный startForegroundService из фона (автопереход на следующий трек) на Android 12+
     * кидает ForegroundServiceStartNotAllowedException, даже если сервис уже играет.
     */
    private fun ensurePlaybackService() {
        if (playbackServiceRunning) return
        val intent = Intent(context, PlaybackService::class.java)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        } catch (e: IllegalStateException) {
            if (isBackgroundStartBlocked(e)) {
                session("warn", "player", "сервис воспроизведения не стартовал из фона")
                return
            }
            throw e
        }
    }

    private fun isBackgroundStartBlocked(error: IllegalStateException): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false
        return isForegroundStartNotAllowed(error)
    }

    @SuppressLint("NewApi")
    private fun isForegroundStartNotAllowed(error: IllegalStateException): Boolean =
        error is android.app.ForegroundServiceStartNotAllowedException

    /** Сбой тика не должен ронять процесс: автопереход идёт из коллектора на главном потоке. */
    private fun safeTick() {
        try {
            tickProgress()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            session("error", "player", e.message ?: e.javaClass.simpleName)
        }
    }

    private fun buildExo(): ExoPlayer {
        return ExoPlayer.Builder(context).build().apply {
            setAudioAttributes(musicAttrs(), true)
            playWhenReady = true
        }
    }

    private fun musicAttrs() = AudioAttributes.Builder()
        .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
        .setUsage(C.USAGE_MEDIA)
        .build()

    private fun silenceExo() {
        val attrs = musicAttrs()
        listOf(exoA, exoB).forEach { player ->
            player.playWhenReady = false
            player.pause()
            player.stop()
            player.clearMediaItems()
            player.setAudioAttributes(attrs, false)
        }
    }

    private fun restoreExoFocus() {
        dropSpotifyFocus()
        val attrs = musicAttrs()
        exoA.setAudioAttributes(attrs, true)
        exoB.setAudioAttributes(attrs, true)
    }

    /** Веб-плеер Spotify сам фокус не берёт — без этого другие приложения не затихают. */
    private fun holdSpotifyFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val req = focusRequest ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(
                    PlatformAudioAttributes.Builder()
                        .setUsage(PlatformAudioAttributes.USAGE_MEDIA)
                        .setContentType(PlatformAudioAttributes.CONTENT_TYPE_MUSIC)
                        .build(),
                )
                .setOnAudioFocusChangeListener(focusListener)
                .build()
                .also { focusRequest = it }
            audioManager.requestAudioFocus(req)
        } else {
            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
        }
    }

    private fun dropSpotifyFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
        } else {
            @Suppress("DEPRECATION")
            audioManager.abandonAudioFocus(focusListener)
        }
    }

    private fun applySettings(settings: PlaybackSettings) {
        lastSettings = settings
        exoA.setPlaybackSpeed(settings.playbackRate)
        exoB.setPlaybackSpeed(settings.playbackRate)
        attachEq(exoA, settings, eqA) { eqA = it }
        attachEq(exoB, settings, eqB) { eqB = it }
    }

    /** Аудиосессия меняется вместе с источником, а эквалайзер привязан именно к ней. */
    private fun reattachEq(player: ExoPlayer) {
        val settings = lastSettings ?: return
        if (player === exoA) attachEq(exoA, settings, eqA) { eqA = it } else attachEq(exoB, settings, eqB) { eqB = it }
    }

    private fun attachEq(player: ExoPlayer, settings: PlaybackSettings, current: Equalizer?, set: (Equalizer?) -> Unit) {
        runCatching {
            current?.release()
            val eq = Equalizer(0, player.audioSessionId)
            eq.enabled = settings.eqEnabled
            if (settings.eqEnabled) {
                val bands = minOf(eq.numberOfBands.toInt(), settings.eqBands.size)
                for (i in 0 until bands) {
                    val range = eq.bandLevelRange
                    val milliDb = (settings.eqBands[i] * 100).toInt().coerceIn(range[0].toInt(), range[1].toInt())
                    eq.setBandLevel(i.toShort(), milliDb.toShort())
                }
            }
            set(eq)
        }
    }

    private companion object {
        const val COMMAND_HOLD_MS = 1_500L
        const val SEEK_WAIT_MS = 10_000L
        const val AUTOPLAY_START_MS = 10_000L
    }
}
