package com.mss.core.player

import android.content.Context
import android.content.Intent
import android.media.audiofx.Equalizer
import android.os.Build
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
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
        },
    )

    private var queue: MutableList<UnifiedTrack> = mutableListOf()
    private var index = 0
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
                    if (player !== active) return
                    if (playbackState == Player.STATE_ENDED) onEnded()
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
    }

    fun exoPlayer(): ExoPlayer = active

    fun sessionPlayer(): Player = nowPlaying

    fun audioSessionId(): Int = active.audioSessionId

    fun setWaveSession(sessionId: String, batchId: String) {
        waveSessionId = sessionId
        waveBatchId = batchId
    }

    fun playTracks(tracks: List<UnifiedTrack>, startIndex: Int = 0, radio: Boolean = false) {
        queue = tracks.toMutableList()
        index = startIndex.coerceIn(0, (queue.size - 1).coerceAtLeast(0))
        preloadedNext = false
        if (!radio) {
            waveSessionId = null
            waveBatchId = null
        }
        _state.value = _state.value.copy(queue = queue.toList(), radio = radio, shuffle = if (radio) false else _state.value.shuffle)
        playCurrent(crossfade = false)
    }

    fun enqueue(track: UnifiedTrack) {
        queue.add(track)
        _state.value = _state.value.copy(queue = queue.toList())
    }

    fun playNext(track: UnifiedTrack) {
        val insert = (index + 1).coerceAtMost(queue.size)
        queue.add(insert, track)
        _state.value = _state.value.copy(queue = queue.toList())
    }

    fun removeAt(i: Int) {
        if (i !in queue.indices) return
        queue.removeAt(i)
        if (i < index) index--
        _state.value = _state.value.copy(queue = queue.toList(), index = index)
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
        if (usingSpotify) spotifyWeb.pause() else active.pause()
        _state.value = _state.value.copy(playing = false)
    }

    fun resume() {
        if (usingSpotify) spotifyWeb.resume() else active.play()
        _state.value = _state.value.copy(playing = true)
    }

    fun next() {
        recordPlay(false)
        if (queue.isEmpty()) return
        val mode = _state.value.repeat
        index = when {
            mode == RepeatMode.ONE -> index
            _state.value.shuffle && queue.size > 1 -> {
                var nextIdx = index
                while (nextIdx == index) nextIdx = (0 until queue.size).random()
                nextIdx
            }
            mode == RepeatMode.ALL -> (index + 1) % queue.size
            else -> if (index + 1 < queue.size) index + 1 else return
        }
        playCurrent(crossfade = false)
    }

    fun prev() {
        if (queue.isEmpty()) return
        if (_state.value.positionMs > 3000) {
            seekTo(0)
            return
        }
        skipPrevious()
    }

    private fun skipPrevious() {
        if (queue.isEmpty()) return
        index = if (index > 0) index - 1 else 0
        playCurrent(crossfade = false)
    }

    fun seekTo(ms: Long) {
        if (usingSpotify) spotifyWeb.seek(ms) else active.seekTo(ms)
        _state.value = _state.value.copy(positionMs = ms)
    }

    fun setShuffle(enabled: Boolean) {
        if (_state.value.radio) return
        _state.value = _state.value.copy(shuffle = enabled)
    }

    fun cycleRepeat() {
        if (_state.value.radio) return
        val next = when (_state.value.repeat) {
            RepeatMode.OFF -> RepeatMode.ALL
            RepeatMode.ALL -> RepeatMode.ONE
            RepeatMode.ONE -> RepeatMode.OFF
        }
        _state.value = _state.value.copy(repeat = next)
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
        active.pause()
        scope.launch { spotifyWeb.play(track.id, pos) }
    }

    fun tickProgress() {
        val pos: Long
        val dur: Long
        val playing: Boolean
        if (usingSpotify) {
            val d = spotifyWeb.dom.value
            pos = d.positionMs
            dur = d.durationMs
            playing = d.playing
            if (d.ready && dur > 0 && pos >= dur - 900 && playing) onEnded()
        } else {
            pos = active.currentPosition
            dur = active.duration.coerceAtLeast(0)
            playing = awaitingStart || active.isPlaying || (active.playWhenReady && active.playbackState == Player.STATE_BUFFERING)
        }
        playedMs = maxOf(playedMs, pos)
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

    private fun onEnded() {
        if (_state.value.sleepUntilTrackEnd) {
            recordPlay(true)
            pauseSleep()
            return
        }
        recordPlay(true)
        next()
    }

    private fun pauseSleep() {
        awaitingStart = false
        playGen += 1
        if (usingSpotify) spotifyWeb.pause() else active.pause()
        _state.value = _state.value.copy(sleepEndsAt = null, sleepUntilTrackEnd = false, playing = false)
    }

    private fun playCurrent(crossfade: Boolean) {
        val track = queue.getOrNull(index) ?: return
        val gen = ++playGen
        awaitingStart = true
        _state.value = _state.value.copy(current = track, queue = queue.toList(), index = index, playing = true)
        playedMs = 0
        preloadedNext = false
        ensurePlaybackService()
        startTicker()
        if (!track.playable) {
            failPlayback(gen)
            return
        }
        scope.launch {
            val resolved = runCatching { resolver.resolve(track) }.getOrElse {
                failPlayback(gen)
                return@launch
            }
            if (gen != playGen) return@launch
            when (resolved) {
                is ResolvedPlayback.SpotifyWeb -> {
                    usingSpotify = true
                    active.pause()
                    spotifyWeb.play(resolved.trackId)
                    awaitingStart = false
                    _state.value = _state.value.copy(playing = true)
                }
                is ResolvedPlayback.Url -> {
                    usingSpotify = false
                    val settings = preferences.loadPlaybackSettings()
                    val fade = crossfade && settings.crossfadeMs > 0 && track.source != SourceId.SPOTIFY
                    playUrl(track, resolved.url, fade, settings.crossfadeMs)
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
        if (consecutiveErrors < 5 && index + 1 < queue.size) {
            index += 1
            playCurrent(crossfade = false)
            return
        }
        awaitingStart = false
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
        val incoming = if (active === exoA) exoB else exoA
        incoming.setMediaItem(item)
        incoming.prepare()
        incoming.play()
        applyLoudness(incoming, track)
        incoming.volume = 0f
        active.volume = _state.value.volume
        scope.launch {
            val steps = 20
            val step = fadeMs / steps
            repeat(steps) { i ->
                delay(step.toLong())
                val t = (i + 1) / steps.toFloat()
                incoming.volume = t * _state.value.volume
                active.volume = (1 - t) * _state.value.volume
            }
            active.pause()
            active = incoming
            active.volume = _state.value.volume
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
        if (next.source == SourceId.SPOTIFY) return
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
                tickProgress()
                if (usingSpotify) {
                    spotifyWeb.pollState()
                    spotifyTicks += 1
                    if (spotifyTicks % 10 == 0 && deviceProbe?.isActive != true) {
                        deviceProbe = scope.launch { spotifyWeb.refreshDevices() }
                    }
                }
                delay(500)
            }
        }
    }

    private fun ensurePlaybackService() {
        val intent = Intent(context, PlaybackService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
    }

    private fun buildExo(): ExoPlayer {
        val attrs = AudioAttributes.Builder()
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .setUsage(C.USAGE_MEDIA)
            .build()
        return ExoPlayer.Builder(context).build().apply {
            setAudioAttributes(attrs, true)
            playWhenReady = true
        }
    }

    private fun applySettings(settings: PlaybackSettings) {
        exoA.setPlaybackSpeed(settings.playbackRate)
        exoB.setPlaybackSpeed(settings.playbackRate)
        attachEq(exoA, settings, eqA) { eqA = it }
        attachEq(exoB, settings, eqB) { eqB = it }
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
}
