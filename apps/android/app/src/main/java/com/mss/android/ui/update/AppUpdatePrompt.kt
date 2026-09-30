package com.mss.android.ui.update

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.mss.android.data.AppUpdater

/** Проверяет обновление при запуске и предлагает установить новую версию. */
@Composable
fun AppUpdatePrompt(updater: AppUpdater) {
    val state by updater.state.collectAsState()
    LaunchedEffect(Unit) { updater.checkOnLaunch() }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) updater.onResume()
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    val downloading = state.progress != null
    if (!downloading && (!state.available || state.dismissed)) return
    AlertDialog(
        onDismissRequest = { if (!downloading) updater.dismiss() },
        title = { Text(if (downloading) "Скачиваем обновление" else "Доступно обновление") },
        text = {
            Column {
                if (downloading) {
                    LinearProgressIndicator(progress = { state.progress ?: 0f }, modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(8.dp))
                    Text("${((state.progress ?: 0f) * 100).toInt()}%", style = MaterialTheme.typography.bodySmall)
                } else {
                    Text("Версия ${state.latest} (у вас ${state.current}). Приложение скачает её и откроет установку.")
                    state.error?.let {
                        Spacer(Modifier.height(8.dp))
                        Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        },
        confirmButton = {
            if (!downloading) {
                TextButton({ updater.download() }) { Text(if (state.readyFile != null) "Установить" else "Обновить") }
            }
        },
        dismissButton = {
            TextButton({ if (downloading) updater.cancelDownload() else updater.dismiss() }) {
                Text(if (downloading) "Отмена" else "Позже")
            }
        },
    )
}
