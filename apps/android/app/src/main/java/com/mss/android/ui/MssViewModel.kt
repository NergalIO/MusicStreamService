package com.mss.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mss.android.data.MssRepository
import com.mss.core.downloads.DownloadScheduler
import com.mss.core.connectors.PlaybackResolver
import com.mss.core.connectors.SpotifyConnector
import com.mss.core.connectors.YandexConnector
import com.mss.core.model.SourceId
import com.mss.core.model.UnifiedPlaylist
import com.mss.core.model.ListeningStats
import com.mss.core.model.UnifiedTrack
import com.mss.core.model.UserSubscriptionDto
import com.mss.core.player.PlayerController
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

@HiltViewModel
class MssViewModel @Inject constructor(
    private val repo: MssRepository,
    private val player: PlayerController,
    private val spotify: SpotifyConnector,
    private val yandex: YandexConnector,
    private val playback: PlaybackResolver,
    private val downloads: DownloadScheduler,
) : ViewModel() {
    val session = repo.session.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val playerState = player.state.stateIn(viewModelScope, SharingStarted.Eagerly, player.state.value)

    private val _tracks = MutableStateFlow<List<UnifiedTrack>>(emptyList())
    val tracks: StateFlow<List<UnifiedTrack>> = _tracks

    private val _playlists = MutableStateFlow<List<UnifiedPlaylist>>(emptyList())
    val playlists: StateFlow<List<UnifiedPlaylist>> = _playlists

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    private val _stats = MutableStateFlow<ListeningStats?>(null)
    val stats: StateFlow<ListeningStats?> = _stats

    private val _subscription = MutableStateFlow<UserSubscriptionDto?>(null)
    val subscription: StateFlow<UserSubscriptionDto?> = _subscription

    fun clearError() {
        _error.value = null
    }

    fun login(email: String, password: String, register: Boolean) {
        viewModelScope.launch {
            runCatching {
                if (register) repo.register(email, password) else repo.login(email, password)
            }.onFailure { _error.value = it.message }
        }
    }

    fun logout() {
        viewModelScope.launch { repo.logout() }
    }

    fun loadHome() {
        viewModelScope.launch {
            runCatching {
                _tracks.value = repo.mssTracks(limit = 20)
                _playlists.value = repo.mssPlaylists()
            }.onFailure { _error.value = it.message }
        }
    }

    fun search(query: String, source: SourceId?) {
        viewModelScope.launch {
            runCatching {
                _tracks.value = repo.searchAll(query, source)
            }.onFailure { _error.value = it.message }
        }
    }

    fun loadLikes() {
        viewModelScope.launch {
            runCatching { _tracks.value = repo.mssLikes() }.onFailure { _error.value = it.message }
        }
    }

    fun loadSpotifyLibrary() {
        viewModelScope.launch {
            runCatching {
                _playlists.value = spotify.listPlaylists()
                _tracks.value = spotify.savedTracks(50)
            }.onFailure { _error.value = it.message }
        }
    }

    fun loadYandexLibrary() {
        viewModelScope.launch {
            runCatching {
                _playlists.value = yandex.listPlaylists()
                _tracks.value = yandex.savedTracks(50)
            }.onFailure { _error.value = it.message }
        }
    }

    fun play(tracks: List<UnifiedTrack>, index: Int = 0) {
        viewModelScope.launch {
            runCatching {
                player.playTracks(tracks, index)
                startProgressLoop()
            }.onFailure { _error.value = it.message }
        }
    }

    fun connectSpotify(onUrl: (String) -> Unit) {
        onUrl(spotify.buildAuthorizeUrl())
    }

    fun completeSpotify(code: String, state: String) {
        viewModelScope.launch {
            runCatching {
                spotify.completeOAuth(code, state)
                loadSpotifyLibrary()
            }.onFailure { _error.value = it.message }
        }
    }

    fun connectYandex(onPrompt: (com.mss.core.model.DeviceCodePrompt) -> Unit) {
        viewModelScope.launch {
            runCatching {
                yandex.login(onPrompt)
                loadYandexLibrary()
            }.onFailure { _error.value = it.message }
        }
    }

    fun setApiBase(url: String) {
        viewModelScope.launch { repo.setApiBase(url) }
    }

    fun loadStats() {
        viewModelScope.launch {
            runCatching { _stats.value = repo.stats("month") }.onFailure { _error.value = it.message }
        }
    }

    fun loadSubscription() {
        viewModelScope.launch {
            runCatching { _subscription.value = repo.subscription() }.onFailure { _error.value = it.message }
        }
    }

    fun startWave() {
        viewModelScope.launch {
            runCatching {
                val batch = yandex.waveStart()
                if (batch.tracks.isEmpty()) error("Волна не вернула треки")
                player.playTracks(batch.tracks, radio = true)
                startProgressLoop()
            }.onFailure { _error.value = it.message }
        }
    }

    fun loadSimilar(track: UnifiedTrack) {
        viewModelScope.launch {
            runCatching {
                if (track.source != SourceId.YANDEX) error("Похожие доступны для Яндекс")
                _tracks.value = yandex.similarTracks(track.id)
            }.onFailure { _error.value = it.message }
        }
    }

    fun setSleepTimer(minutes: Int?) {
        player.setSleepTimer(minutes)
    }

    fun cycleRepeat() = player.cycleRepeat()

    fun togglePlay() = player.toggle()

    fun next() = player.next()

    fun prev() = player.prev()

    fun download(track: UnifiedTrack) {
        viewModelScope.launch {
            runCatching {
                if (track.source == SourceId.LOCAL) {
                    downloads.enqueueOfflineMss(track.id)
                } else {
                    val url = playback.resolveUrl(track)
                    downloads.enqueue(url, "${track.source}_${track.id}.bin")
                }
            }.onFailure { _error.value = it.message }
        }
    }

    fun openDeepLink(uri: android.net.Uri) {
        viewModelScope.launch {
            runCatching {
                when (uri.host) {
                    "open" -> when (uri.pathSegments.firstOrNull()) {
                        "track" -> {
                            val id = uri.pathSegments.getOrNull(1) ?: return@runCatching
                            val base = repo.apiBase.first()
                            val track = com.mss.core.model.UnifiedTrack(
                                source = SourceId.LOCAL,
                                id = id,
                                title = id,
                                artist = "MSS",
                                streamUrl = "$base/stream/$id",
                                playable = true,
                            )
                            play(listOf(track))
                        }
                        "playlist" -> {
                            val id = uri.pathSegments.getOrNull(1) ?: return@runCatching
                            val tracks = repo.playlistTracks(id)
                            if (tracks.isNotEmpty()) play(tracks)
                        }
                    }
                }
            }.onFailure { _error.value = it.message }
        }
    }

    private fun startProgressLoop() {
        viewModelScope.launch {
            while (player.state.value.playing) {
                player.tickProgress()
                kotlinx.coroutines.delay(500)
            }
        }
    }
}
