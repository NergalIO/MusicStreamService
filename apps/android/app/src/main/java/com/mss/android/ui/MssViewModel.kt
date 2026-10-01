package com.mss.android.ui

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mss.android.data.AppUpdater
import com.mss.android.data.ContentCache
import com.mss.android.data.MssRepository
import com.mss.android.data.SessionLog
import com.mss.android.ui.navigation.parseMssLink
import com.mss.core.connectors.AuthStatus
import com.mss.core.connectors.ConnectorException
import com.mss.core.connectors.SpotifyConnector
import com.mss.core.connectors.SpotifyWebSession
import com.mss.core.connectors.VkAuth
import com.mss.core.connectors.VkAuthException
import com.mss.core.connectors.VkConnector
import com.mss.core.connectors.YandexConnector
import com.mss.core.downloads.DownloadScheduler

import com.mss.core.lobby.LobbyClient
import com.mss.core.model.DeviceCodePrompt
import com.mss.core.model.FeedBlock
import com.mss.core.model.HomeShelves
import com.mss.core.model.ListeningStats
import com.mss.core.model.PlaybackSettings
import com.mss.core.model.AlbumWithTracks
import com.mss.core.model.CatalogArtistDto
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
import com.mss.core.network.PlayReporter
import com.mss.core.network.PresenceClient
import com.mss.core.offline.OfflineStore
import com.mss.core.player.PlayerController
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

@HiltViewModel
class MssViewModel @Inject constructor(
    private val repo: MssRepository,
    val player: PlayerController,
    private val playReporter: PlayReporter,
    private val spotify: SpotifyConnector,
    private val yandex: YandexConnector,
    private val vk: VkConnector,
    val spotifyWeb: SpotifyWebSession,
    private val downloads: DownloadScheduler,
    private val lobby: LobbyClient,
    private val offline: OfflineStore,
    private val localTracks: LocalTrackStore,
    private val presence: PresenceClient,
    private val contentCache: ContentCache,
    val updater: AppUpdater,
    private val sessionLog: SessionLog,
) : ViewModel() {
    val session = repo.session.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val playerState = player.state.stateIn(viewModelScope, SharingStarted.Eagerly, player.state.value)
    val lobbyState = lobby.lobby.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val canSuggestToLobby: StateFlow<Boolean> = combine(lobby.lobby, session) { room, sess ->
        val uid = sess?.user?.id
        room != null && uid != null && room.hostUserId != uid
    }.stateIn(viewModelScope, SharingStarted.Eagerly, false)
    val downloadRecords = downloads.records
    val activeDownloads = downloads.active
    val downloadedAlbums = downloads.albums
    val downloadedKeys: StateFlow<Set<String>> = downloads.records
        .map { list -> list.map { it.key }.toSet() }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptySet())
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
    private val _statsError = MutableStateFlow<String?>(null)
    val statsError: StateFlow<String?> = _statsError
    private var statsJob: Job? = null
    private val _subscription = MutableStateFlow<UserSubscriptionDto?>(null)
    val subscription: StateFlow<UserSubscriptionDto?> = _subscription
    private val _shelves = MutableStateFlow<HomeShelves?>(null)
    val shelves: StateFlow<HomeShelves?> = _shelves
    private val _feed = MutableStateFlow<List<FeedBlock>>(emptyList())
    val feed: StateFlow<List<FeedBlock>> = _feed
    private val _lyrics = MutableStateFlow(LyricsUi())
    val lyrics: StateFlow<LyricsUi> = _lyrics
    private val _yandexPrompt = MutableStateFlow<DeviceCodePrompt?>(null)
    val yandexPrompt: StateFlow<DeviceCodePrompt?> = _yandexPrompt
    private val _homeSource = MutableStateFlow<SourceId?>(null)
    val homeSource: StateFlow<SourceId?> = _homeSource
    private val _homeArtists = MutableStateFlow<List<UnifiedArtist>>(emptyList())
    val homeArtists: StateFlow<List<UnifiedArtist>> = _homeArtists
    private val _homeAlbums = MutableStateFlow<List<UnifiedAlbum>>(emptyList())
    val homeAlbums: StateFlow<List<UnifiedAlbum>> = _homeAlbums
    private val _detailTitle = MutableStateFlow("")
    val detailTitle: StateFlow<String> = _detailTitle
    private val _artistPage = MutableStateFlow(ArtistPageUi())
    val artistPage: StateFlow<ArtistPageUi> = _artistPage
    private val _albumPage = MutableStateFlow(AlbumPageUi())
    val albumPage: StateFlow<AlbumPageUi> = _albumPage
    private val _likedIds = MutableStateFlow<Set<String>>(emptySet())
    val likedIds: StateFlow<Set<String>> = _likedIds
    private val _likedAlbums = MutableStateFlow<List<UnifiedAlbum>>(emptyList())
    val likedAlbums: StateFlow<List<UnifiedAlbum>> = _likedAlbums
    private val _likedArtists = MutableStateFlow<List<UnifiedArtist>>(emptyList())
    val likedArtists: StateFlow<List<UnifiedArtist>> = _likedArtists
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
    private val _pickerPlaylists = MutableStateFlow<List<UnifiedPlaylist>>(emptyList())
    val pickerPlaylists: StateFlow<List<UnifiedPlaylist>> = _pickerPlaylists
    private val albumCache = mutableMapOf<SourceId, AlbumWithTracks>()
    private var albumAlternatives = mapOf<SourceId, UnifiedAlbum>()
    private var albumToken = 0
    private val _library = MutableStateFlow(LibraryUi())
    val library: StateFlow<LibraryUi> = _library
    private val _libraryTab = MutableStateFlow(LibraryTab.COLLECTION)
    val libraryTab: StateFlow<LibraryTab> = _libraryTab
    private val _librarySource = MutableStateFlow<SourceId?>(null)
    val librarySource: StateFlow<SourceId?> = _librarySource
    val playHistory = repo.prefs.playHistory.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    private var vkExchange: Job? = null
    private var vkPoll: Job? = null

    init {
        refreshSources()
        viewModelScope.launch {
            var seen = false
            spotifyWeb.loggedIn.collect { logged ->
                if (seen) sessionLog.info("auth", if (logged) "spotify connected" else "spotify disconnected")
                seen = true
                refreshSources()
            }
        }
        player.onToggleLike = {
            player.state.value.current?.let { toggleLike(it) }
        }
        player.onError = {
            sessionLog.error("player", it)
            _error.value = it
        }
        player.onSession = { level, category, message -> sessionLog.event(level, category, message) }
        viewModelScope.launch {
            combine(
                player.state.map { it.current?.id }.distinctUntilChanged(),
                likedIds,
            ) { id, ids -> id != null && id in ids }
                .distinctUntilChanged()
                .collect { player.setLiked(it) }
        }
        viewModelScope.launch {
            player.state.map { it.current }
                .distinctUntilChanged { a, b -> a?.source == b?.source && a?.id == b?.id }
                .collect { track -> if (track != null) runCatching { repo.prefs.addPlayHistory(track) } }
        }
        viewModelScope.launch {
            session.map { it?.user?.id }.distinctUntilChanged().collect { userId ->
                val token = session.value?.accessToken
                if (userId != null && !token.isNullOrBlank() && token != "preview") {
                    runCatching { playReporter.flush() }
                    runCatching { syncPlayHistory() }
                    loadLikesIds()
                } else {
                    _likedAlbums.value = emptyList()
                    _likedArtists.value = emptyList()
                }
            }
        }
        viewModelScope.launch {
            playReporter.synced.collect { runCatching { syncPlayHistory() } }
        }
        viewModelScope.launch {
            playReporter.online.collectLatest {
                delay(1_000)
                runCatching { syncPlayHistory() }
            }
        }
        viewModelScope.launch {
            while (isActive) {
                delay(60_000)
                val token = session.value?.accessToken
                if (!token.isNullOrBlank() && token != "preview") runCatching { syncPlayHistory() }
            }
        }
    }

    fun refreshPlayHistory() {
        viewModelScope.launch { runCatching { syncPlayHistory() } }
    }

    private suspend fun syncPlayHistory() {
        repo.prefs.mergeRemoteHistory(repo.listeningHistory())
    }

    fun refreshSources() {
        _sources.value = SourceStatuses(
            yandex = yandex.authStatus(),
            spotify = spotify.authStatus(),
            vk = vk.authStatus(),
        )
    }

    fun setHomeSource(source: SourceId?) {
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
                    sessionLog.info("auth", "register mss pending verify")
                } else {
                    repo.login(email, password)
                    _authVerify.value = false
                    sessionLog.info("auth", "login mss")
                    loadLikesIds()
                }
            }.onFailure { e ->
                sessionLog.error("auth", e.message ?: "login failed")
                _error.value = e.message
            }
        }
    }

    fun verifyEmail(email: String, code: String) = launch {
        repo.verifyEmail(email, code)
        _authVerify.value = false
        sessionLog.info("auth", "verify email")
    }

    fun resendVerification(email: String, password: String) = launch {
        repo.resendVerification(email, password)
        _authInfo.value = "Новый код отправлен"
    }

    fun cancelVerify() {
        _authVerify.value = false
        _authInfo.value = null
    }

    fun logout() = viewModelScope.launch {
        repo.logout()
        sessionLog.info("auth", "logout mss")
    }

    fun loadHome() = launch {
        when (_homeSource.value) {
            null -> loadHomeAll()
            SourceId.LOCAL -> loadHomeMss()
            SourceId.YANDEX -> {
                _shelves.value = runCatching { repo.shelves() }.getOrNull()?.onlySource(SourceId.YANDEX)
                _homeArtists.value = emptyList()
                _homeAlbums.value = emptyList()
                _playlists.value = emptyList()
                _feed.value = yandex.feed()
                _tracks.value = yandex.chart()
            }
            SourceId.SPOTIFY -> {
                _shelves.value = null
                _homeArtists.value = emptyList()
                _homeAlbums.value = emptyList()
                _feed.value = runCatching { spotify.homeFeed() }.getOrDefault(emptyList())
                _playlists.value = spotify.listPlaylists()
                _tracks.value = spotify.savedTracks(40)
            }
            SourceId.VK -> {
                _shelves.value = null
                _homeArtists.value = emptyList()
                _homeAlbums.value = emptyList()
                _feed.value = emptyList()
                val tracks = runCatching { vk.savedTracks(40) }
                val playlists = runCatching { vk.listPlaylists() }
                _tracks.value = tracks.getOrDefault(emptyList())
                _playlists.value = playlists.getOrDefault(emptyList())
                (tracks.exceptionOrNull() ?: playlists.exceptionOrNull())?.let { throw it }
            }
        }
    }

    private suspend fun loadHomeAll() = coroutineScope {
        val shelvesD = async { runCatching { repo.shelves() }.getOrNull() }
        val mssTracksD = async { runCatching { repo.mssTracks(limit = 30) }.getOrDefault(emptyList()) }
        val mssPlaylistsD = async { runCatching { repo.mssPlaylists() }.getOrDefault(emptyList()) }
        val yandexOn = sourceConnected(SourceId.YANDEX)
        val spotifyOn = sourceConnected(SourceId.SPOTIFY)
        val vkOn = sourceConnected(SourceId.VK)
        val yandexFeedD = async { if (yandexOn) runCatching { yandex.feed() }.getOrDefault(emptyList()) else emptyList() }
        val yandexChartD = async { if (yandexOn) runCatching { yandex.chart() }.getOrDefault(emptyList()) else emptyList() }
        val spotifyFeedD = async { if (spotifyOn) runCatching { spotify.homeFeed() }.getOrDefault(emptyList()) else emptyList() }
        val spotifyPlaylistsD = async { if (spotifyOn) runCatching { spotify.listPlaylists() }.getOrDefault(emptyList()) else emptyList() }
        val spotifySavedD = async { if (spotifyOn) runCatching { spotify.savedTracks(20) }.getOrDefault(emptyList()) else emptyList() }
        val vkTracksD = async { if (vkOn) runCatching { vk.savedTracks(20) }.getOrDefault(emptyList()) else emptyList() }
        val vkPlaylistsD = async { if (vkOn) runCatching { vk.listPlaylists() }.getOrDefault(emptyList()) else emptyList() }
        val yandexFeed = yandexFeedD.await()
        val spotifyFeed = spotifyFeedD.await()
        _shelves.value = shelvesD.await()
        _homeArtists.value = emptyList()
        _homeAlbums.value = emptyList()
        _feed.value = when {
            yandexFeed.isNotEmpty() && spotifyFeed.isNotEmpty() ->
                yandexFeed.map { it.copy(title = "Яндекс · ${it.title}") } +
                    spotifyFeed.map { it.copy(title = "Spotify · ${it.title}") }
            else -> yandexFeed + spotifyFeed
        }
        _playlists.value = mergeHomePlaylists(
            mssPlaylistsD.await(),
            spotifyPlaylistsD.await(),
            vkPlaylistsD.await(),
        )
        _tracks.value = mergeHomeTracks(
            mssTracksD.await(),
            yandexChartD.await(),
            spotifySavedD.await(),
            vkTracksD.await(),
        )
    }

    private suspend fun loadHomeMss() = coroutineScope {
        val shelvesD = async { runCatching { repo.shelves() }.getOrNull()?.onlyLocal() }
        val tracksD = async { runCatching { repo.mssTracks(limit = 50) }.getOrDefault(emptyList()) }
        val playlistsD = async { runCatching { repo.mssPlaylists() }.getOrDefault(emptyList()) }
        val artistsD = async { runCatching { repo.artists(limit = 40) }.getOrDefault(emptyList()) }
        val albumsD = async { runCatching { repo.albums() }.getOrDefault(emptyList()) }
        val tracks = tracksD.await()
        _shelves.value = shelvesD.await()
        _feed.value = emptyList()
        _tracks.value = tracks
        _playlists.value = playlistsD.await()
        _homeArtists.value = mssCatalogArtists(artistsD.await(), tracks)
        _homeAlbums.value = mergeMssAlbums(albumsD.await(), tracks)
    }

    fun search(query: String, source: SourceId?, kind: String = "tracks") = launch {
        when (kind) {
            "albums" -> {
                _albums.value = searchAlbums(query, source)
                _tracks.value = emptyList()
            }
            "playlists" -> {
                _searchPlaylists.value = searchPlaylists(query, source)
                _tracks.value = emptyList()
            }
            "artists" -> {
                _searchArtists.value = searchArtists(query, source)
                _tracks.value = emptyList()
            }
            else -> {
                _tracks.value = repo.searchAll(query, source)
                if (kind == "all") {
                    _albums.value = searchAlbums(query, source)
                    _searchArtists.value = searchArtists(query, source)
                    _searchPlaylists.value = searchPlaylists(query, source)
                } else if (source == SourceId.YANDEX) {
                    _albums.value = runCatching { yandex.searchAlbums(query) }.getOrDefault(emptyList())
                    _searchPlaylists.value = runCatching { yandex.searchPlaylists(query) }.getOrDefault(emptyList())
                }
            }
        }
    }

    fun loadPlaylists() = launch { _playlists.value = repo.mssPlaylists() }

    fun setLibraryTab(tab: LibraryTab) { _libraryTab.value = tab }

    fun setLibrarySource(source: SourceId?) { _librarySource.value = source }

    fun loadLibrary(force: Boolean = false) {
        val current = _library.value
        if (current.loading || (current.loaded && !force)) return
        _library.value = current.copy(loading = true)
        viewModelScope.launch {
            val connected = LIBRARY_SOURCES.filter { sourceConnected(it) }
            val uploadsD = async { runCatching { repo.uploads() } }
            val albumsD = async { runCatching { repo.albums() } }
            val likedD = async { runCatching { repo.likedAlbums() } }
            val likedArtistsD = async { runCatching { repo.likedArtists() } }
            val yandexAlbumsD = async {
                if (sourceConnected(SourceId.YANDEX)) runCatching { yandex.likedAlbums() } else Result.success(emptyList())
            }
            val perSource = coroutineScope {
                connected.map { src ->
                    async { Triple(src, runCatching { libraryLikes(src) }, runCatching { libraryPlaylists(src) }) }
                }.awaitAll()
            }
            val uploads = uploadsD.await()
            val albums = albumsD.await()
            val likedAlbums = mergeLikedAlbums(
                yandexAlbumsD.await().getOrDefault(emptyList()),
                likedD.await().getOrDefault(_library.value.likedAlbums),
            )
            val likedArtists = likedArtistsD.await().getOrDefault(_library.value.likedArtists)
            val errors = perSource.mapNotNull { (src, likes, playlists) ->
                (likes.exceptionOrNull() ?: playlists.exceptionOrNull())?.let { src to (it.message ?: "Не удалось загрузить") }
            }.toMap()
            val likes = perSource.associate { (src, result, _) -> src to result.getOrDefault(emptyList()) }
            _likedAlbums.value = likedAlbums
            _likedArtists.value = likedArtists
            _library.value = LibraryUi(
                likes = likes,
                playlists = perSource.associate { (src, _, result) -> src to result.getOrDefault(emptyList()) },
                uploads = uploads.getOrDefault(_library.value.uploads),
                albums = albums.getOrDefault(_library.value.albums),
                likedAlbums = likedAlbums,
                likedArtists = likedArtists,
                connected = connected,
                errors = errors,
                loading = false,
                loaded = true,
            )
            val ids = likes.values.flatten().map { it.id }.toSet()
            _likedIds.value = if (errors.isEmpty()) ids else _likedIds.value + ids
        }
    }

    private suspend fun libraryLikes(source: SourceId): List<UnifiedTrack> = when (source) {
        SourceId.LOCAL -> repo.mssLikes()
        SourceId.YANDEX -> yandex.savedTracks(LIBRARY_LIKES_LIMIT)
        SourceId.SPOTIFY -> spotify.savedTracks(LIBRARY_LIKES_LIMIT)
        SourceId.VK -> vk.savedTracks(LIBRARY_LIKES_LIMIT)
    }

    private suspend fun libraryPlaylists(source: SourceId): List<UnifiedPlaylist> = when (source) {
        SourceId.LOCAL -> repo.mssPlaylists()
        SourceId.YANDEX -> yandex.listPlaylists()
        SourceId.SPOTIFY -> spotify.listPlaylists()
        SourceId.VK -> vk.listPlaylists()
    }

    private fun mergeLikedAlbums(vararg lists: List<UnifiedAlbum>): List<UnifiedAlbum> {
        val seen = linkedSetOf<String>()
        val out = mutableListOf<UnifiedAlbum>()
        lists.forEach { list ->
            list.forEach { album ->
                if (seen.add("${album.source}:${album.id}")) out += album
            }
        }
        return out
    }

    private suspend fun refreshLibraryUploads() {
        val uploads = repo.uploads()
        val albums = runCatching { repo.albums() }.getOrDefault(_library.value.albums)
        val likedAlbums = runCatching { repo.likedAlbums() }.getOrDefault(_likedAlbums.value)
        val likedArtists = runCatching { repo.likedArtists() }.getOrDefault(_likedArtists.value)
        _likedAlbums.value = likedAlbums
        _likedArtists.value = likedArtists
        _library.value = _library.value.copy(uploads = uploads, albums = albums, likedAlbums = likedAlbums, likedArtists = likedArtists)
    }

    private fun reloadLibraryUploads() = launch { refreshLibraryUploads() }

    private fun reloadLibraryMssPlaylists() = launch {
        val playlists = repo.mssPlaylists()
        _playlists.value = playlists
        _library.value = _library.value.copy(playlists = _library.value.playlists + (SourceId.LOCAL to playlists))
    }

    fun clearPlayHistory() = launch { repo.prefs.clearPlayHistory() }

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

    fun playPlaylist(playlist: UnifiedPlaylist) = launch {
        val tracks = runCatching {
            when (playlist.source) {
                SourceId.LOCAL -> repo.playlistDetail(playlist.id).second
                SourceId.YANDEX -> yandex.playlist(playlist.id).tracks
                SourceId.SPOTIFY -> spotify.playlist(playlist.id).tracks
                SourceId.VK -> vk.playlist(playlist.id).tracks
            }
        }.getOrElse {
            _error.value = it.message ?: "Не удалось загрузить плейлист"
            return@launch
        }
        if (tracks.isEmpty()) {
            _error.value = "В плейлисте нет треков"
            return@launch
        }
        play(tracks, 0)
    }

    fun playAlbum(album: UnifiedAlbum) = launch {
        val saved = downloads.albums.value.firstOrNull { it.source == album.source && it.id == album.id }
        val tracks = saved?.tracks?.takeIf { it.isNotEmpty() }
            ?: runCatching { loadAlbum(album.source, album.id) }.getOrNull()?.tracks.orEmpty()
        if (tracks.isEmpty()) {
            _error.value = "Не удалось загрузить альбом"
            return@launch
        }
        play(tracks, 0)
    }

    fun openAlbum(source: String, id: String) {
        val decoded = java.net.URLDecoder.decode(id, Charsets.UTF_8)
        val token = ++albumToken
        albumCache.clear()
        albumAlternatives = emptyMap()
        _albumPage.value = AlbumPageUi(loading = true)
        viewModelScope.launch {
            runCatching { repo.likedAlbums() }.getOrNull()?.let { _likedAlbums.value = it }
            val src = sourceFrom(source)
            val saved = downloads.albums.value.firstOrNull { it.source == src && it.id == decoded }
            val savedFinal = saved?.takeIf { src == SourceId.LOCAL || src == SourceId.VK }
            val quick = savedFinal ?: contentCache.album(src, decoded)
            if (token != albumToken) return@launch
            if (quick != null) showAlbum(quick)
            val fresh = if (savedFinal != null) null else runCatching { loadAlbum(src, decoded) }.getOrNull()
            if (token != albumToken) return@launch
            if (fresh != null) {
                contentCache.putAlbum(src, decoded, fresh)
                val page = _albumPage.value
                if (quick == null || (page.switching == null && page.album?.source == quick.source)) showAlbum(fresh)
            }
            val album = fresh ?: quick ?: saved
            if (album == null) {
                _albumPage.value = AlbumPageUi(loading = false, error = "Альбом не найден")
                _detailTitle.value = decoded
                _tracks.value = emptyList()
                return@launch
            }
            if (fresh == null && quick == null) showAlbum(album)
            albumCache[album.source] = album
            val self = album.toUnifiedAlbum()
            _albumPage.value = _albumPage.value.copy(platforms = listOf(self), platformsLoading = true)
            val found = runCatching { findAlbumAlternatives(album) }.getOrDefault(emptyMap())
            if (token != albumToken) return@launch
            albumAlternatives = found + (album.source to self)
            _albumPage.value = _albumPage.value.copy(
                platforms = LIBRARY_SOURCES.mapNotNull { albumAlternatives[it] },
                platformsLoading = false,
            )
        }
    }

    private fun showAlbum(album: AlbumWithTracks) {
        _albumPage.value = _albumPage.value.copy(album = album, loading = false, error = null)
        _detailTitle.value = album.title
        _tracks.value = album.tracks
    }

    fun switchAlbumPlatform(source: SourceId) {
        val page = _albumPage.value
        if (page.album?.source == source || page.switching != null) return
        val target = albumAlternatives[source] ?: return
        val token = albumToken
        _albumPage.value = page.copy(switching = source)
        viewModelScope.launch {
            val album = albumCache[source] ?: runCatching { loadAlbumAlternative(target) }.getOrNull()
            if (token != albumToken) return@launch
            if (album == null || album.tracks.isEmpty()) {
                _albumPage.value = _albumPage.value.copy(switching = null)
                _error.value = "Не удалось открыть альбом в ${sourceName(source)}"
                return@launch
            }
            albumCache[source] = album
            _albumPage.value = _albumPage.value.copy(album = album, switching = null, error = null)
            _detailTitle.value = album.title
            _tracks.value = album.tracks
        }
    }

    private suspend fun loadAlbumAlternative(target: UnifiedAlbum): AlbumWithTracks? = when (target.source) {
        SourceId.YANDEX, SourceId.SPOTIFY -> albumById(target.source, target.id)
        SourceId.VK -> {
            val tracks = vk.search("${target.artist} ${target.title}", 40)
                .filter { it.albumId == target.id || it.album.equals(target.title, true) }
            if (tracks.isEmpty()) null
            else AlbumWithTracks(SourceId.VK, target.id, target.title, target.artist, year = target.year, coverUrl = target.coverUrl, tracks = tracks)
        }
        SourceId.LOCAL -> null
    }

    private suspend fun findAlbumAlternatives(album: AlbumWithTracks): Map<SourceId, UnifiedAlbum> = coroutineScope {
        val artist = album.artists?.firstOrNull()?.name ?: album.artist.split(',', '&').first()
        val query = "$artist ${album.title}".trim()
        val count = album.tracks.size.takeIf { it > 0 } ?: album.trackCount ?: 0
        fun best(list: List<UnifiedAlbum>): UnifiedAlbum? = list
            .filter { sameAlbum(it.title, it.artist, album.title, artist) }
            .minByOrNull { kotlin.math.abs((it.trackCount ?: count) - count) }
        LIBRARY_SOURCES
            .filter { it != album.source && sourceConnected(it) }
            .map { src ->
                async {
                    val hit = runCatching {
                        when (src) {
                            SourceId.YANDEX -> best(yandex.searchAlbums(query, 10))
                            SourceId.SPOTIFY -> best(spotify.searchAlbums(query, 10))
                            SourceId.VK -> best(vk.searchAlbums(query, 10))
                            SourceId.LOCAL -> {
                                val tracks = repo.mssTracks(query, 50)
                                    .filter { sameAlbum(it.album.orEmpty(), it.artist, album.title, artist) }
                                tracks.firstOrNull()?.let { first ->
                                    val local = AlbumWithTracks(
                                        SourceId.LOCAL,
                                        first.albumId ?: first.album.orEmpty(),
                                        first.album.orEmpty(),
                                        first.artist,
                                        coverUrl = first.coverUrl,
                                        tracks = tracks,
                                    )
                                    albumCache[SourceId.LOCAL] = local
                                    local.toUnifiedAlbum()
                                }
                            }
                        }
                    }.getOrNull()
                    hit?.let { src to it }
                }
            }
            .awaitAll()
            .filterNotNull()
            .toMap()
    }

    private fun sourceName(source: SourceId) = when (source) {
        SourceId.LOCAL -> "MSS"
        SourceId.YANDEX -> "Яндекс Музыке"
        SourceId.SPOTIFY -> "Spotify"
        SourceId.VK -> "VK"
    }

    fun openArtist(name: String, source: String = "local", id: String = "-") {
        val decodedName = java.net.URLDecoder.decode(name, Charsets.UTF_8)
        val decodedId = java.net.URLDecoder.decode(id, Charsets.UTF_8).takeIf { it.isNotBlank() && it != "-" }
        val preferred = sourceFrom(source)
        _detailTitle.value = decodedName
        _artistPage.value = ArtistPageUi(name = decodedName, loading = true, preferred = preferred)
        viewModelScope.launch {
            val page = loadArtistPage(decodedName, preferred, decodedId)
            if (_artistPage.value.name != decodedName) return@launch
            _artistPage.value = page
            _tracks.value = page.tracksBySource.values.flatten()
        }
    }

    private val artistImages = mutableMapOf<String, String?>()

    /** Фото профиля основного исполнителя трека: сначала с площадки трека, затем с остальных подключённых. */
    suspend fun artistImage(track: UnifiedTrack): String? {
        val ref = track.artists?.firstOrNull()
        val name = ref?.name ?: track.artist.substringBefore(',').trim()
        if (name.isBlank()) return null
        val key = "${track.source}:${ref?.id ?: name.lowercase()}"
        if (artistImages.containsKey(key)) return artistImages[key]
        contentCache.artistImage(key)?.let {
            artistImages[key] = it
            return it
        }
        fun pick(list: List<UnifiedArtist>) =
            (ref?.id?.let { id -> list.firstOrNull { it.id == id } }
                ?: list.firstOrNull { it.name.equals(name, ignoreCase = true) })?.imageUrl
        val order = listOf(track.source, SourceId.YANDEX, SourceId.SPOTIFY).distinct()
        var image: String? = null
        for (src in order) {
            if (!sourceConnected(src)) continue
            image = runCatching {
                when (src) {
                    SourceId.YANDEX -> pick(yandex.searchArtists(name, 8))
                    SourceId.SPOTIFY -> pick(spotify.searchArtists(name, 8))
                        ?: ref?.id?.takeIf { track.source == SourceId.SPOTIFY }?.let { spotify.artist(it)?.imageUrl }
                    else -> null
                }
            }.getOrNull()
            if (image != null) break
        }
        artistImages[key] = image
        image?.let { contentCache.putArtistImage(key, it) }
        return image
    }

    private suspend fun loadArtistPage(name: String, preferred: SourceId, preferredId: String?): ArtistPageUi = coroutineScope {
        val local = async { runCatching { loadMssArtist(name) }.getOrDefault(ArtistBundle()) }
        val yandex = async { runCatching { if (sourceConnected(SourceId.YANDEX)) loadYandexArtist(name, preferredId.takeIf { preferred == SourceId.YANDEX }) else null }.getOrNull() }
        val spotify = async { runCatching { if (sourceConnected(SourceId.SPOTIFY)) loadSpotifyArtist(name, preferredId.takeIf { preferred == SourceId.SPOTIFY }) else null }.getOrNull() }
        val vk = async { runCatching { if (sourceConnected(SourceId.VK)) loadVkArtist(name, preferredId.takeIf { preferred == SourceId.VK }) else null }.getOrNull() }
        val bundles = listOf(
            SourceId.LOCAL to local.await(),
            SourceId.YANDEX to (yandex.await() ?: ArtistBundle()),
            SourceId.SPOTIFY to (spotify.await() ?: ArtistBundle()),
            SourceId.VK to (vk.await() ?: ArtistBundle()),
        )
        val tracksBySource = bundles.associate { (src, bundle) -> src to bundle.tracks }.filterValues { it.isNotEmpty() }
        val artists = bundles.mapNotNull { it.second.artist }
        val image = artists.firstNotNullOfOrNull { it.imageUrl }
        val description = artists.firstNotNullOfOrNull { it.description?.takeIf { text -> text.isNotBlank() } }
        val genres = artists.flatMap { it.genres.orEmpty() }.distinct()
        val popularBySource = bundles
            .associate { (src, bundle) -> src to bundle.popular.ifEmpty { bundle.tracks }.take(10) }
            .filterValues { it.isNotEmpty() }
        val albumsBySource = bundles.associate { (src, bundle) -> src to bundle.albums }.filterValues { it.isNotEmpty() }
        ArtistPageUi(
            name = artists.firstOrNull()?.name ?: name,
            imageUrl = image,
            description = description,
            genres = genres,
            preferred = preferred,
            platforms = bundles.map { (src, bundle) ->
                ArtistPlatformUi(
                    source = src,
                    present = bundle.artist != null || bundle.tracks.isNotEmpty() || bundle.albums.isNotEmpty(),
                    followers = bundle.artist?.followers,
                    monthlyListeners = bundle.artist?.monthlyListeners,
                    trackCount = bundle.artist?.trackCount?.takeIf { it > bundle.tracks.size } ?: bundle.tracks.size,
                    imageUrl = bundle.artist?.imageUrl,
                    albumCount = bundle.albums.size,
                )
            },
            popularBySource = popularBySource,
            tracksBySource = tracksBySource,
            albumsBySource = albumsBySource,
            loading = false,
        )
    }

    private suspend fun loadMssArtist(name: String): ArtistBundle {
        val tracks = dedupeMssTracks(runCatching { repo.artistTracks(name) }.getOrDefault(emptyList()))
        val owned = runCatching { repo.albums(name) }.getOrDefault(emptyList())
            .filter { album ->
                album.artist.contains(name, ignoreCase = true) ||
                    splitArtistNames(album.artist).any { it.equals(name, ignoreCase = true) }
            }
        val albums = mergeMssAlbums(owned, tracks)
        if (tracks.isEmpty() && albums.isEmpty()) return ArtistBundle()
        val artist = UnifiedArtist(
            SourceId.LOCAL,
            name,
            name,
            imageUrl = tracks.firstNotNullOfOrNull { it.coverUrl } ?: albums.firstNotNullOfOrNull { it.coverUrl },
            trackCount = tracks.size,
        )
        return ArtistBundle(artist, tracks, tracks.take(10), albums)
    }

    private suspend fun loadYandexArtist(name: String, id: String?): ArtistBundle {
        val artistId = id ?: yandex.searchArtists(name, 8).firstOrNull { it.name.equals(name, true) }?.id
            ?: yandex.searchArtists(name, 8).firstOrNull()?.id
        if (artistId.isNullOrBlank()) return ArtistBundle()
        val profile = runCatching { yandex.artistProfile(artistId) }.getOrNull()
        val tracks = runCatching { yandex.artistTracks(artistId, 100) }.getOrDefault(emptyList())
            .ifEmpty { profile?.popularTracks.orEmpty() }
        return ArtistBundle(profile?.artist, tracks, profile?.popularTracks.orEmpty(), profile?.albums.orEmpty() + profile?.singles.orEmpty())
    }

    private suspend fun loadSpotifyArtist(name: String, id: String?): ArtistBundle {
        val artistId = id ?: spotify.searchArtists(name, 8).firstOrNull { it.name.equals(name, true) }?.id
            ?: spotify.searchArtists(name, 8).firstOrNull()?.id
        if (artistId.isNullOrBlank()) return ArtistBundle()
        val profile = runCatching { spotify.artistProfile(artistId) }.getOrNull()
        val tracks = runCatching { spotify.artistTracks(artistId, name) }.getOrDefault(emptyList())
        return ArtistBundle(
            profile?.artist,
            tracks,
            profile?.popularTracks?.ifEmpty { null } ?: tracks.take(10),
            profile?.albums.orEmpty() + profile?.singles.orEmpty(),
        )
    }

    private suspend fun loadVkArtist(name: String, id: String?): ArtistBundle {
        val tracks = runCatching { vk.artistTracks(id ?: name, name, 50) }.getOrDefault(emptyList())
        val artist = if (tracks.isEmpty()) null else UnifiedArtist(SourceId.VK, id ?: name, name, imageUrl = tracks.firstNotNullOfOrNull { it.coverUrl })
        return ArtistBundle(artist, tracks, tracks.take(5))
    }

    private suspend fun loadArtistTracks(source: SourceId, name: String, id: String?): List<UnifiedTrack> {
        if (source != SourceId.LOCAL) {
            val direct = loadArtistTracksFrom(source, name, id)
            if (direct.isNotEmpty()) return direct
        }
        return mergeArtistTracks(name, source.takeIf { it != SourceId.LOCAL }, id)
    }

    private suspend fun mergeArtistTracks(name: String, preferredSource: SourceId?, preferredId: String?): List<UnifiedTrack> {
        val out = mutableListOf<UnifiedTrack>()
        val seen = mutableSetOf<String>()
        fun add(list: List<UnifiedTrack>) {
            list.forEach { t ->
                if (seen.add("${t.source}:${t.id}")) out += t
            }
        }
        add(runCatching { repo.artistTracks(name) }.getOrDefault(emptyList()))
        val order = listOfNotNull(preferredSource, SourceId.SPOTIFY, SourceId.YANDEX, SourceId.VK).distinct()
        for (src in order) {
            if (!sourceConnected(src)) continue
            val id = preferredId.takeIf { preferredSource == src }
            add(loadArtistTracksFrom(src, name, id))
        }
        return out
    }

    private suspend fun loadArtistTracksFrom(source: SourceId, name: String, id: String?): List<UnifiedTrack> {
        fun matchName(artists: List<UnifiedArtist>) =
            artists.firstOrNull { it.name.equals(name, ignoreCase = true) } ?: artists.firstOrNull()
        return runCatching {
            when (source) {
                SourceId.SPOTIFY -> {
                    val artistId = id ?: matchName(spotify.searchArtists(name, 8))?.id
                    if (artistId.isNullOrBlank()) emptyList()
                    else spotify.artistTracks(artistId, name)
                }
                SourceId.YANDEX -> {
                    val artistId = id ?: matchName(yandex.searchArtists(name, 8))?.id
                    if (artistId.isNullOrBlank()) yandex.search(name, 40).filter { it.artist.contains(name, true) }
                    else yandex.artistTracks(artistId)
                }
                SourceId.VK -> vk.artistTracks(id ?: name, name, 50)
                else -> emptyList()
            }
        }.getOrDefault(emptyList())
    }

    private suspend fun loadAlbum(source: SourceId, idOrTitle: String): AlbumWithTracks? {
        if (source == SourceId.LOCAL) {
            loadMssAlbum(idOrTitle)?.let { return it }
        } else {
            albumById(source, idOrTitle)?.takeIf { it.tracks.isNotEmpty() }?.let { return it }
        }
        return findAlbumEverywhere(idOrTitle)
    }

    private suspend fun loadMssAlbum(idOrTitle: String): AlbumWithTracks? {
        runCatching { repo.album(idOrTitle) }.getOrNull()?.takeIf { it.tracks.isNotEmpty() || it.id == idOrTitle }?.let { return it }
        val matches: (UnifiedTrack) -> Boolean = {
            it.albumId == idOrTitle || it.album.equals(idOrTitle, ignoreCase = true)
        }
        val tracks = runCatching { repo.mssTracks(idOrTitle, 100) }.getOrDefault(emptyList()).filter(matches)
            .ifEmpty { runCatching { repo.mssTracks("", 100) }.getOrDefault(emptyList()).filter(matches) }
        if (tracks.isEmpty()) return null
        val seed = tracks.first()
        return AlbumWithTracks(
            source = SourceId.LOCAL,
            id = seed.albumId ?: idOrTitle,
            title = seed.album ?: idOrTitle,
            artist = seed.artist,
            coverUrl = seed.coverUrl,
            trackCount = tracks.size,
            tracks = tracks,
        )
    }

    /** Из сети с сохранением в кеш; без сети — сохранённая копия. */
    private suspend fun albumById(source: SourceId, id: String): AlbumWithTracks? {
        if (source == SourceId.LOCAL) return runCatching { repo.album(id) }.getOrNull()
        if (source != SourceId.YANDEX && source != SourceId.SPOTIFY) return null
        val fresh = runCatching {
            if (source == SourceId.YANDEX) yandex.album(id) else spotify.album(id)
        }.getOrNull()
        if (fresh != null && fresh.tracks.isNotEmpty()) {
            contentCache.putAlbum(source, id, fresh)
            return fresh
        }
        return contentCache.album(source, id) ?: fresh
    }

    private suspend fun findAlbumEverywhere(query: String): AlbumWithTracks? {
        val q = query.trim()
        if (q.isEmpty()) return null
        fun pick(list: List<UnifiedAlbum>): UnifiedAlbum? =
            list.firstOrNull { it.id == q || it.title.equals(q, true) } ?: list.firstOrNull()

        if (sourceConnected(SourceId.YANDEX)) {
            pick(runCatching { yandex.searchAlbums(q, 8) }.getOrDefault(emptyList()))
                ?.let { albumById(SourceId.YANDEX, it.id) }?.let { return it }
        }
        if (sourceConnected(SourceId.SPOTIFY)) {
            pick(runCatching { spotify.searchAlbums(q, 8) }.getOrDefault(emptyList()))
                ?.let { albumById(SourceId.SPOTIFY, it.id) }?.let { return it }
        }
        if (sourceConnected(SourceId.VK)) {
            val vkAlbums = runCatching { vk.searchAlbums(q, 8) }.getOrDefault(emptyList())
            pick(vkAlbums)?.let { hit ->
                val tracks = runCatching { vk.search("${hit.title} ${hit.artist}", 40) }
                    .getOrDefault(emptyList())
                    .filter { it.albumId == hit.id || it.album.equals(hit.title, true) }
                if (tracks.isNotEmpty()) {
                    return AlbumWithTracks(
                        SourceId.VK,
                        hit.id,
                        hit.title,
                        hit.artist,
                        coverUrl = hit.coverUrl,
                        tracks = tracks,
                    )
                }
            }
        }
        val tracks = runCatching { repo.searchAll(q, null, 30) }.getOrDefault(emptyList())
        val grouped = tracks.filter { it.albumId == q || it.album.equals(q, true) }
        val seed = grouped.firstOrNull() ?: tracks.firstOrNull { !it.album.isNullOrBlank() } ?: return null
        seed.albumId?.let { albumId ->
            albumById(seed.source, albumId)?.let { return it }
        }
        val sameAlbum = grouped.ifEmpty { tracks.filter { it.album.equals(seed.album, true) } }
        if (sameAlbum.isEmpty()) return null
        return AlbumWithTracks(
            source = seed.source,
            id = seed.albumId ?: q,
            title = seed.album ?: q,
            artist = seed.artist,
            coverUrl = seed.coverUrl,
            tracks = sameAlbum,
        )
    }

    private suspend fun searchAlbums(query: String, source: SourceId?): List<UnifiedAlbum> {
        val out = mutableListOf<UnifiedAlbum>()
        if ((source == null || source == SourceId.YANDEX) && sourceConnected(SourceId.YANDEX)) {
            out += runCatching { yandex.searchAlbums(query, 20) }.getOrDefault(emptyList())
        }
        if ((source == null || source == SourceId.SPOTIFY) && sourceConnected(SourceId.SPOTIFY)) {
            out += runCatching { spotify.searchAlbums(query, 20) }.getOrDefault(emptyList())
        }
        if ((source == null || source == SourceId.VK) && sourceConnected(SourceId.VK)) {
            out += runCatching { vk.searchAlbums(query, 20) }.getOrDefault(emptyList())
        }
        if (source == null || source == SourceId.LOCAL) {
            out += runCatching { repo.albums(query) }.getOrDefault(emptyList())
        }
        return out
    }

    private suspend fun searchArtists(query: String, source: SourceId?): List<UnifiedArtist> {
        val out = mutableListOf<UnifiedArtist>()
        if (source == null || source == SourceId.LOCAL) {
            out += runCatching {
                repo.artists(query).flatMap { dto ->
                    splitArtistNames(dto.name).map {
                        UnifiedArtist(SourceId.LOCAL, it, it, trackCount = dto.trackCount)
                    }
                }.distinctBy { it.name.lowercase() }
            }.getOrDefault(emptyList())
        }
        if ((source == null || source == SourceId.SPOTIFY) && sourceConnected(SourceId.SPOTIFY)) {
            out += runCatching { spotify.searchArtists(query, 20) }.getOrDefault(emptyList())
        }
        if ((source == null || source == SourceId.YANDEX) && sourceConnected(SourceId.YANDEX)) {
            out += runCatching { yandex.searchArtists(query, 20) }.getOrDefault(emptyList())
        }
        if ((source == null || source == SourceId.VK) && sourceConnected(SourceId.VK)) {
            out += runCatching { vk.searchArtists(query, 20) }.getOrDefault(emptyList())
        }
        return out
    }

    private suspend fun searchPlaylists(query: String, source: SourceId?): List<UnifiedPlaylist> {
        val out = mutableListOf<UnifiedPlaylist>()
        if (source == null || source == SourceId.LOCAL) {
            out += runCatching { repo.mssPlaylists().filter { it.title.contains(query, true) } }.getOrDefault(emptyList())
        }
        if ((source == null || source == SourceId.YANDEX) && sourceConnected(SourceId.YANDEX)) {
            out += runCatching { yandex.searchPlaylists(query) }.getOrDefault(emptyList())
        }
        if ((source == null || source == SourceId.SPOTIFY) && sourceConnected(SourceId.SPOTIFY)) {
            out += runCatching { spotify.listPlaylists().filter { it.title.contains(query, true) } }.getOrDefault(emptyList())
        }
        if ((source == null || source == SourceId.VK) && sourceConnected(SourceId.VK)) {
            out += runCatching { vk.listPlaylists().filter { it.title.contains(query, true) } }.getOrDefault(emptyList())
        }
        return out
    }

    private fun sourceConnected(source: SourceId): Boolean = when (source) {
        SourceId.LOCAL -> true
        SourceId.SPOTIFY -> spotify.authStatus() != AuthStatus.DISCONNECTED
        SourceId.YANDEX -> yandex.authStatus() != AuthStatus.DISCONNECTED
        SourceId.VK -> vk.authStatus() != AuthStatus.DISCONNECTED
    }

    fun createPlaylist(name: String) = launch {
        repo.createPlaylist(name.trim())
        reloadLibraryMssPlaylists()
    }

    fun deletePlaylist(id: String) = launch {
        repo.deletePlaylist(id)
        reloadLibraryMssPlaylists()
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
        val lib = _library.value
        if (lib.loaded) {
            val list = lib.likes[track.source].orEmpty().filterNot { it.id == track.id }
            val next = if (liked) list else listOf(track) + list
            _library.value = lib.copy(likes = lib.likes + (track.source to next))
        }
        if (track.source == SourceId.YANDEX && liked) yandex.dislike(track)
    }

    fun toggleAlbumLike(album: AlbumWithTracks) = toggleAlbumLike(album.toUnifiedAlbum())

    fun toggleAlbumLike(album: UnifiedAlbum) = launch {
        val liked = _likedAlbums.value.any { it.source == album.source && it.id == album.id }
        repo.toggleAlbumLike(album, !liked)
        _likedAlbums.value = if (liked) {
            _likedAlbums.value.filterNot { it.source == album.source && it.id == album.id }
        } else {
            listOf(album) + _likedAlbums.value.filterNot { it.source == album.source && it.id == album.id }
        }
        if (_library.value.loaded) {
            _library.value = _library.value.copy(likedAlbums = _likedAlbums.value)
        }
    }

    fun toggleArtistLike(name: String, imageUrl: String? = null, genres: List<String> = emptyList(), trackCount: Int = 0) {
        val artist = UnifiedArtist(
            source = SourceId.LOCAL,
            id = com.mss.core.model.localArtistLikeId(name),
            name = name,
            imageUrl = imageUrl,
            genres = genres.ifEmpty { null },
            trackCount = trackCount.takeIf { it > 0 },
        )
        toggleArtistLike(artist)
    }

    fun toggleArtistLike(artist: UnifiedArtist) = launch {
        val key = if (artist.source == SourceId.LOCAL) com.mss.core.model.localArtistLikeId(artist.name) else artist.id
        val liked = _likedArtists.value.any {
            it.source == artist.source && (it.id == key || it.id == artist.id || it.name.equals(artist.name, ignoreCase = true))
        }
        repo.toggleArtistLike(artist, !liked)
        _likedArtists.value = if (liked) {
            _likedArtists.value.filterNot {
                it.source == artist.source && (it.id == key || it.id == artist.id || it.name.equals(artist.name, ignoreCase = true))
            }
        } else {
            listOf(artist.copy(id = key)) + _likedArtists.value.filterNot {
                it.source == artist.source && (it.id == key || it.id == artist.id)
            }
        }
        if (_library.value.loaded) {
            _library.value = _library.value.copy(likedArtists = _likedArtists.value)
        }
    }

    private var yandexLoginJob: Job? = null

    fun connectYandex() {
        // Повторное нажатие не должно запускать второй опрос кода устройства поверх первого.
        if (yandexLoginJob?.isActive == true) return
        yandexLoginJob = viewModelScope.launch {
            runCatching {
                yandex.login { _yandexPrompt.value = it }
                sessionLog.info("auth", "yandex connected")
                refreshSources()
                loadHome()
            }.onFailure {
                sessionLog.error("auth", it.message ?: "yandex connect failed")
                _error.value = it.message
            }
            _yandexPrompt.value = null
        }
    }

    fun cancelYandexLogin() {
        yandex.cancelLogin()
        _yandexPrompt.value = null
    }

    fun showSpotifyLogin() {
        sessionLog.info("auth", "spotify login shown")
        spotifyWeb.showLogin()
    }

    fun openVkLogin() {
        vk.cancelLogin()
        vkPoll?.cancel()
        vkExchange?.cancel()
        _vkLogin.value = VkLoginUi(open = true, step = VkLoginStep.VKID, busy = true)
        vkPoll = viewModelScope.launch {
            try {
                val session = vk.beginKateWebLogin()
                if (!_vkLogin.value.open || _vkLogin.value.step != VkLoginStep.VKID) return@launch
                _vkLogin.value = _vkLogin.value.copy(
                    busy = false,
                    startUrl = session.startUrl,
                    confirmUrl = session.confirmUrl,
                    error = null,
                )
                while (isActive && _vkLogin.value.open && _vkLogin.value.step == VkLoginStep.VKID) {
                    if (vk.pollKateWebLogin()) {
                        sessionLog.info("auth", "vk connected")
                        _vkLogin.value = VkLoginUi()
                        refreshSources()
                        loadHome()
                        return@launch
                    }
                    delay(2_000)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                sessionLog.error("auth", e.message ?: "vk login failed")
                if (_vkLogin.value.open && _vkLogin.value.step == VkLoginStep.VKID) {
                    _vkLogin.value = _vkLogin.value.copy(busy = false, error = e.message)
                }
            }
        }
    }

    fun openVkIdLogin() = openVkLogin()

    fun closeVkLogin() {
        vkPoll?.cancel()
        vkPoll = null
        vkExchange?.cancel()
        vkExchange = null
        vk.cancelLogin()
        _vkLogin.value = VkLoginUi()
    }

    fun setVkMethod(sms: Boolean) {
        vkPoll?.cancel()
        vkPoll = null
        vk.cancelLogin()
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
        sessionLog.info("auth", "vk connected")
        _vkLogin.value = VkLoginUi()
        refreshSources()
        loadHome()
    }

    fun submitVkPassword(username: String, password: String, code: String? = null, captchaKey: String? = null) = launchVk {
        vk.loginWithPassword(username, password, code, captchaKey)
        sessionLog.info("auth", "vk connected")
        _vkLogin.value = VkLoginUi()
        refreshSources()
        loadHome()
    }

    fun completeVkId(url: String) {
        if (!VkAuth.shouldCompleteWebLogin(url)) return
        if (vkExchange?.isActive == true || _sources.value.vk != AuthStatus.DISCONNECTED) return
        vkExchange = launchVk {
            vk.completeWebLogin(url)
            vkPoll?.cancel()
            sessionLog.info("auth", "vk connected")
            _vkLogin.value = VkLoginUi()
            refreshSources()
            loadHome()
        }
    }

    private fun launchVk(block: suspend () -> Unit): Job {
        return viewModelScope.launch {
            _vkLogin.value = _vkLogin.value.copy(busy = true, error = null)
            runCatching { block() }.onFailure { e ->
                sessionLog.error("auth", e.message ?: "vk login failed")
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

    fun loadStats(period: String = "month", year: Int? = null) {
        statsJob?.cancel()
        statsJob = viewModelScope.launch {
            _statsError.value = null
            try {
                _stats.value = repo.stats(period, year)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _statsError.value = e.message ?: "Не удалось загрузить статистику"
            }
        }
    }

    fun loadSubscription() = launch { _subscription.value = repo.subscription() }

    fun startWave(settings: WaveSettings = WaveSettings()) = launch {
        val batch = yandex.waveStart(settings)
        if (batch.tracks.isEmpty()) error("Волна не вернула треки")
        player.setWaveSession(batch.sessionId, batch.batchId)
        play(batch.tracks, radio = true)
    }

    fun loadSimilar(track: UnifiedTrack) = launch {
        val list = similarTracks(track)
        _similar.value = list
        _tracks.value = list
        _detailTitle.value = "Похожие"
    }

    private suspend fun similarTracks(track: UnifiedTrack): List<UnifiedTrack> {
        val direct = when (track.source) {
            SourceId.YANDEX -> runCatching { yandex.similarTracks(track.id) }.getOrDefault(emptyList())
            SourceId.SPOTIFY -> runCatching { spotify.trackRadio(track).tracks.filter { it.id != track.id } }.getOrDefault(emptyList())
            else -> emptyList()
        }
        if (direct.isNotEmpty()) return direct
        val q = listOf(track.title, track.artist).filter { it.isNotBlank() }.joinToString(" ")
        if (q.isBlank()) return emptyList()
        return runCatching { repo.searchAll(q, null, 30) }.getOrDefault(emptyList()).filter { it.id != track.id }
    }

    fun loadLyrics(track: UnifiedTrack) {
        val key = "${track.source}:${track.id}"
        _lyrics.value = LyricsUi(key = key, source = track.source, loading = true)
        viewModelScope.launch {
            val sidecar = if (track.source == SourceId.LOCAL) localTracks.lyrics(track.id) else null
            val downloaded = sidecar ?: downloads.lyricsSidecar(track)
            val cached = if (downloaded == null) contentCache.lyrics(track.source, track.id) else null
            val result = when {
                downloaded != null -> Result.success(downloaded)
                cached != null -> Result.success(cached)
                else -> runCatching {
                    when (track.source) {
                        SourceId.YANDEX -> yandex.lyrics(track.id)
                        SourceId.SPOTIFY -> spotify.lyrics(track.id)
                        SourceId.LOCAL -> repo.trackLyrics(track.id)
                        else -> null
                    }
                }
            }
            if (downloaded == null && cached == null) result.getOrNull()?.let { contentCache.putLyrics(track.source, track.id, it) }
            result.getOrNull()?.let { lyrics -> downloads.persistSidecar(track, lyrics) }
            if (_lyrics.value.key != key) return@launch
            _lyrics.value = result.fold(
                onSuccess = { LyricsUi(key = key, source = track.source, data = it) },
                onFailure = { LyricsUi(key = key, source = track.source, failed = true) },
            )
        }
    }

    fun download(track: UnifiedTrack) = launch {
        enqueueDownload(track)
        _notice.value = "Скачиваем «${track.title}»"
    }

    fun downloadAlbum(album: AlbumWithTracks) = launch {
        val tracks = album.tracks.filter { it.playable }
        if (tracks.isEmpty()) error("В альбоме нет треков для скачивания")
        downloads.saveAlbum(album)
        val have = downloadedKeys.value + activeDownloads.value
        var failed = 0
        var lastError: String? = null
        tracks.filter { DownloadScheduler.keyOf(it) !in have }.forEach { t ->
            runCatching { enqueueDownload(t) }.onFailure { failed++; lastError = it.message }
        }
        _notice.value = if (failed == 0) {
            "Скачиваем альбом «${album.title}»"
        } else {
            "Альбом скачивается, но $failed из ${tracks.size} треков не получится скачать: $lastError"
        }
    }

    fun removeAlbumDownload(album: AlbumWithTracks) {
        album.tracks.forEach { downloads.remove(DownloadScheduler.keyOf(it)) }
        downloads.removeAlbum(album)
    }

    private suspend fun enqueueDownload(track: UnifiedTrack) {
        when (track.source) {
            SourceId.LOCAL -> {
                val uri = localTracks.get(track.id)?.uri?.let(Uri::parse)
                if (uri != null) {
                    downloads.enqueueLocalCopy(uri, track)
                    return
                }
                val cloud = repo.resolveCloudDownloadUrl(track)
                if (cloud != null) {
                    val name = "${track.artist} - ${track.title}".replace(Regex("[^\\wа-яА-ЯёЁ .-]+"), "_")
                    downloads.enqueue(cloud, "${name.take(80)}.bin", track)
                    return
                }
                error("Нет файла для скачивания")
            }
            SourceId.YANDEX -> downloads.enqueueYandex(track)
            SourceId.VK -> {
                val url = track.streamUrl?.takeIf { it.isNotBlank() } ?: vk.resolvePlaybackUrl(track)
                if (".m3u8" in url) error("Этот трек VK отдаётся потоком — скачать его на телефоне нельзя")
                downloads.enqueue(url, "vk_${track.id.replace(Regex("[^A-Za-z0-9_-]"), "_")}.mp3", track)
            }
            SourceId.SPOTIFY -> downloads.enqueueSpotify(track)
        }
    }

    fun removeDownload(key: String) = downloads.remove(key)

    fun removeDownload(track: UnifiedTrack) = downloads.remove(DownloadScheduler.keyOf(track))

    fun playNext(track: UnifiedTrack) = player.playNext(track)

    fun enqueueMany(tracks: List<UnifiedTrack>) {
        player.enqueue(tracks)
        _notice.value = if (tracks.size == 1) "Добавлено в очередь" else "В очередь: ${tracks.size}"
    }

    fun deleteUploads(tracks: List<UnifiedTrack>) = launch {
        if (tracks.isEmpty()) return@launch
        val ids = tracks.map { it.id }
        var failed = 0
        ids.forEach { id -> runCatching { repo.deleteTrack(id) }.onFailure { failed++ } }
        refreshLibraryUploads()
        _notice.value = when {
            failed == ids.size -> "Не удалось удалить"
            failed > 0 -> "Удалено ${ids.size - failed} из ${ids.size}"
            ids.size == 1 -> "«${tracks[0].title}» удалён"
            else -> "Удалено: ${ids.size}"
        }
    }

    fun dislike(track: UnifiedTrack) = launch {
        yandex.dislike(track)
        _likedIds.value = _likedIds.value - track.id
        _notice.value = "Трек не будет попадать в рекомендации"
    }

    fun loadPickerPlaylists() = launch { _pickerPlaylists.value = repo.mssPlaylists() }

    fun addToPlaylist(playlist: UnifiedPlaylist, track: UnifiedTrack) = launch {
        repo.addToPlaylist(playlist.id, track)
        _notice.value = "Добавлено в «${playlist.title}»"
    }

    fun createPlaylistWith(name: String, track: UnifiedTrack) = launch {
        val playlist = repo.createPlaylist(name.trim())
        repo.addToPlaylist(playlist.id, track)
        _notice.value = "Добавлено в «${playlist.title}»"
        reloadLibraryMssPlaylists()
    }

    fun registerUpload(uri: Uri, title: String, artist: String) = launch {
        repo.registerLocalFile(uri, title, artist)
        reloadLibraryUploads()
    }

    fun registerUploadAlbum(uris: List<Uri>, title: String, artist: String, coverUri: Uri? = null) = launch {
        repo.registerLocalAlbum(uris, title, artist, coverUri)
        refreshLibraryUploads()
        _notice.value = "Альбом «$title» сохранён"
    }

    fun deleteAlbum(id: String) = launch {
        repo.deleteAlbum(id)
        _likedAlbums.value = _likedAlbums.value.filterNot { it.source == SourceId.LOCAL && it.id == id }
        refreshLibraryUploads()
        if (_albumPage.value.album?.source == SourceId.LOCAL && _albumPage.value.album?.id == id) {
            _albumPage.value = AlbumPageUi(loading = false, error = "Альбом удалён")
        }
        _notice.value = "Альбом удалён"
    }

    fun setAlbumCover(id: String, uri: Uri) = launch {
        repo.setAlbumCover(id, uri)
        refreshLibraryUploads()
        if (_albumPage.value.album?.id == id) {
            runCatching { repo.album(id) }.getOrNull()?.let { showAlbum(it) }
        }
        _notice.value = "Обложка обновлена"
    }

    fun publishAlbumToMss(album: AlbumWithTracks) = launch {
        ensurePublishFiles(album.tracks)
        val extra = extraPublishFiles(album.tracks)
        val result = repo.publishAlbumToMss(album, extra)
        refreshLibraryUploads()
        runCatching { repo.album(result.albumId) }.getOrNull()?.let { showAlbum(it) }
        _notice.value = if (result.uploaded > 0 || result.createdAlbum) {
            "Отправлено на сервер MSS"
        } else {
            "Альбом уже на сервере MSS"
        }
    }

    fun publishTracksToMss(tracks: List<UnifiedTrack>) = launch {
        ensurePublishFiles(tracks)
        val result = repo.publishTracksToMss(tracks, extraPublishFiles(tracks))
        refreshLibraryUploads()
        _notice.value = if (result.uploaded > 0) "Отправлено на сервер MSS" else "Уже на сервере MSS"
    }

    private suspend fun ensurePublishFiles(tracks: List<UnifiedTrack>) {
        for (track in tracks) {
            if (downloads.fileFor(track) != null) continue
            if (track.source == SourceId.LOCAL) continue
            runCatching { enqueueDownload(track) }
        }
        val deadline = System.currentTimeMillis() + 180_000
        while (System.currentTimeMillis() < deadline) {
            val waiting = tracks.any { t ->
                t.source != SourceId.LOCAL &&
                    downloads.fileFor(t) == null &&
                    DownloadScheduler.keyOf(t) in downloads.active.value
            }
            if (!waiting) break
            delay(500)
        }
    }

    private fun extraPublishFiles(tracks: List<UnifiedTrack>): Map<String, Uri> =
        buildMap {
            for (track in tracks) {
                val file = downloads.fileFor(track) ?: continue
                val uri = Uri.fromFile(file)
                put(track.id, uri)
                put("${track.source}:${track.id}", uri)
            }
        }

    fun removeDownloads(tracks: List<UnifiedTrack>) {
        tracks.forEach { downloads.remove(DownloadScheduler.keyOf(it)) }
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
        sessionLog.info("auth", "disconnect $source")
        refreshSources()
    }

    fun applyDeepLink(url: String) {
        val action = parseMssLink(url) ?: return
        action.libraryTab?.let { _libraryTab.value = it }
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
        val decoded = java.net.URLDecoder.decode(id, Charsets.UTF_8)
        val sid = sourceFrom(source)
        resolveTrack(sid, decoded)?.let { play(listOf(it)); return }
        resolveTrackEverywhere(decoded)?.let { play(listOf(it)); return }
        error("Трек не найден")
    }

    private suspend fun resolveTrack(source: SourceId, id: String): UnifiedTrack? = runCatching {
        when (source) {
            SourceId.LOCAL -> repo.getTrack(id)
            SourceId.YANDEX -> yandex.tracksByIds(listOf(id)).firstOrNull()
            SourceId.SPOTIFY -> {
                if (!sourceConnected(SourceId.SPOTIFY)) null
                else spotify.search(id, 8).firstOrNull { it.id == id }
                    ?: UnifiedTrack(SourceId.SPOTIFY, id, id, "Spotify").takeIf { id.length >= 16 }
            }
            SourceId.VK -> {
                if (!sourceConnected(SourceId.VK)) null
                else vk.search(id, 8).firstOrNull { it.id == id || it.id.contains(id) }
            }
        }
    }.getOrNull()

    private suspend fun resolveTrackEverywhere(query: String): UnifiedTrack? {
        val all = runCatching { repo.searchAll(query, null, 20) }.getOrDefault(emptyList())
        return all.firstOrNull { it.id == query || it.title.equals(query, true) } ?: all.firstOrNull()
    }

    private fun loadLikesIds() {
        viewModelScope.launch {
            runCatching { _likedIds.value = repo.mssLikes().map { it.id }.toSet() }
            runCatching { repo.likedAlbums() }.getOrNull()?.let {
                _likedAlbums.value = it
                if (_library.value.loaded) {
                    _library.value = _library.value.copy(likedAlbums = it)
                }
            }
            runCatching { repo.likedArtists() }.getOrNull()?.let {
                _likedArtists.value = it
                if (_library.value.loaded) {
                    _library.value = _library.value.copy(likedArtists = it)
                }
            }
        }
    }

    private fun launch(block: suspend () -> Unit) {
        viewModelScope.launch {
            _error.value = null
            _notice.value = null
            runCatching { block() }.onFailure { e ->
                if (session.value?.accessToken == "preview") return@launch
                _error.value = e.message
                val category = when {
                    e is ConnectorException -> "connector"
                    looksLikeAuthError(e) -> "auth"
                    else -> "app"
                }
                sessionLog.error(category, e.message ?: e.javaClass.simpleName)
                // Коннектор мог сам сбросить протухшую сессию — иначе сервис остался бы «подключённым».
                if (looksLikeAuthError(e)) refreshSources()
            }
        }
    }

    private fun looksLikeAuthError(e: Throwable): Boolean {
        val text = e.message?.lowercase() ?: return false
        return AUTH_ERROR_HINTS.any { it in text }
    }

    fun clearError() { _error.value = null }
    fun clearNotice() { _notice.value = null }
}

private val AUTH_ERROR_HINTS = listOf("войдите", "сессия", "не подключ", "unauthorized", "токен")
private val LIBRARY_SOURCES = listOf(SourceId.LOCAL, SourceId.YANDEX, SourceId.SPOTIFY, SourceId.VK)
private const val LIBRARY_LIKES_LIMIT = 300

enum class LibraryTab(val title: String, val inBar: Boolean = false) {
    COLLECTION("Коллекция", true),
    DOWNLOADS("Скачанное", true),
    UPLOADS("Мои файлы", true),
    HISTORY("История", true),
    TRACKS("Треки"),
    PLAYLISTS("Плейлисты"),
    ARTISTS("Исполнители"),
    ALBUMS("Альбомы"),
}

val LibraryTab.barTab: LibraryTab get() = if (inBar) this else LibraryTab.COLLECTION

data class LibraryUi(
    val likes: Map<SourceId, List<UnifiedTrack>> = emptyMap(),
    val playlists: Map<SourceId, List<UnifiedPlaylist>> = emptyMap(),
    val uploads: List<UnifiedTrack> = emptyList(),
    val albums: List<UnifiedAlbum> = emptyList(),
    val likedAlbums: List<UnifiedAlbum> = emptyList(),
    val likedArtists: List<UnifiedArtist> = emptyList(),
    val connected: List<SourceId> = listOf(SourceId.LOCAL),
    val errors: Map<SourceId, String> = emptyMap(),
    val loading: Boolean = false,
    val loaded: Boolean = false,
)

data class LyricsUi(
    val key: String = "",
    val source: SourceId? = null,
    val loading: Boolean = false,
    val failed: Boolean = false,
    val data: TrackLyrics? = null,
)

data class ArtistBundle(
    val artist: UnifiedArtist? = null,
    val tracks: List<UnifiedTrack> = emptyList(),
    val popular: List<UnifiedTrack> = emptyList(),
    val albums: List<UnifiedAlbum> = emptyList(),
)

data class ArtistPlatformUi(
    val source: SourceId,
    val present: Boolean,
    val followers: Int? = null,
    val monthlyListeners: Int? = null,
    val trackCount: Int = 0,
    val imageUrl: String? = null,
    val albumCount: Int = 0,
)

data class ArtistPageUi(
    val name: String = "",
    val imageUrl: String? = null,
    val description: String? = null,
    val genres: List<String> = emptyList(),
    val preferred: SourceId = SourceId.LOCAL,
    val platforms: List<ArtistPlatformUi> = emptyList(),
    val popularBySource: Map<SourceId, List<UnifiedTrack>> = emptyMap(),
    val tracksBySource: Map<SourceId, List<UnifiedTrack>> = emptyMap(),
    val albumsBySource: Map<SourceId, List<UnifiedAlbum>> = emptyMap(),
    val loading: Boolean = false,
)

data class AlbumPageUi(
    val album: AlbumWithTracks? = null,
    val loading: Boolean = false,
    val error: String? = null,
    /** Этот же релиз на других площадках, включая текущую. */
    val platforms: List<UnifiedAlbum> = emptyList(),
    val platformsLoading: Boolean = false,
    val switching: SourceId? = null,
)

private fun AlbumWithTracks.toUnifiedAlbum() = UnifiedAlbum(
    source = source,
    id = id,
    title = title,
    artist = artist,
    artists = artists,
    year = year,
    coverUrl = coverUrl,
    trackCount = trackCount ?: tracks.size.takeIf { it > 0 },
    type = type,
    genre = genre,
)

private val BRACKETS = Regex("""\s*[(\[][^)\]]*[)\]]""")
private val EDITION_SUFFIX = Regex("""\s+[-–—]\s+.*\b(remaster\w*|deluxe|edition|version|expanded|anniversary)\b.*$""", RegexOption.IGNORE_CASE)
private val NON_ALNUM = Regex("""[^\p{L}\p{N}]+""")

private fun normAlbumTitle(s: String) = s.lowercase().replace(BRACKETS, "").replace(EDITION_SUFFIX, "").replace(NON_ALNUM, "")

private fun normName(s: String) = s.lowercase().replace(NON_ALNUM, "")

/** Один и тот же релиз: названия совпадают без пометок вроде «(Deluxe)», исполнитель пересекается. */
internal fun sameAlbum(title: String, artist: String, targetTitle: String, targetArtist: String): Boolean {
    val t = normAlbumTitle(title)
    if (t.isEmpty() || t != normAlbumTitle(targetTitle)) return false
    val a = normName(artist)
    val b = normName(targetArtist)
    if (a.isEmpty() || b.isEmpty()) return true
    return a.contains(b) || b.contains(a)
}

private fun mergeHomeTracks(vararg lists: List<UnifiedTrack>): List<UnifiedTrack> {
    val seen = linkedSetOf<String>()
    val out = mutableListOf<UnifiedTrack>()
    lists.forEach { list ->
        list.forEach { track ->
            if (seen.add("${track.source}:${track.id}")) out += track
        }
    }
    return out.take(60)
}

private fun mergeHomePlaylists(vararg lists: List<UnifiedPlaylist>): List<UnifiedPlaylist> {
    val seen = linkedSetOf<String>()
    val out = mutableListOf<UnifiedPlaylist>()
    lists.forEach { list ->
        list.forEach { playlist ->
            if (seen.add("${playlist.source}:${playlist.id}")) out += playlist
        }
    }
    return out.take(24)
}

private fun HomeShelves.onlySource(source: SourceId) = copy(
    frequent = frequent.filter { it.source == source },
    forgotten = forgotten.filter { it.source == source },
    topArtists = topArtists.filter { it.source == source },
)

private fun HomeShelves.onlyLocal() = onlySource(SourceId.LOCAL)

private fun splitArtistNames(raw: String): List<String> {
    val parts = raw.split(Regex("""\s*(?:,|&|\sfeat\.?\s|\sft\.?\s)\s*""", RegexOption.IGNORE_CASE))
        .map { it.trim() }
        .filter { it.isNotBlank() }
    return parts.ifEmpty { listOfNotNull(raw.trim().takeIf { it.isNotBlank() }) }
}

private fun mssCatalogArtists(dtos: List<CatalogArtistDto>, tracks: List<UnifiedTrack>): List<UnifiedArtist> {
    data class Acc(var name: String, var count: Int, var cover: String?)
    val map = linkedMapOf<String, Acc>()
    fun add(name: String, count: Int, cover: String?) {
        val key = name.lowercase()
        val cur = map[key]
        if (cur == null) map[key] = Acc(name, count, cover)
        else {
            if (count > cur.count) cur.count = count
            if (cur.cover == null) cur.cover = cover
        }
    }
    if (dtos.isNotEmpty()) {
        dtos.forEach { dto -> splitArtistNames(dto.name).forEach { add(it, dto.trackCount, null) } }
        tracks.forEach { t -> splitArtistNames(t.artist).forEach { add(it, 0, t.coverUrl) } }
    } else {
        tracks.forEach { t ->
            splitArtistNames(t.artist).forEach { name ->
                val key = name.lowercase()
                val cur = map[key]
                if (cur == null) map[key] = Acc(name, 1, t.coverUrl)
                else {
                    cur.count += 1
                    if (cur.cover == null) cur.cover = t.coverUrl
                }
            }
        }
    }
    return map.values
        .sortedByDescending { it.count }
        .map { UnifiedArtist(SourceId.LOCAL, it.name, it.name, imageUrl = it.cover, trackCount = it.count.takeIf { n -> n > 0 }) }
}

private fun foldArtistText(value: String): String =
    value.trim().lowercase().replace('ё', 'е').replace(Regex("\\s+"), " ")

private fun sameMssTrack(a: UnifiedTrack, b: UnifiedTrack): Boolean {
    if (a.id == b.id) return true
    val ha = a.contentHash?.lowercase()
    val hb = b.contentHash?.lowercase()
    if (!ha.isNullOrBlank() && ha == hb) return true
    val durationOk = a.durationMs == null || b.durationMs == null ||
        kotlin.math.abs((a.durationMs ?: 0) - (b.durationMs ?: 0)) <= 8000
    return foldArtistText(a.title) == foldArtistText(b.title) &&
        foldArtistText(a.artist) == foldArtistText(b.artist) &&
        durationOk
}

private fun rankMssTrack(track: UnifiedTrack): Int =
    (if (!track.coverUrl.isNullOrBlank()) 4 else 0) +
        (if (track.userHolds == true) 2 else 0) +
        (if (track.availability == "cached" || track.availability == "online") 1 else 0)

private fun dedupeMssTracks(tracks: List<UnifiedTrack>): List<UnifiedTrack> {
    val out = mutableListOf<UnifiedTrack>()
    for (track in tracks) {
        val idx = out.indexOfFirst { sameMssTrack(it, track) }
        if (idx < 0) out += track
        else if (rankMssTrack(track) > rankMssTrack(out[idx])) out[idx] = track
    }
    return out
}

private fun albumsFromTracks(tracks: List<UnifiedTrack>): List<UnifiedAlbum> {
    val seen = linkedMapOf<String, UnifiedAlbum>()
    tracks.forEach { t ->
        val title = t.album?.trim()?.takeIf { it.isNotBlank() } ?: return@forEach
        val id = t.albumId?.takeIf { it.isNotBlank() } ?: title
        val key = t.albumId?.takeIf { it.isNotBlank() } ?: "${t.artist.lowercase()}::$title".lowercase()
        val cur = seen[key]
        if (cur == null) {
            seen[key] = UnifiedAlbum(SourceId.LOCAL, id, title, t.artist, coverUrl = t.coverUrl, trackCount = 1)
        } else {
            seen[key] = cur.copy(
                trackCount = (cur.trackCount ?: 1) + 1,
                coverUrl = cur.coverUrl ?: t.coverUrl,
            )
        }
    }
    return seen.values.toList()
}

private fun mergeMssAlbums(owned: List<UnifiedAlbum>, tracks: List<UnifiedTrack>): List<UnifiedAlbum> {
    val extra = albumsFromTracks(tracks)
    val ownedIds = owned.map { it.id }.toSet()
    val ownedKeys = owned.map { "${it.artist.lowercase()}::${it.title.lowercase()}" }.toSet()
    return owned + extra.filter { album ->
        album.id !in ownedIds && "${album.artist.lowercase()}::${album.title.lowercase()}" !in ownedKeys
    }
}

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
    val startUrl: String? = null,
    val confirmUrl: String? = null,
)
