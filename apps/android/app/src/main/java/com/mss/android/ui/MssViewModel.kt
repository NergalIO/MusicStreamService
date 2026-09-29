package com.mss.android.ui

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mss.android.data.MssRepository
import com.mss.android.ui.navigation.parseMssLink
import com.mss.core.connectors.AuthStatus
import com.mss.core.connectors.SpotifyConnector
import com.mss.core.connectors.SpotifyWebSession
import com.mss.core.connectors.VkAuth
import com.mss.core.connectors.VkAuthException
import com.mss.core.connectors.VkConnector
import com.mss.core.connectors.YandexConnector
import com.mss.core.downloads.DownloadScheduler
import com.mss.core.lobby.LobbyClient
import com.mss.core.model.CatalogArtistDto
import com.mss.core.model.DeviceCodePrompt
import com.mss.core.model.FeedBlock
import com.mss.core.model.HomeShelves
import com.mss.core.model.ListeningStats
import com.mss.core.model.PlaybackSettings
import com.mss.core.model.PlaylistWithTracks
import com.mss.core.model.SourceId
import com.mss.core.model.TrackLyrics
import com.mss.core.model.UnifiedAlbum
import com.mss.core.model.UnifiedArtist
import com.mss.core.model.UnifiedPlaylist
import com.mss.core.localtracks.LocalTrackStore
import com.mss.core.model.UnifiedTrack
import com.mss.core.model.UserSubscriptionDto
import com.mss.core.model.WaveSettings
import com.mss.core.model.sourceFrom
import com.mss.core.network.PresenceClient
import com.mss.core.offline.OfflineStore
import com.mss.core.player.PlayerController
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

@HiltViewModel
class MssViewModel @Inject constructor(
    private val repo: MssRepository,
    val player: PlayerController,
    private val spotify: SpotifyConnector,
    private val yandex: YandexConnector,
    private val vk: VkConnector,
    val spotifyWeb: SpotifyWebSession,
    private val downloads: DownloadScheduler,
    private val lobby: LobbyClient,
    private val offline: OfflineStore,
    private val localTracks: LocalTrackStore,
    private val presence: PresenceClient,
) : ViewModel() {
    val session = repo.session.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val playerState = player.state.stateIn(viewModelScope, SharingStarted.Eagerly, player.state.value)
    val lobbyState = lobby.lobby.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val canSuggestToLobby: StateFlow<Boolean> = combine(lobby.lobby, session) { room, sess ->
        val uid = sess?.user?.id
        room != null && uid != null && room.hostUserId != uid
    }.stateIn(viewModelScope, SharingStarted.Eagerly, false)
    val downloadRecords = downloads.records
    val playbackSettings = repo.playbackSettings.stateIn(viewModelScope, SharingStarted.Eagerly, PlaybackSettings())
    val apiBase = repo.apiBase.stateIn(viewModelScope, SharingStarted.Eagerly, "")
    val searchHistory = repo.searchHistory.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val onboarded = repo.onboarded.stateIn(viewModelScope, SharingStarted.Eagerly, false)
    val needFile = presence.needFile

    private val _tracks = MutableStateFlow<List<UnifiedTrack>>(emptyList())
    val tracks: StateFlow<List<UnifiedTrack>> = _tracks
    private val _playlists = MutableStateFlow<List<UnifiedPlaylist>>(emptyList())
    val playlists: StateFlow<List<UnifiedPlaylist>> = _playlists
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error
    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice
    private val _authVerify = MutableStateFlow(false)
    val authVerify: StateFlow<Boolean> = _authVerify
    private val _authInfo = MutableStateFlow<String?>(null)
    val authInfo: StateFlow<String?> = _authInfo
    private val _stats = MutableStateFlow<ListeningStats?>(null)
    val stats: StateFlow<ListeningStats?> = _stats
    private val _subscription = MutableStateFlow<UserSubscriptionDto?>(null)
    val subscription: StateFlow<UserSubscriptionDto?> = _subscription
    private val _shelves = MutableStateFlow<HomeShelves?>(null)
    val shelves: StateFlow<HomeShelves?> = _shelves
    private val _feed = MutableStateFlow<List<FeedBlock>>(emptyList())
    val feed: StateFlow<List<FeedBlock>> = _feed
    private val _artists = MutableStateFlow<List<CatalogArtistDto>>(emptyList())
    val artists: StateFlow<List<CatalogArtistDto>> = _artists
    private val _lyrics = MutableStateFlow(LyricsUi())
    val lyrics: StateFlow<LyricsUi> = _lyrics
    private val _yandexPrompt = MutableStateFlow<DeviceCodePrompt?>(null)
    val yandexPrompt: StateFlow<DeviceCodePrompt?> = _yandexPrompt
    private val _homeSource = MutableStateFlow(SourceId.LOCAL)
    val homeSource: StateFlow<SourceId> = _homeSource
    private val _detailTitle = MutableStateFlow("")
    val detailTitle: StateFlow<String> = _detailTitle
    private val _likedIds = MutableStateFlow<Set<String>>(emptySet())
    val likedIds: StateFlow<Set<String>> = _likedIds
    private val _albums = MutableStateFlow<List<UnifiedAlbum>>(emptyList())
    val albums: StateFlow<List<UnifiedAlbum>> = _albums
    private val _searchPlaylists = MutableStateFlow<List<UnifiedPlaylist>>(emptyList())
    val searchPlaylists: StateFlow<List<UnifiedPlaylist>> = _searchPlaylists
    private val _searchArtists = MutableStateFlow<List<UnifiedArtist>>(emptyList())
    val searchArtists: StateFlow<List<UnifiedArtist>> = _searchArtists
    private val _similar = MutableStateFlow<List<UnifiedTrack>>(emptyList())
    val similar: StateFlow<List<UnifiedTrack>> = _similar
    private val _sources = MutableStateFlow(SourceStatuses())
    val sources: StateFlow<SourceStatuses> = _sources
    private val _vkLogin = MutableStateFlow(VkLoginUi())
    val vkLogin: StateFlow<VkLoginUi> = _vkLogin
    @Volatile private var vkCookieProbe = false

    init {
        refreshSources()
        viewModelScope.launch { spotifyWeb.loggedIn.collect { refreshSources() } }
    }

    fun refreshSources() {
        _sources.value = SourceStatuses(
            yandex = yandex.authStatus(),
            spotify = spotify.authStatus(),
            vk = vk.authStatus(),
        )
    }

    fun setHomeSource(source: SourceId) {
        _homeSource.value = source
        loadHome()
    }

    fun login(email: String, password: String, register: Boolean) {
        viewModelScope.launch {
            _error.value = null
            runCatching {
                if (register) {
                    val pending = repo.register(email, password)
                    _authVerify.value = true
                    _authInfo.value = "Код отправлен на ${pending.email}"
                } else {
                    repo.login(email, password)
                    _authVerify.value = false
                    loadLikesIds()
                }
            }.onFailure { e ->
                _error.value = e.message
            }
        }
    }

    fun verifyEmail(email: String, code: String) = launch {
        repo.verifyEmail(email, code)
        _authVerify.value = false
    }

    fun resendVerification(email: String, password: String) = launch {
        repo.resendVerification(email, password)
        _authInfo.value = "Новый код отправлен"
    }

    fun cancelVerify() {
        _authVerify.value = false
        _authInfo.value = null
    }

    fun logout() = viewModelScope.launch { repo.logout() }

    fun loadHome() = launch {
        when (_homeSource.value) {
            SourceId.LOCAL -> {
                _shelves.value = runCatching { repo.shelves() }.getOrNull()
                _tracks.value = repo.mssTracks(limit = 30)
                _playlists.value = repo.mssPlaylists()
            }
            SourceId.YANDEX -> {
                _feed.value = yandex.feed()
                _tracks.value = yandex.chart()
            }
            SourceId.SPOTIFY -> {
                _feed.value = runCatching { spotify.homeFeed() }.getOrDefault(emptyList())
                _playlists.value = spotify.listPlaylists()
                _tracks.value = spotify.savedTracks(40)
            }
            SourceId.VK -> {
                _playlists.value = vk.listPlaylists()
                _tracks.value = vk.savedTracks(40)
            }
        }
    }

    fun search(query: String, source: SourceId?, kind: String = "tracks") = launch {
        when (kind) {
            "albums" -> {
                _albums.value = when (source) {
                    SourceId.YANDEX -> yandex.searchAlbums(query)
                    else -> emptyList()
                }
                _tracks.value = emptyList()
            }
            "playlists" -> {
                _searchPlaylists.value = when (source) {
                    SourceId.YANDEX -> yandex.searchPlaylists(query)
                    SourceId.SPOTIFY -> spotify.listPlaylists().filter { it.title.contains(query, true) }
                    SourceId.VK -> vk.listPlaylists().filter { it.title.contains(query, true) }
                    else -> repo.mssPlaylists().filter { it.title.contains(query, true) }
                }
                _tracks.value = emptyList()
            }
            "artists" -> {
                _searchArtists.value = when (source) {
                    SourceId.VK -> vk.searchArtists(query, 20)
                    else -> repo.artists(query).map { UnifiedArtist(SourceId.LOCAL, it.name, it.name) }
                }
                _tracks.value = emptyList()
            }
            else -> {
                _tracks.value = repo.searchAll(query, source)
                if (source == SourceId.YANDEX) {
                    _albums.value = runCatching { yandex.searchAlbums(query) }.getOrDefault(emptyList())
                    _searchPlaylists.value = runCatching { yandex.searchPlaylists(query) }.getOrDefault(emptyList())
                }
            }
        }
    }

    fun loadLikes() = launch {
        _tracks.value = repo.mssLikes()
        loadLikesIds()
    }

    fun loadPlaylists() = launch { _playlists.value = repo.mssPlaylists() }

    fun loadArtists() = launch { _artists.value = repo.artists() }

    fun loadUploads() = launch { _tracks.value = repo.uploads() }

    fun loadOffline() {
        _tracks.value = downloads.records.value.map { it.track }
    }

    fun loadHistory() {
        _tracks.value = player.state.value.queue
    }

    fun openMssPlaylist(id: String) = launch {
        val (meta, tracks) = repo.playlistDetail(id)
        _detailTitle.value = meta.name
        _tracks.value = tracks
    }

    fun openExternalPlaylist(source: String, id: String) = launch {
        val decoded = java.net.URLDecoder.decode(id, Charsets.UTF_8)
        val pl: PlaylistWithTracks = when (sourceFrom(source)) {
            SourceId.YANDEX -> yandex.playlist(decoded)
            SourceId.SPOTIFY -> spotify.playlist(decoded)
            SourceId.VK -> vk.playlist(decoded)
            else -> return@launch
        }
        _detailTitle.value = pl.title
        _tracks.value = pl.tracks
    }

    fun openAlbum(source: String, id: String) = launch {
        val decoded = java.net.URLDecoder.decode(id, Charsets.UTF_8)
        when (sourceFrom(source)) {
            SourceId.YANDEX -> {
                val alb = yandex.album(decoded)
                _detailTitle.value = alb.title
                _tracks.value = alb.tracks
            }
            SourceId.SPOTIFY -> {
                val alb = spotify.album(decoded)
                _detailTitle.value = alb.title
                _tracks.value = alb.tracks
            }
            else -> {}
        }
    }

    fun openArtist(name: String) = launch {
        val decoded = java.net.URLDecoder.decode(name, Charsets.UTF_8)
        _detailTitle.value = decoded
        _tracks.value = repo.artistTracks(decoded)
    }

    fun createPlaylist(name: String) = launch {
        repo.createPlaylist(name)
        loadPlaylists()
    }

    fun deletePlaylist(id: String) = launch {
        repo.deletePlaylist(id)
        loadPlaylists()
    }

    fun activatePromo(code: String) = launch {
        repo.activatePromo(code)
        loadSubscription()
    }

    fun clearNeedFile() = presence.clearNeedFile()

    fun play(tracks: List<UnifiedTrack>, index: Int = 0, radio: Boolean = false) {
        player.playTracks(tracks, index, radio)
        if (tracks.getOrNull(index)?.source == SourceId.YANDEX) {
            loadLyrics(tracks[index])
        }
    }

    fun toggleLike(track: UnifiedTrack) = launch {
        val liked = track.id in _likedIds.value
        repo.toggleLike(track, !liked)
        _likedIds.value = if (liked) _likedIds.value - track.id else _likedIds.value + track.id
        if (track.source == SourceId.YANDEX && liked) yandex.dislike(track)
    }

    fun connectYandex() {
        viewModelScope.launch {
            runCatching {
                yandex.login { _yandexPrompt.value = it }
                refreshSources()
                loadHome()
            }.onFailure { _error.value = it.message }
            _yandexPrompt.value = null
        }
    }

    fun cancelYandexLogin() {
        yandex.cancelLogin()
        _yandexPrompt.value = null
    }

    fun showSpotifyLogin() = spotifyWeb.showLogin()

    fun openVkLogin() {
        vk.cancelLogin()
        vkCookieProbe = false
        _vkLogin.value = VkLoginUi(open = true, step = VkLoginStep.VKID)
    }

    fun openVkIdLogin() = openVkLogin()

    fun closeVkLogin() {
        vk.cancelLogin()
        vkCookieProbe = false
        _vkLogin.value = VkLoginUi()
    }

    fun setVkMethod(sms: Boolean) {
        vk.cancelLogin()
        vkCookieProbe = false
        _vkLogin.value = VkLoginUi(open = true, sms = sms)
    }

    fun submitVkPhone(phone: String, captchaKey: String? = null) = launchVk {
        val mask = vk.startSms(phone, _vkLogin.value.captchaSid, captchaKey)
        _vkLogin.value = _vkLogin.value.copy(
            step = VkLoginStep.CODE,
            phoneMask = mask,
            captchaImg = null,
            captchaSid = null,
            error = null,
        )
    }

    fun submitVkSms(code: String) = launchVk {
        vk.confirmSms(code)
        _vkLogin.value = VkLoginUi()
        refreshSources()
        loadHome()
    }

    fun submitVkPassword(username: String, password: String, code: String? = null, captchaKey: String? = null) = launchVk {
        vk.loginWithPassword(username, password, code, captchaKey)
        _vkLogin.value = VkLoginUi()
        refreshSources()
        loadHome()
    }

    fun completeVkId(url: String) {
        if (!VkAuth.shouldCompleteWebLogin(url)) return
        launchVk {
            vk.completeWebLogin(url)
            _vkLogin.value = VkLoginUi()
            refreshSources()
            loadHome()
        }
    }

    fun tryVkWebCookies(cookies: String) {
        if (cookies.isBlank() || vkCookieProbe) return
        viewModelScope.launch {
            vkCookieProbe = true
            runCatching { vk.completeWebLoginFromCookies(cookies) }
                .onSuccess { ok ->
                    if (ok) {
                        _vkLogin.value = VkLoginUi()
                        refreshSources()
                        loadHome()
                    }
                }
                .onFailure { e ->
                    _vkLogin.value = _vkLogin.value.copy(busy = false, error = e.message)
                }
            vkCookieProbe = false
        }
    }

    private fun launchVk(block: suspend () -> Unit) {
        viewModelScope.launch {
            _vkLogin.value = _vkLogin.value.copy(busy = true, error = null)
            runCatching { block() }.onFailure { e ->
                val cur = _vkLogin.value
                when (e) {
                    is VkAuthException -> {
                        if (e.robot) {
                            _vkLogin.value = cur.copy(busy = false, step = VkLoginStep.VKID, error = e.message)
                        } else if (e.passwordRequired) {
                            _vkLogin.value = VkLoginUi(open = true, sms = false, error = e.message, busy = false)
                        } else if (e.need2fa) {
                            _vkLogin.value = cur.copy(
                                busy = false,
                                step = VkLoginStep.CODE,
                                phoneMask = e.phoneMask,
                                error = e.message,
                            )
                        } else if (!e.captchaImg.isNullOrBlank()) {
                            _vkLogin.value = cur.copy(
                                busy = false,
                                step = VkLoginStep.CAPTCHA,
                                captchaImg = e.captchaImg,
                                captchaSid = e.captchaSid,
                                error = e.message,
                            )
                        } else {
                            _vkLogin.value = cur.copy(busy = false, error = e.message)
                        }
                    }
                    else -> _vkLogin.value = cur.copy(busy = false, error = e.message)
                }
            }
            if (_vkLogin.value.busy) _vkLogin.value = _vkLogin.value.copy(busy = false)
        }
    }

    fun startSpotifyRadio(track: UnifiedTrack) = launch {
        if (!spotifyWeb.loggedIn.value) {
            showSpotifyLogin()
            return@launch
        }
        val radio = spotify.trackRadio(track)
        val rest = radio.tracks.filter { it.id != track.id }
        play(listOf(track) + rest)
    }

    fun setApiBase(url: String) = launch { repo.setApiBase(url) }

    fun loadStats(period: String = "month", year: Int? = null) = launch {
        _stats.value = repo.stats(period, year)
    }

    fun loadSubscription() = launch { _subscription.value = repo.subscription() }

    fun startWave(settings: WaveSettings = WaveSettings()) = launch {
        val batch = yandex.waveStart(settings)
        if (batch.tracks.isEmpty()) error("Волна не вернула треки")
        player.setWaveSession(batch.sessionId, batch.batchId)
        play(batch.tracks, radio = true)
    }

    fun loadSimilar(track: UnifiedTrack) = launch {
        val list = when (track.source) {
            SourceId.YANDEX -> yandex.similarTracks(track.id)
            SourceId.SPOTIFY -> runCatching { spotify.trackRadio(track).tracks.filter { it.id != track.id } }.getOrDefault(emptyList())
            else -> emptyList()
        }
        _similar.value = list
        _tracks.value = list
        _detailTitle.value = "Похожие"
    }

    fun loadLyrics(track: UnifiedTrack) {
        val key = "${track.source}:${track.id}"
        _lyrics.value = LyricsUi(key = key, source = track.source, loading = true)
        viewModelScope.launch {
            val result = runCatching {
                when (track.source) {
                    SourceId.YANDEX -> yandex.lyrics(track.id)
                    SourceId.SPOTIFY -> spotify.lyrics(track.id)
                    SourceId.LOCAL -> localTracks.lyrics(track.id)
                    else -> null
                }
            }
            if (_lyrics.value.key != key) return@launch
            _lyrics.value = result.fold(
                onSuccess = { LyricsUi(key = key, source = track.source, data = it) },
                onFailure = { LyricsUi(key = key, source = track.source, failed = true) },
            )
        }
    }

    fun download(track: UnifiedTrack) = launch {
        if (track.source == SourceId.LOCAL) {
            val sub = _subscription.value ?: runCatching { repo.subscription() }.getOrNull()
            val max = sub?.features?.maxOfflineTracks
            if (max != null && offline.listTrackIds().size >= max) {
                error("Лимит офлайн-треков ($max)")
            }
        }
        when (track.source) {
            SourceId.LOCAL -> downloads.enqueueOfflineMss(track)
            SourceId.YANDEX -> downloads.enqueueYandex(track)
            else -> {
                val url = track.streamUrl ?: return@launch
                downloads.enqueue(url, "${track.source}_${track.id}.bin", track)
            }
        }
    }

    fun removeDownload(key: String) = downloads.remove(key)

    fun registerUpload(uri: Uri, title: String, artist: String) = launch {
        repo.registerLocalFile(uri, title, artist)
        loadUploads()
    }

    fun createLobby(title: String, pub: Boolean) = launch { lobby.create(title, pub) }

    fun joinLobby(code: String) = launch { lobby.join(code) }

    fun leaveLobby() = launch { lobby.leave() }

    fun suggestToLobby(track: UnifiedTrack) = launch {
        val uid = session.value?.user?.id
        if (!lobby.isListener(uid)) error("Предложить трек может слушатель эфира")
        lobby.suggest(track)
        _notice.value = "Трек предложен DJ"
    }

    fun acceptLobby(itemId: String) = launch { lobby.accept(itemId) }

    fun rejectLobby(itemId: String) = launch { lobby.reject(itemId) }

    fun isLobbyHost(): Boolean = lobby.isHost(session.value?.user?.id)

    fun savePlayback(settings: PlaybackSettings) = launch { repo.prefs.savePlaybackSettings(settings) }

    fun setOnboarded() = launch { repo.prefs.setOnboarded(true) }

    fun connectorStatus(source: SourceId): AuthStatus = when (source) {
        SourceId.YANDEX -> _sources.value.yandex
        SourceId.SPOTIFY -> _sources.value.spotify
        SourceId.VK -> _sources.value.vk
        else -> AuthStatus.DISCONNECTED
    }

    fun disconnectSource(source: SourceId) = launch {
        when (source) {
            SourceId.YANDEX -> yandex.disconnect()
            SourceId.SPOTIFY -> spotify.disconnect()
            SourceId.VK -> vk.disconnect()
            else -> {}
        }
        refreshSources()
    }

    fun applyDeepLink(url: String) {
        val action = parseMssLink(url) ?: return
        viewModelScope.launch {
            runCatching {
                if (action.playSource != null && action.playId != null) {
                    playFrom(action.playSource, action.playId)
                }
                if (action.inviteCode != null) joinLobby(action.inviteCode)
            }.onFailure { _error.value = it.message }
        }
    }

    private suspend fun playFrom(source: String, id: String) {
        when (sourceFrom(source)) {
            SourceId.LOCAL -> play(listOf(repo.getTrack(id)))
            SourceId.YANDEX -> yandex.tracksByIds(listOf(id)).firstOrNull()?.let { play(listOf(it)) }
            SourceId.SPOTIFY -> play(listOf(UnifiedTrack(SourceId.SPOTIFY, id, id, "Spotify")))
            SourceId.VK -> play(listOf(UnifiedTrack(SourceId.VK, id, id, "VK")))
        }
    }

    private fun loadLikesIds() {
        viewModelScope.launch {
            runCatching { _likedIds.value = repo.mssLikes().map { it.id }.toSet() }
        }
    }

    private fun launch(block: suspend () -> Unit) {
        viewModelScope.launch {
            _error.value = null
            _notice.value = null
            runCatching { block() }.onFailure { e ->
                if (session.value?.accessToken == "preview") return@launch
                _error.value = e.message
            }
        }
    }

    fun clearError() { _error.value = null }
    fun clearNotice() { _notice.value = null }
}

data class LyricsUi(
    val key: String = "",
    val source: SourceId? = null,
    val loading: Boolean = false,
    val failed: Boolean = false,
    val data: TrackLyrics? = null,
)

data class SourceStatuses(
    val yandex: AuthStatus = AuthStatus.DISCONNECTED,
    val spotify: AuthStatus = AuthStatus.DISCONNECTED,
    val vk: AuthStatus = AuthStatus.DISCONNECTED,
)

enum class VkLoginStep { FORM, CODE, CAPTCHA, VKID }

data class VkLoginUi(
    val open: Boolean = false,
    val sms: Boolean = true,
    val step: VkLoginStep = VkLoginStep.FORM,
    val error: String? = null,
    val phoneMask: String? = null,
    val captchaImg: String? = null,
    val captchaSid: String? = null,
    val busy: Boolean = false,
)
