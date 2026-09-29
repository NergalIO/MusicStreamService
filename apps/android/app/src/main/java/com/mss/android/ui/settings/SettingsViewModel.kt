package com.mss.android.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mss.android.data.MssRepository
import com.mss.core.model.PlaybackSettings
import com.mss.core.model.Quality
import com.mss.core.network.SiteDownloads
import com.mss.core.player.PlayerController
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val repo: MssRepository,
    val player: PlayerController,
) : ViewModel() {
    val playbackSettings = repo.playbackSettings.stateIn(viewModelScope, SharingStarted.Eagerly, PlaybackSettings())
    val apiBase = repo.apiBase.stateIn(viewModelScope, SharingStarted.Eagerly, "")
    private val _apk = MutableStateFlow<SiteDownloads?>(null)
    val apk: StateFlow<SiteDownloads?> = _apk

    fun setApiBase(url: String) = viewModelScope.launch { repo.setApiBase(url) }

    fun savePlayback(settings: PlaybackSettings) = viewModelScope.launch { repo.prefs.savePlaybackSettings(settings) }

    fun setQuality(quality: Quality) = viewModelScope.launch {
        val cur = repo.prefs.loadPlaybackSettings()
        repo.prefs.savePlaybackSettings(cur.copy(quality = quality))
    }

    fun checkApk() = viewModelScope.launch {
        _apk.value = runCatching { repo.apiClient.siteDownloads() }.getOrNull()
    }
}
