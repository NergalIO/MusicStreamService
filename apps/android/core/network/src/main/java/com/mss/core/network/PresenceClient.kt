package com.mss.core.network

import com.mss.core.datastore.MssPreferences
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

@Singleton
class PresenceClient @Inject constructor(
    private val preferences: MssPreferences,
) {
    private val http = HttpClient(OkHttp) { install(WebSockets) }
    private var session: DefaultClientWebSocketSession? = null
    private var job: Job? = null

    fun connect(accessToken: String) {
        disconnect()
        job = CoroutineScope(Dispatchers.IO).launch {
            val base = preferences.getApiBaseUrl().replace("http", "ws").trimEnd('/')
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
                    // relay_upload etc. — handled in federated phase on desktop
                    frame.readText()
                }
            }
        }
    }

    fun disconnect() {
        job?.cancel()
        job = null
        session = null
    }
}
