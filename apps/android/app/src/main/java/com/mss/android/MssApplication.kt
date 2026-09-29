package com.mss.android

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import com.mss.android.data.LobbyPlaybackCoordinator
import com.mss.android.data.RelayCoordinator
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class MssApplication : Application(), Configuration.Provider {
    @Inject lateinit var workerFactory: HiltWorkerFactory
    @Inject lateinit var relayCoordinator: RelayCoordinator
    @Inject lateinit var lobbyPlaybackCoordinator: LobbyPlaybackCoordinator

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()
}
