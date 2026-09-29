package com.mss.android

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import coil.ImageLoader
import coil.ImageLoaderFactory
import com.mss.android.data.LobbyPlaybackCoordinator
import com.mss.android.data.RelayCoordinator
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

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()

    override fun newImageLoader(): ImageLoader =
        ImageLoader.Builder(this)
            .components { add(SpotifyCoverInterceptor(spotifyWeb)) }
            .build()
}
