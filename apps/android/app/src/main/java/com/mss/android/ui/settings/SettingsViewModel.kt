package com.mss.android.ui.settings

import android.content.ClipData
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import coil.imageLoader
import com.mss.android.data.AppUpdater
import com.mss.android.data.CacheSettings
import com.mss.android.data.ContentCache
import com.mss.android.data.MssRepository
import com.mss.android.data.SessionLog
import com.mss.core.model.PlaybackSettings
import com.mss.core.model.Quality
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
    val updater: AppUpdater,
    private val sessionLog: SessionLog,
) : ViewModel() {
    val playbackSettings = repo.playbackSettings.stateIn(viewModelScope, SharingStarted.Eagerly, PlaybackSettings())
    val apiBase = repo.apiBase.stateIn(viewModelScope, SharingStarted.Eagerly, "")
    private val _autoUpdate = MutableStateFlow(updater.autoCheck)
    val autoUpdate: StateFlow<Boolean> = _autoUpdate

    fun setAutoUpdate(enabled: Boolean) {
        updater.autoCheck = enabled
        _autoUpdate.value = enabled
    }
    private val startLimit = CacheSettings.limitMb(context)
    private val _cache = MutableStateFlow(CacheUi(limitMb = startLimit))
    val cache: StateFlow<CacheUi> = _cache

    fun setApiBase(url: String) = viewModelScope.launch { repo.setApiBase(url) }

    fun savePlayback(settings: PlaybackSettings) = viewModelScope.launch { repo.prefs.savePlaybackSettings(settings) }

    private val _shareError = MutableStateFlow<String?>(null)
    val shareError: StateFlow<String?> = _shareError

    fun shareSession() {
        viewModelScope.launch {
            _shareError.value = null
            runCatching {
                val file = withContext(Dispatchers.IO) { sessionLog.export() }
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", file)
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_STREAM, uri)
                    putExtra(Intent.EXTRA_SUBJECT, "MSS session dump")
                    clipData = ClipData.newRawUri("session", uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                val chooser = Intent.createChooser(send, "Поделиться сессией")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                context.startActivity(chooser)
            }.onFailure { _shareError.value = it.message ?: "Не удалось выгрузить сессию" }
        }
    }

    fun setQuality(quality: Quality) = viewModelScope.launch {
        val cur = repo.prefs.loadPlaybackSettings()
        repo.prefs.savePlaybackSettings(cur.copy(quality = quality))
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
