package com.mss.core.datastore

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.mss.core.model.AuthSession
import com.mss.core.model.ListeningHistoryItem
import com.mss.core.model.PlaybackSettings
import com.mss.core.model.UnifiedTrack
import com.mss.core.model.toUnifiedTrack
import java.time.Instant
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray

private val Context.dataStore by preferencesDataStore("mss_prefs")

@Singleton
class MssPreferences @Inject constructor(
    @ApplicationContext private val context: Context,
    private val secureVault: SecureTokenVault,
) {
    private val json = Json { ignoreUnknownKeys = true }

    val apiBaseUrl: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[KEY_API_BASE] ?: DEFAULT_API_BASE
    }

    /**
     * Токены MSS лежат в зашифрованном хранилище, а не в обычных настройках.
     * Старые установки читаем из DataStore, пока не перенесём запись при первом сохранении.
     */
    private val vaultSession = MutableStateFlow(decodeSession(secureVault.get(VAULT_SESSION)))

    val session: Flow<AuthSession?> = combine(vaultSession, context.dataStore.data) { stored, prefs ->
        stored ?: decodeSession(prefs[KEY_SESSION])
    }

    private fun decodeSession(raw: String?): AuthSession? =
        raw?.let { runCatching { json.decodeFromString<AuthSession>(it) }.getOrNull() }

    val playbackSettings: Flow<PlaybackSettings> = context.dataStore.data.map { prefs ->
        prefs[KEY_PLAYBACK]?.let { json.decodeFromString<PlaybackSettings>(it) } ?: PlaybackSettings()
    }

    val onboarded: Flow<Boolean> = context.dataStore.data.map { it[KEY_ONBOARDED] ?: false }

    val searchHistory: Flow<List<String>> = context.dataStore.data.map { prefs ->
        prefs[KEY_SEARCH]?.let { json.decodeFromString<List<String>>(it) } ?: emptyList()
    }

    val playHistory: Flow<List<UnifiedTrack>> = context.dataStore.data.map { prefs ->
        decodeHistory(prefs[KEY_PLAY_HISTORY]).map { it.track }
    }

    suspend fun addPlayHistory(track: UnifiedTrack) {
        val entry = PlayHistoryEntry(track.copy(streamUrl = null), Instant.now().toString())
        context.dataStore.edit { prefs ->
            val current = decodeHistory(prefs[KEY_PLAY_HISTORY])
            val next = (listOf(entry) + current.filterNot { sameTrack(it.track, entry.track) }).take(PLAY_HISTORY_LIMIT)
            prefs[KEY_PLAY_HISTORY] = json.encodeToString(next)
        }
    }

    /** Подмешивает серверную историю, не затирая прослушивания, которые ещё не уехали с устройства. */
    suspend fun mergeRemoteHistory(remote: List<ListeningHistoryItem>) {
        context.dataStore.edit { prefs ->
            val local = decodeHistory(prefs[KEY_PLAY_HISTORY])
            val merged = mergeHistory(local, remote, prefs[KEY_HISTORY_CLEARED])
            prefs[KEY_PLAY_HISTORY] = json.encodeToString(merged)
        }
    }

    suspend fun clearPlayHistory() {
        context.dataStore.edit {
            it[KEY_HISTORY_CLEARED] = Instant.now().toString()
            it[KEY_PLAY_HISTORY] = json.encodeToString(emptyList<PlayHistoryEntry>())
        }
    }

    private fun decodeHistory(raw: String?): List<PlayHistoryEntry> {
        if (raw.isNullOrBlank()) return emptyList()
        val array = runCatching { json.parseToJsonElement(raw).jsonArray }.getOrNull() ?: return emptyList()
        if (array.isEmpty()) return emptyList()
        val nested = (array.first() as? JsonObject)?.containsKey("track") == true
        if (nested) return runCatching { json.decodeFromString<List<PlayHistoryEntry>>(raw) }.getOrDefault(emptyList())
        val tracks = runCatching { json.decodeFromString<List<UnifiedTrack>>(raw) }.getOrDefault(emptyList())
        return tracks.map { PlayHistoryEntry(it.copy(streamUrl = null), playedAt = null) }
    }

    private fun mergeHistory(
        local: List<PlayHistoryEntry>,
        remote: List<ListeningHistoryItem>,
        clearedAt: String?,
    ): List<PlayHistoryEntry> {
        val clearedMs = clearedAt?.let(::epochMillis) ?: 0L
        val byKey = linkedMapOf<String, Pair<Long, PlayHistoryEntry>>()
        fun consider(key: String, atIso: String?, entry: PlayHistoryEntry) {
            if (atIso == null) return
            val at = epochMillis(atIso)
            if (clearedMs != 0L && at <= clearedMs) return
            val prev = byKey[key]
            if (prev == null || at > prev.first) byKey[key] = at to entry.copy(playedAt = atIso)
        }
        for (item in remote) {
            val track = item.toUnifiedTrack()
            consider(trackKey(track), item.playedAt, PlayHistoryEntry(track, item.playedAt))
        }
        for (entry in local) consider(trackKey(entry.track), entry.playedAt, entry)
        val timed = byKey.values.sortedByDescending { it.first }.map { it.second }
        val seen = timed.map { trackKey(it.track) }.toSet()
        val legacy = local.filter { it.playedAt == null && trackKey(it.track) !in seen }
        return (timed + legacy).take(PLAY_HISTORY_LIMIT)
    }

    private fun epochMillis(iso: String): Long = runCatching { Instant.parse(iso).toEpochMilli() }.getOrDefault(0L)

    private fun trackKey(track: UnifiedTrack) = "${track.source}:${track.id}"

    private fun sameTrack(a: UnifiedTrack, b: UnifiedTrack) = a.source == b.source && a.id == b.id

    suspend fun setApiBaseUrl(url: String) {
        context.dataStore.edit { it[KEY_API_BASE] = url.trimEnd('/') }
    }

    suspend fun getApiBaseUrl(): String = apiBaseUrl.first()

    suspend fun saveSession(session: AuthSession) {
        secureVault.set(VAULT_SESSION, json.encodeToString(session))
        vaultSession.value = session
        context.dataStore.edit { it.remove(KEY_SESSION) }
    }

    suspend fun loadSession(): AuthSession? = session.first()

    suspend fun updateAccessToken(accessToken: String) {
        val current = loadSession() ?: return
        saveSession(current.copy(accessToken = accessToken))
    }

    suspend fun clearSession() {
        secureVault.delete(VAULT_SESSION)
        vaultSession.value = null
        context.dataStore.edit { it.remove(KEY_SESSION) }
    }

    suspend fun getOrCreateDeviceId(): String {
        val existing = context.dataStore.data.first()[KEY_DEVICE_ID]
        if (existing != null) return existing
        val id = java.util.UUID.randomUUID().toString()
        context.dataStore.edit { it[KEY_DEVICE_ID] = id }
        return id
    }

    suspend fun savePlaybackSettings(settings: PlaybackSettings) {
        context.dataStore.edit { it[KEY_PLAYBACK] = json.encodeToString(settings) }
    }

    suspend fun loadPlaybackSettings(): PlaybackSettings = playbackSettings.first()

    suspend fun setOnboarded(value: Boolean) {
        context.dataStore.edit { it[KEY_ONBOARDED] = value }
    }

    suspend fun addSearchQuery(query: String) {
        val q = query.trim()
        if (q.isEmpty()) return
        val next = (listOf(q) + searchHistory.first().filter { it != q }).take(20)
        context.dataStore.edit { it[KEY_SEARCH] = json.encodeToString(next) }
    }

    fun connectorVault(): TokenVault = secureVault

    companion object {
        /** Пусто в локальной debug-сборке; в CI release — из `API_PUBLIC_URL`. */
        val DEFAULT_API_BASE: String = BuildConfig.BAKED_API_PUBLIC_URL
        private val KEY_API_BASE = stringPreferencesKey("api_base")
        private val KEY_SESSION = stringPreferencesKey("session")
        private const val VAULT_SESSION = "mss_session"
        private val KEY_DEVICE_ID = stringPreferencesKey("device_id")
        private val KEY_PLAYBACK = stringPreferencesKey("playback")
        private val KEY_SEARCH = stringPreferencesKey("search_history")
        private val KEY_ONBOARDED = booleanPreferencesKey("onboarded")
        private val KEY_PLAY_HISTORY = stringPreferencesKey("play_history")
        private val KEY_HISTORY_CLEARED = stringPreferencesKey("play_history_cleared_at")
        private const val PLAY_HISTORY_LIMIT = 200
    }
}

@Serializable
private data class PlayHistoryEntry(
    val track: UnifiedTrack,
    val playedAt: String? = null,
)

interface TokenVault {
    fun get(key: String): String?
    fun set(key: String, value: String)
    fun delete(key: String)
}

@Singleton
class SecureTokenVault @Inject constructor(
    @ApplicationContext context: Context,
) : TokenVault {
    private val masterKey = androidx.security.crypto.MasterKey.Builder(context)
        .setKeyScheme(androidx.security.crypto.MasterKey.KeyScheme.AES256_GCM)
        .build()
    private val prefs = androidx.security.crypto.EncryptedSharedPreferences.create(
        context,
        "mss_vault",
        masterKey,
        androidx.security.crypto.EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        androidx.security.crypto.EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    override fun get(key: String): String? = prefs.getString(key, null)

    override fun set(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }

    override fun delete(key: String) {
        prefs.edit().remove(key).apply()
    }
}
