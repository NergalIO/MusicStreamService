package com.mss.core.player

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

@AndroidEntryPoint
@UnstableApi
class PlaybackService : MediaSessionService {
    constructor() : super()

    @Inject lateinit var controller: PlayerController

    private var mediaSession: MediaSession? = null
    private val serviceJob = SupervisorJob()
    private val serviceScope = CoroutineScope(serviceJob + Dispatchers.Main.immediate)
    private var buttonsJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        val channelId = MssNotificationProvider.CHANNEL_ID
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(channelId, getString(R.string.playback_channel), NotificationManager.IMPORTANCE_LOW),
        )
        val provider = MssNotificationProvider(this).also { it.setSmallIcon(R.drawable.ic_stat_playback) }
        setMediaNotificationProvider(provider)
        val session = MediaSession.Builder(this, controller.sessionPlayer())
            .setId("mss-playback")
            .setSessionActivity(launchIntent())
            .setCallback(SessionCallback())
            .setMediaButtonPreferences(playbackMediaButtons(this, controller.state.value.liked, controller.state.value.repeat))
            .build()
        mediaSession = session
        addSession(session)
        buttonsJob = serviceScope.launch {
            controller.state
                .map { Triple(it.liked, it.repeat, it.current?.id) }
                .distinctUntilChanged()
                .collect { (liked, repeat, _) ->
                    mediaSession?.setMediaButtonPreferences(playbackMediaButtons(this@PlaybackService, liked, repeat))
                }
        }
        ensureForeground()
    }

    private inner class SessionCallback : MediaSession.Callback {
        override fun onConnect(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
        ): MediaSession.ConnectionResult {
            val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon()
                .add(PlaybackCommands.like)
                .add(PlaybackCommands.repeat)
                .build()
            return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                .setAvailableSessionCommands(commands)
                .build()
        }

        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: Bundle,
        ): ListenableFuture<SessionResult> {
            when (customCommand.customAction) {
                PlaybackCommands.LIKE -> this@PlaybackService.controller.toggleLike()
                PlaybackCommands.REPEAT -> this@PlaybackService.controller.cycleRepeat()
                else -> return super.onCustomCommand(session, controller, customCommand, args)
            }
            return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
        }
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
        val notification = Notification.Builder(this, MssNotificationProvider.CHANNEL_ID)
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
        buttonsJob?.cancel()
        serviceJob.cancel()
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
