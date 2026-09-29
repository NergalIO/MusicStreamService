package com.mss.core.network

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import com.mss.core.datastore.MssPreferences
import com.mss.core.model.LocalHolding
import dagger.hilt.android.qualifiers.ApplicationContext
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.websocket.DefaultClientWebSocketSession
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import io.ktor.websocket.send
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class RelayUploadMessage(
    val type: String,
    val sessionId: String,
    val trackId: String,
    val title: String? = null,
    val uploadUrl: String,
    val token: String,
)

@Singleton
class PresenceClient @Inject constructor(
    private val preferences: MssPreferences,
    @ApplicationContext private val context: Context,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val http = HttpClient(OkHttp) { install(WebSockets) }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var session: DefaultClientWebSocketSession? = null
    private var job: Job? = null

    private val _relay = MutableSharedFlow<RelayUploadMessage>(extraBufferCapacity = 8)
    val relay: SharedFlow<RelayUploadMessage> = _relay

    private val _needFile = kotlinx.coroutines.flow.MutableStateFlow<RelayUploadMessage?>(null)
    val needFile: kotlinx.coroutines.flow.StateFlow<RelayUploadMessage?> = _needFile

    var resolveHolding: suspend (trackId: String) -> LocalHolding? = { null }

    fun connect(accessToken: String) {
        disconnect()
        job = scope.launch {
            val base = preferences.getApiBaseUrl().replace("https://", "wss://").replace("http://", "ws://").trimEnd('/')
            val ws = http.webSocketSession("$base/ws?token=$accessToken")
            session = ws
            launch {
                while (isActive) {
                    delay(25_000)
                    ws.send(Frame.Text("""{"type":"ping"}"""))
                }
            }
            for (frame in ws.incoming) {
                if (frame is Frame.Text) {
                    val text = frame.readText()
                    val msg = runCatching { json.decodeFromString<RelayUploadMessage>(text) }.getOrNull()
                    if (msg?.type == "relay_upload") {
                        _relay.emit(msg)
                    }
                }
            }
        }
    }

    fun disconnect() {
        job?.cancel()
        job = null
        session = null
    }

    fun notifyNeedFile(msg: RelayUploadMessage) {
        _needFile.value = msg
        val mgr = context.getSystemService(NotificationManager::class.java)
        mgr.createNotificationChannel(NotificationChannel("mss_relay", "Relay", NotificationManager.IMPORTANCE_HIGH))
        val open = PendingIntent.getActivity(
            context,
            msg.sessionId.hashCode(),
            Intent(Intent.ACTION_VIEW, Uri.parse("mss://library/uploads")).apply {
                setPackage(context.packageName)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        mgr.notify(
            msg.sessionId.hashCode(),
            NotificationCompat.Builder(context, "mss_relay")
                .setSmallIcon(android.R.drawable.stat_sys_upload)
                .setContentTitle("Нужен файл для relay")
                .setContentText(msg.title ?: msg.trackId)
                .setContentIntent(open)
                .setAutoCancel(true)
                .build(),
        )
        _needFile.value = msg
    }

    fun clearNeedFile() {
        _needFile.value = null
    }
}
