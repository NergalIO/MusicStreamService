package com.mss.core.player

import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer
import androidx.media3.common.util.UnstableApi
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import kotlin.math.abs

/**
 * Плеер только для системной шторки: название, исполнитель, обложка и перемотка.
 * Звук играет ExoPlayer или WebView Spotify, сюда публикуется то, что видит пользователь.
 */
@UnstableApi
class NowPlayingPlayer(
    looper: Looper,
    private val controls: Controls,
) : SimpleBasePlayer(looper) {
    interface Controls {
        fun play()
        fun pause()
        fun next()
        fun previous()
        fun seekTo(positionMs: Long)
        fun setRepeat(mode: RepeatMode)
        fun setShuffle(enabled: Boolean)
    }

    private val main = Handler(looper)
    private var ui = PlayerUiState()
    private var anchorPos = 0L
    private var anchorAt = 0L
    private var anchorPlaying = false
    private var ignorePauseUntil = 0L
    private var restorePlayWhenReady = false

    fun publish(state: PlayerUiState) {
        val now = android.os.SystemClock.elapsedRealtime()
        val expected = if (anchorPlaying) anchorPos + (now - anchorAt) else anchorPos
        val sameTrack = ui.current?.id == state.current?.id && ui.current?.source == state.current?.source
        if (!sameTrack && state.playing) {
            ignorePauseUntil = now + 2_500L
        }
        val structural = !sameTrack ||
            restorePlayWhenReady ||
            state.playing != ui.playing ||
            state.buffering != ui.buffering ||
            state.index != ui.index ||
            state.queue.size != ui.queue.size ||
            state.repeat != ui.repeat ||
            state.shuffle != ui.shuffle ||
            abs(state.durationMs - ui.durationMs) > 500 ||
            abs(state.positionMs - expected) > 2_000 ||
            anchorAt == 0L
        restorePlayWhenReady = false
        ui = state
        if (!structural) return
        anchorPos = state.positionMs
        anchorAt = now
        anchorPlaying = state.playing && !state.buffering
        invalidateState()
    }

    override fun getState(): State {
        val track = ui.current
        if (track == null) {
            return State.Builder()
                .setAvailableCommands(Player.Commands.EMPTY)
                .setPlaybackState(Player.STATE_IDLE)
                .setPlayWhenReady(false, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
                .build()
        }
        val id = "${track.source}:${track.id}"
        val item = MediaItem.Builder()
            .setMediaId(id)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(track.title)
                    .setArtist(track.artist.ifBlank { track.album.orEmpty() })
                    .setAlbumTitle(track.album)
                    .setArtworkUri(track.coverUrl?.takeIf { it.isNotBlank() }?.let(Uri::parse))
                    .build(),
            )
            .build()
        val durationUs = if (ui.durationMs > 0) ui.durationMs * 1000 else C.TIME_UNSET
        val current = mediaData("$id#0", item, durationUs)
        val hasNext = ui.index < ui.queue.lastIndex || (ui.repeat != RepeatMode.OFF && ui.queue.isNotEmpty())
        val playlist = if (hasNext) listOf(current, mediaData("$id#1", item, durationUs)) else listOf(current)
        val commands = Player.Commands.Builder()
            .add(Player.COMMAND_PLAY_PAUSE)
            .add(Player.COMMAND_GET_CURRENT_MEDIA_ITEM)
            .add(Player.COMMAND_GET_TIMELINE)
            .add(Player.COMMAND_GET_METADATA)
            .add(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)
            .add(Player.COMMAND_SEEK_TO_PREVIOUS)
            .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
            .add(Player.COMMAND_SET_REPEAT_MODE)
            .add(Player.COMMAND_SET_SHUFFLE_MODE)
        if (hasNext) {
            commands.add(Player.COMMAND_SEEK_TO_NEXT).add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
        }
        val speed = if (ui.playing && !ui.buffering) 1f else 0f
        return State.Builder()
            .setAvailableCommands(commands.build())
            .setPlaybackState(if (ui.buffering) Player.STATE_BUFFERING else Player.STATE_READY)
            .setPlayWhenReady(ui.playing, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
            .setRepeatMode(
                when (ui.repeat) {
                    RepeatMode.OFF -> Player.REPEAT_MODE_OFF
                    RepeatMode.ALL -> Player.REPEAT_MODE_ALL
                    RepeatMode.ONE -> Player.REPEAT_MODE_ONE
                },
            )
            .setShuffleModeEnabled(ui.shuffle)
            .setPlaylist(playlist)
            .setCurrentMediaItemIndex(0)
            .setContentPositionMs(PositionSupplier.getExtrapolating(ui.positionMs, speed))
            .setContentBufferedPositionMs(PositionSupplier.getConstant(ui.durationMs.coerceAtLeast(ui.positionMs)))
            .build()
    }

    override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
        main.post {
            if (playWhenReady) {
                controls.play()
            } else if (android.os.SystemClock.elapsedRealtime() < ignorePauseUntil && ui.playing) {
                restorePlayWhenReady = true
            } else {
                controls.pause()
            }
        }
        return Futures.immediateVoidFuture()
    }

    override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
        main.post {
            when (seekCommand) {
                Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> controls.next()
                // Кнопка «назад» в шторке ведёт себя так же, как в плеере: сначала в начало трека.
                Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> {
                    if (ui.positionMs > 3_000) controls.seekTo(0) else controls.previous()
                }
                else -> if (positionMs != C.TIME_UNSET) controls.seekTo(positionMs.coerceAtLeast(0))
            }
        }
        return Futures.immediateVoidFuture()
    }

    override fun handleSetRepeatMode(repeatMode: Int): ListenableFuture<*> {
        val mode = when (repeatMode) {
            Player.REPEAT_MODE_ONE -> RepeatMode.ONE
            Player.REPEAT_MODE_ALL -> RepeatMode.ALL
            else -> RepeatMode.OFF
        }
        main.post { controls.setRepeat(mode) }
        return Futures.immediateVoidFuture()
    }

    override fun handleSetShuffleModeEnabled(shuffleModeEnabled: Boolean): ListenableFuture<*> {
        main.post { controls.setShuffle(shuffleModeEnabled) }
        return Futures.immediateVoidFuture()
    }

    override fun handleRelease(): ListenableFuture<*> = Futures.immediateVoidFuture()

    private fun mediaData(uid: String, item: MediaItem, durationUs: Long): MediaItemData {
        return MediaItemData.Builder(uid)
            .setMediaItem(item)
            .setDurationUs(durationUs)
            .setIsSeekable(ui.durationMs > 0)
            .setIsDynamic(false)
            .build()
    }
}
