package com.mss.core.lobby

import com.mss.core.datastore.MssPreferences
import com.mss.core.model.LobbyDto
import com.mss.core.model.LobbyPlaybackState
import com.mss.core.model.LobbyQueueItemDto
import com.mss.core.network.MssApiClient
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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

@Singleton
class LobbyClient @Inject constructor(
    private val api: MssApiClient,
    private val preferences: MssPreferences,
) {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }
    private val http = HttpClient(OkHttp) { install(WebSockets) }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var wsJob: Job? = null
    private var session: DefaultClientWebSocketSession? = null

    private val _lobby = MutableStateFlow<LobbyDto?>(null)
    val lobby: StateFlow<LobbyDto?> = _lobby

    val apiClient: MssApiClient get() = api

    suspend fun refreshList() = api.listLobbies()

    suspend fun create(title: String, isPublic: Boolean) = api.createLobby(title, isPublic).also {
        _lobby.value = it
        connectSocket(it.id)
    }

    suspend fun join(code: String) = api.joinLobby(code).also {
        _lobby.value = it
        connectSocket(it.id)
    }

    suspend fun open(id: String) {
        val dto = api.getLobby(id)
        _lobby.value = dto
        connectSocket(id)
    }

    suspend fun leave() {
        val id = _lobby.value?.id ?: return
        runCatching { api.leaveLobby(id) }
        disconnect()
        _lobby.value = null
    }

    suspend fun suggest(track: com.mss.core.model.UnifiedTrack) {
        val id = _lobby.value?.id ?: error("Сначала войдите в listening party")
        api.suggestLobbyTrack(id, track)
    }

    suspend fun accept(itemId: String) {
        val id = _lobby.value?.id ?: return
        api.acceptLobbyItem(id, itemId)
    }

    suspend fun reject(itemId: String) {
        val id = _lobby.value?.id ?: return
        api.rejectLobbyItem(id, itemId)
    }

    suspend fun publishPlayback(action: String, track: com.mss.core.model.UnifiedTrack?, positionMs: Long?) {
        val id = _lobby.value?.id ?: return
        val playback = api.lobbyPlayback(id, action, track, positionMs)
        _lobby.value = _lobby.value?.copy(playback = playback)
    }

    fun isHost(userId: String?): Boolean = _lobby.value?.hostUserId == userId

    fun isListener(userId: String?): Boolean {
        val room = _lobby.value ?: return false
        return userId != null && room.hostUserId != userId
    }

    private fun connectSocket(lobbyId: String) {
        disconnect()
        wsJob = scope.launch {
            val token = preferences.loadSession()?.accessToken ?: return@launch
            val base = preferences.getApiBaseUrl().replace("https://", "wss://").replace("http://", "ws://").trimEnd('/')
            val ws = http.webSocketSession("$base/ws/lobby/$lobbyId?token=$token")
            session = ws
            launch {
                while (isActive) {
                    delay(20_000)
                    ws.send(Frame.Text("""{"type":"ping","t":${System.currentTimeMillis()}}"""))
                }
            }
            for (frame in ws.incoming) {
                if (frame !is Frame.Text) continue
                applyEvent(frame.readText())
            }
        }
    }

    private fun applyEvent(text: String) {
        val obj = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return
        when (obj["type"]?.jsonPrimitive?.content) {
            "lobby_state" -> {
                val lobbyEl = obj["lobby"] ?: return
                _lobby.value = json.decodeFromString<LobbyDto>(lobbyEl.toString())
            }
            "playback" -> {
                val p = obj["playback"] ?: return
                val playback = json.decodeFromString<LobbyPlaybackState>(p.toString())
                _lobby.value = _lobby.value?.copy(playback = playback)
            }
            "queue_updated" -> {
                val q = obj["queue"] ?: return
                val queue = json.decodeFromString<List<LobbyQueueItemDto>>(q.toString())
                _lobby.value = _lobby.value?.copy(queue = queue)
            }
            "lobby_closed" -> {
                _lobby.value = null
                disconnect()
            }
            "suggestion_new" -> {
                val itemEl = obj["item"] ?: return
                val item = json.decodeFromString<LobbyQueueItemDto>(itemEl.toString())
                val cur = _lobby.value ?: return
                _lobby.value = cur.copy(queue = cur.queue + item)
            }
        }
    }

    fun disconnect() {
        wsJob?.cancel()
        wsJob = null
        session = null
    }
}
