package com.mss.core.player

import android.content.Context
import android.os.Bundle
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import com.google.common.collect.ImmutableList

internal object PlaybackCommands {
    const val LIKE = "com.mss.playback.LIKE"
    const val REPEAT = "com.mss.playback.REPEAT"
    val like = SessionCommand(LIKE, Bundle.EMPTY)
    val repeat = SessionCommand(REPEAT, Bundle.EMPTY)
}

@UnstableApi
internal fun playbackMediaButtons(context: Context, liked: Boolean, repeat: RepeatMode): ImmutableList<CommandButton> {
    val repeatIcon = when (repeat) {
        RepeatMode.OFF -> CommandButton.ICON_REPEAT_OFF
        RepeatMode.ALL -> CommandButton.ICON_REPEAT_ALL
        RepeatMode.ONE -> CommandButton.ICON_REPEAT_ONE
    }
    val repeatName = when (repeat) {
        RepeatMode.OFF -> context.getString(R.string.notif_repeat_off)
        RepeatMode.ALL -> context.getString(R.string.notif_repeat_all)
        RepeatMode.ONE -> context.getString(R.string.notif_repeat_one)
    }
    val likeIcon = if (liked) CommandButton.ICON_HEART_FILLED else CommandButton.ICON_HEART_UNFILLED
    val likeName = context.getString(if (liked) R.string.notif_unlike else R.string.notif_like)
    return ImmutableList.of(
        CommandButton.Builder(repeatIcon)
            .setDisplayName(repeatName)
            .setSessionCommand(PlaybackCommands.repeat)
            .setSlots(CommandButton.SLOT_BACK_SECONDARY, CommandButton.SLOT_OVERFLOW)
            .build(),
        CommandButton.Builder(likeIcon)
            .setDisplayName(likeName)
            .setSessionCommand(PlaybackCommands.like)
            .setSlots(CommandButton.SLOT_FORWARD_SECONDARY, CommandButton.SLOT_OVERFLOW)
            .build(),
    )
}

@UnstableApi
internal class MssNotificationProvider(context: Context) : DefaultMediaNotificationProvider(
    context,
    { _ -> PlaybackService.FOREGROUND_ID },
    CHANNEL_ID,
    R.string.playback_channel,
) {
    override fun getMediaButtons(
        session: MediaSession,
        playerCommands: Player.Commands,
        mediaButtonPreferences: ImmutableList<CommandButton>,
        showPauseButton: Boolean,
    ): ImmutableList<CommandButton> {
        val transport = super.getMediaButtons(session, playerCommands, ImmutableList.of(), showPauseButton)
        val repeat = mediaButtonPreferences.find { it.sessionCommand?.customAction == PlaybackCommands.REPEAT }
        val like = mediaButtonPreferences.find { it.sessionCommand?.customAction == PlaybackCommands.LIKE }
        val ordered = ImmutableList.Builder<CommandButton>()
        if (repeat != null) ordered.add(repeat)
        ordered.addAll(transport)
        if (like != null) ordered.add(like)
        return ordered.build()
    }

    companion object {
        const val CHANNEL_ID = "mss_playback"
    }
}
