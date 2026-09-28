package com.mss.core.player

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
@UnstableApi
class PlaybackService : MediaSessionService() {
    @Inject lateinit var controller: PlayerController

    private var mediaSession: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
        mediaSession = MediaSession.Builder(this, controller.exoPlayer()).build()
        startForeground(NOTIFICATION_ID, buildNotification())
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

    override fun onDestroy() {
        mediaSession?.release()
        mediaSession = null
        super.onDestroy()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_TOGGLE -> controller.toggle()
            ACTION_NEXT -> controller.next()
            ACTION_PREV -> controller.prev()
        }
        return START_STICKY
    }

    private fun buildNotification(): Notification {
        val track = controller.state.value.current
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(track?.title ?: "MusicStreamService")
            .setContentText(track?.artist ?: "")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .build()
    }

    private fun ensureChannel() {
        val mgr = getSystemService(NotificationManager::class.java)
        mgr.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Воспроизведение", NotificationManager.IMPORTANCE_LOW),
        )
    }

    companion object {
        const val CHANNEL_ID = "mss_playback"
        const val NOTIFICATION_ID = 42
        const val ACTION_TOGGLE = "com.mss.toggle"
        const val ACTION_NEXT = "com.mss.next"
        const val ACTION_PREV = "com.mss.prev"
    }
}
