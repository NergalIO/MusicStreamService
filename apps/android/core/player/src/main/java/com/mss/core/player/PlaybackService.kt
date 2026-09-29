package com.mss.core.player

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
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
        val channelId = "mss_playback"
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(channelId, getString(R.string.playback_channel), NotificationManager.IMPORTANCE_LOW),
        )
        setMediaNotificationProvider(
            DefaultMediaNotificationProvider.Builder(this)
                .setNotificationId(FOREGROUND_ID)
                .setChannelId(channelId)
                .setChannelName(R.string.playback_channel)
                .build()
                .also { it.setSmallIcon(R.drawable.ic_stat_playback) },
        )
        val session = MediaSession.Builder(this, controller.sessionPlayer())
            .setId("mss-playback")
            .setSessionActivity(launchIntent())
            .build()
        mediaSession = session
        addSession(session)
        ensureForeground()
    }

    private fun launchIntent(): PendingIntent {
        val launch = packageManager.getLaunchIntentForPackage(packageName)
            ?: Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        launch.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        return PendingIntent.getActivity(
            this,
            0,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun ensureForeground() {
        val notification = Notification.Builder(this, "mss_playback")
            .setContentTitle("MusicStreamService")
            .setContentText(getString(R.string.playback_channel))
            .setSmallIcon(R.drawable.ic_stat_playback)
            .setContentIntent(launchIntent())
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
        mediaSession?.let { session ->
            removeSession(session)
            session.release()
        }
        mediaSession = null
        super.onDestroy()
    }

    companion object {
        const val FOREGROUND_ID = 1001
    }
}
