package com.mss.android.ui.settings

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import coil.imageLoader
import com.mss.android.data.CacheSettings
import com.mss.android.data.ContentCache
import com.mss.android.data.MssRepository
import com.mss.core.model.PlaybackSettings
import com.mss.core.model.Quality
import com.mss.core.network.SiteDownloads
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class CacheUi(
    val bytes: Long? = null,
    val limitMb: Int = 500,
    /** Лимит картинок задаётся при запуске загрузчика — новый вступит в силу после перезапуска. */
    val restartNeeded: Boolean = false,
    val clearing: Boolean = false,
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val repo: MssRepository,
    @ApplicationContext private val context: Context,
    private val contentCache: ContentCache,
) : ViewModel() {
    val playbackSettings = repo.playbackSettings.stateIn(viewModelScope, SharingStarted.Eagerly, PlaybackSettings())
    val apiBase = repo.apiBase.stateIn(viewModelScope, SharingStarted.Eagerly, "")
    private val _apk = MutableStateFlow<SiteDownloads?>(null)
    val apk: StateFlow<SiteDownloads?> = _apk
    private val startLimit = CacheSettings.limitMb(context)
    private val _cache = MutableStateFlow(CacheUi(limitMb = startLimit))
    val cache: StateFlow<CacheUi> = _cache

    fun setApiBase(url: String) = viewModelScope.launch { repo.setApiBase(url) }

    fun savePlayback(settings: PlaybackSettings) = viewModelScope.launch { repo.prefs.savePlaybackSettings(settings) }

    fun setQuality(quality: Quality) = viewModelScope.launch {
        val cur = repo.prefs.loadPlaybackSettings()
        repo.prefs.savePlaybackSettings(cur.copy(quality = quality))
    }

    fun checkApk() = viewModelScope.launch {
        _apk.value = runCatching { repo.apiClient.siteDownloads() }.getOrNull()
    }

    fun refreshCache() = viewModelScope.launch {
        _cache.value = _cache.value.copy(bytes = cacheBytes())
    }

    fun setCacheLimit(mb: Int) = viewModelScope.launch {
        CacheSettings.setLimitMb(context, mb)
        contentCache.trim()
        _cache.value = _cache.value.copy(limitMb = mb, restartNeeded = mb != startLimit, bytes = cacheBytes())
    }

    fun clearCache() = viewModelScope.launch {
        _cache.value = _cache.value.copy(clearing = true)
        contentCache.clear()
        withContext(Dispatchers.IO) { context.imageLoader.diskCache?.clear() }
        context.imageLoader.memoryCache?.clear()
        _cache.value = _cache.value.copy(clearing = false, bytes = cacheBytes())
    }

    private suspend fun cacheBytes(): Long {
        val images = withContext(Dispatchers.IO) { context.imageLoader.diskCache?.size ?: 0L }
        return images + contentCache.sizeBytes()
    }
}
