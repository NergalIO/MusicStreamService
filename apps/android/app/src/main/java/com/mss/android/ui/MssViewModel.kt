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
import com.mss.core.model.DeviceCodePrompt
import com.mss.core.model.FeedBlock
import com.mss.core.model.HomeShelves
import com.mss.core.model.ListeningStats
import com.mss.core.model.PlaybackSettings
import com.mss.core.model.AlbumWithTracks
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
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
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
    private val _lyrics = MutableStateFlow(LyricsUi())
    val lyrics: StateFlow<LyricsUi> = _lyrics
    private val _yandexPrompt = MutableStateFlow<DeviceCodePrompt?>(null)
    val yandexPrompt: StateFlow<DeviceCodePrompt?> = _yandexPrompt
    private val _homeSource = MutableStateFlow(SourceId.LOCAL)
    val homeSource: StateFlow<SourceId> = _homeSource
    private val _detailTitle = MutableStateFlow("")
    val detailTitle: StateFlow<String> = _detailTitle
    private val _artistPage = MutableStateFlow(ArtistPageUi())
    val artistPage: StateFlow<ArtistPageUi> = _artistPage
    private val _albumPage = MutableStateFlow(AlbumPageUi())
    val albumPage: StateFlow<AlbumPageUi> = _albumPage
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
    private val _library = MutableStateFlow(LibraryUi())
    val library: StateFlow<LibraryUi> = _library
    private val _libraryTab = MutableStateFlow(LibraryTab.TRACKS)
    val libraryTab: StateFlow<LibraryTab> = _libraryTab
    private val _librarySource = MutableStateFlow<SourceId?>(null)
    val librarySource: StateFlow<SourceId?> = _librarySource
    val playHistory = repo.prefs.playHistory.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    private var vkExchange: Job? = null

    init {
        refreshSources()
        viewModelScope.launch { spotifyWeb.loggedIn.collect { refreshSources() } }
        player.onToggleLike = {
            player.state.value.current?.let { toggleLike(it) }
        }
        player.onError = { _error.value = it }
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
            val (perSource, uploads) = coroutineScope {
                val uploads = async { runCatching { repo.uploads() } }
                val perSource = connected.map { src ->
                    async { Triple(src, runCatching { libraryLikes(src) }, runCatching { libraryPlaylists(src) }) }
                }.awaitAll()
                perSource to uploads.await()
            }
            val errors = perSource.mapNotNull { (src, likes, playlists) ->
                (likes.exceptionOrNull() ?: playlists.exceptionOrNull())?.let { src to (it.message ?: "Не удалось загрузить") }
            }.toMap()
            val likes = perSource.associate { (src, result, _) -> src to result.getOrDefault(emptyList()) }
            _library.value = LibraryUi(
                likes = likes,
                playlists = perSource.associate { (src, _, result) -> src to result.getOrDefault(emptyList()) },
                uploads = uploads.getOrDefault(_library.value.uploads),
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

    private fun reloadLibraryUploads() = launch {
        val uploads = repo.uploads()
        _library.value = _library.value.copy(uploads = uploads)
    }

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

    fun openAlbum(source: String, id: String) {
        val decoded = java.net.URLDecoder.decode(id, Charsets.UTF_8)
        _albumPage.value = AlbumPageUi(loading = true)
        viewModelScope.launch {
            val album = runCatching { loadAlbum(sourceFrom(source), decoded) }.getOrNull()
            _albumPage.value = AlbumPageUi(album = album, loading = false, error = if (album == null) "Альбом не найден" else null)
            _detailTitle.value = album?.title ?: decoded
            _tracks.value = album?.tracks.orEmpty()
        }
    }

    fun openArtist(name: String, source: String = "local", id: String = "-") {
        val decodedName = java.net.URLDecoder.decode(name, Charsets.UTF_8)
        val decodedId = java.net.URLDecoder.decode(id, Charsets.UTF_8).takeIf { it.isNotBlank() && it != "-" }
        val preferred = sourceFrom(source)
        _detailTitle.value = decodedName
        _artistPage.value = ArtistPageUi(name = decodedName, loading = true)
        viewModelScope.launch {
            val page = loadArtistPage(decodedName, preferred, decodedId)
            if (_artistPage.value.name != decodedName) return@launch
            _artistPage.value = page
            _tracks.value = page.tracksBySource.values.flatten()
        }
    }

    private suspend fun loadArtistPage(name: String, preferred: SourceId, preferredId: String?): ArtistPageUi = coroutineScope {
        val local = async { runCatching { repo.artistTracks(name) }.getOrDefault(emptyList()) }
        val yandex = async { runCatching { if (sourceConnected(SourceId.YANDEX)) loadYandexArtist(name, preferredId.takeIf { preferred == SourceId.YANDEX }) else null }.getOrNull() }
        val spotify = async { runCatching { if (sourceConnected(SourceId.SPOTIFY)) loadSpotifyArtist(name, preferredId.takeIf { preferred == SourceId.SPOTIFY }) else null }.getOrNull() }
        val vk = async { runCatching { if (sourceConnected(SourceId.VK)) loadVkArtist(name, preferredId.takeIf { preferred == SourceId.VK }) else null }.getOrNull() }
        val bundles = listOf(
            SourceId.LOCAL to ArtistBundle(tracks = local.await()),
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
            .filter { it.first != SourceId.LOCAL }
            .associate { (src, bundle) -> src to bundle.popular.ifEmpty { bundle.tracks }.take(10) }
            .filterValues { it.isNotEmpty() }
        val albumsBySource = bundles.associate { (src, bundle) -> src to bundle.albums }.filterValues { it.isNotEmpty() }
        ArtistPageUi(
            name = artists.firstOrNull()?.name ?: name,
            imageUrl = image,
            description = description,
            genres = genres,
            platforms = bundles.map { (src, bundle) ->
                ArtistPlatformUi(
                    source = src,
                    present = bundle.artist != null || bundle.tracks.isNotEmpty(),
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
        if (source != SourceId.LOCAL) {
            albumById(source, idOrTitle)?.takeIf { it.tracks.isNotEmpty() }?.let { return it }
        }
        return findAlbumEverywhere(idOrTitle)
    }

    private suspend fun albumById(source: SourceId, id: String): AlbumWithTracks? = runCatching {
        when (source) {
            SourceId.YANDEX -> yandex.album(id)
            SourceId.SPOTIFY -> spotify.album(id)
            else -> null
        }
    }.getOrNull()

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
            val tracks = runCatching { repo.mssTracks(query, 30) }.getOrDefault(emptyList())
            val seen = linkedMapOf<String, UnifiedAlbum>()
            tracks.forEach { t ->
                val title = t.album ?: return@forEach
                val id = t.albumId ?: title
                if (id !in seen) seen[id] = UnifiedAlbum(SourceId.LOCAL, id, title, t.artist, coverUrl = t.coverUrl)
            }
            out += seen.values
        }
        return out
    }

    private suspend fun searchArtists(query: String, source: SourceId?): List<UnifiedArtist> {
        val out = mutableListOf<UnifiedArtist>()
        if (source == null || source == SourceId.LOCAL) {
            out += runCatching { repo.artists(query).map { UnifiedArtist(SourceId.LOCAL, it.name, it.name) } }
                .getOrDefault(emptyList())
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
        _vkLogin.value = VkLoginUi(open = true, step = VkLoginStep.VKID)
    }

    fun openVkIdLogin() = openVkLogin()

    fun closeVkLogin() {
        vk.cancelLogin()
        _vkLogin.value = VkLoginUi()
    }

    fun setVkMethod(sms: Boolean) {
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
        if (vkExchange?.isActive == true || _sources.value.vk != AuthStatus.DISCONNECTED) return
        vkExchange = launchVk {
            vk.completeWebLogin(url)
            _vkLogin.value = VkLoginUi()
            refreshSources()
            loadHome()
        }
    }

    private fun launchVk(block: suspend () -> Unit): Job {
        return viewModelScope.launch {
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
        reloadLibraryUploads()
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

private val LIBRARY_SOURCES = listOf(SourceId.LOCAL, SourceId.YANDEX, SourceId.SPOTIFY, SourceId.VK)
private const val LIBRARY_LIKES_LIMIT = 300

enum class LibraryTab(val title: String) {
    TRACKS("Треки"),
    PLAYLISTS("Плейлисты"),
    ARTISTS("Исполнители"),
    ALBUMS("Альбомы"),
    DOWNLOADS("Скачанное"),
    UPLOADS("Мои файлы"),
    HISTORY("История"),
}

data class LibraryUi(
    val likes: Map<SourceId, List<UnifiedTrack>> = emptyMap(),
    val playlists: Map<SourceId, List<UnifiedPlaylist>> = emptyMap(),
    val uploads: List<UnifiedTrack> = emptyList(),
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
