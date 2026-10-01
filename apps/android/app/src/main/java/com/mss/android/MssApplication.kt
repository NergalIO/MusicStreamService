package com.mss.android

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.disk.DiskCache
import com.mss.android.BuildConfig
import com.mss.android.data.CacheSettings
import com.mss.android.data.LobbyPlaybackCoordinator
import com.mss.android.data.RelayCoordinator
import com.mss.android.data.SessionLog
import com.mss.android.ui.components.SpotifyCoverInterceptor
import com.mss.core.connectors.SpotifyWebSession
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class MssApplication : Application(), Configuration.Provider, ImageLoaderFactory {
    @Inject lateinit var workerFactory: HiltWorkerFactory
    @Inject lateinit var relayCoordinator: RelayCoordinator
    @Inject lateinit var lobbyPlaybackCoordinator: LobbyPlaybackCoordinator
    @Inject lateinit var spotifyWeb: SpotifyWebSession
    @Inject lateinit var sessionLog: SessionLog

    override fun onCreate() {
        super.onCreate()
        sessionLog.installUncaughtHandler()
        sessionLog.info("app", "start ${BuildConfig.VERSION_NAME} ${if (BuildConfig.DEBUG) "debug" else "release"}")
    }

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()

    /** Обложки хранятся до вытеснения по лимиту: CDN площадок часто запрещают кеширование заголовками. */
    override fun newImageLoader(): ImageLoader {
        val diskCache = DiskCache.Builder()
            .directory(CacheSettings.imageDir(this))
            .maxSizeBytes(CacheSettings.imageBytes(this))
            .build()
        return ImageLoader.Builder(this)
            .diskCache(diskCache)
            .respectCacheHeaders(false)
            .components { add(SpotifyCoverInterceptor(spotifyWeb, diskCache)) }
            .build()
    }
}
