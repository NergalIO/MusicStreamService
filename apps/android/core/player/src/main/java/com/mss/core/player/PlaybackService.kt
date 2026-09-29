package com.mss.core.player

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player
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
                .also { it.setSmallIcon(android.R.drawable.ic_media_play) },
        )
        bindSession(controller.sessionPlayer())
        controller.onActivePlayerChanged = { bindSession(it) }
        ensureForeground()
    }

    private fun bindSession(player: Player) {
        val next = MediaSession.Builder(this, QueuePlayer(player, controller))
            .setId("mss-playback")
            .setSessionActivity(launchIntent())
            .build()
        val previous = mediaSession
        mediaSession = next
        previous?.release()
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
            .setSmallIcon(android.R.drawable.ic_media_play)
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
        controller.onActivePlayerChanged = null
        mediaSession?.release()
        mediaSession = null
        super.onDestroy()
    }

    companion object {
        const val FOREGROUND_ID = 1001
    }
}

@UnstableApi
private class QueuePlayer(
    player: Player,
    private val host: PlayerController,
) : ForwardingPlayer(player) {
    override fun seekToNext() {
        host.next()
    }

    override fun seekToPrevious() {
        host.prev()
    }

    override fun seekToNextMediaItem() {
        host.next()
    }

    override fun seekToPreviousMediaItem() {
        host.prev()
    }

    override fun hasNextMediaItem(): Boolean = host.state.value.queue.size > 1

    override fun hasPreviousMediaItem(): Boolean = host.state.value.index > 0 || (host.state.value.current != null)

    override fun isCommandAvailable(command: Int): Boolean {
        return command == Player.COMMAND_SEEK_TO_NEXT ||
            command == Player.COMMAND_SEEK_TO_PREVIOUS ||
            command == Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM ||
            command == Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM ||
            super.isCommandAvailable(command)
    }

    override fun getAvailableCommands(): Player.Commands {
        return super.getAvailableCommands().buildUpon()
            .add(Player.COMMAND_SEEK_TO_NEXT)
            .add(Player.COMMAND_SEEK_TO_PREVIOUS)
            .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
            .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
            .build()
    }
}
