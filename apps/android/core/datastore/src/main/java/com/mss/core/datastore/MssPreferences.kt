package com.mss.core.datastore

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.mss.core.model.AuthSession
import com.mss.core.model.PlaybackSettings
import com.mss.core.model.UnifiedTrack
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

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
        prefs[KEY_PLAY_HISTORY]?.let { runCatching { json.decodeFromString<List<UnifiedTrack>>(it) }.getOrNull() } ?: emptyList()
    }

    suspend fun addPlayHistory(track: UnifiedTrack) {
        val entry = track.copy(streamUrl = null)
        context.dataStore.edit { prefs ->
            val current = prefs[KEY_PLAY_HISTORY]?.let { runCatching { json.decodeFromString<List<UnifiedTrack>>(it) }.getOrNull() }.orEmpty()
            val next = (listOf(entry) + current.filterNot { it.source == entry.source && it.id == entry.id }).take(PLAY_HISTORY_LIMIT)
            prefs[KEY_PLAY_HISTORY] = json.encodeToString(next)
        }
    }

    suspend fun clearPlayHistory() {
        context.dataStore.edit { it.remove(KEY_PLAY_HISTORY) }
    }

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
        private const val PLAY_HISTORY_LIMIT = 200
    }
}

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
