package com.mss.core.player

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
@UnstableApi
class PlaybackService : MediaSessionService {
    constructor() : super()

    @Inject lateinit var controller: PlayerController

    private var mediaSession: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        ensureForeground()
        setMediaNotificationProvider(DefaultMediaNotificationProvider(this))
        mediaSession = MediaSession.Builder(this, controller.exoPlayer()).build()
    }

    private fun ensureForeground() {
        val id = "mss_playback"
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(id, "Воспроизведение", NotificationManager.IMPORTANCE_LOW),
        )
        val notification = Notification.Builder(this, id)
            .setContentTitle("MusicStreamService")
            .setContentText("Воспроизведение")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(FOREGROUND_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(FOREGROUND_ID, notification)
        }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

    override fun onDestroy() {
        mediaSession?.release()
        mediaSession = null
        super.onDestroy()
    }

    companion object {
        const val FOREGROUND_ID = 1001
    }
}
