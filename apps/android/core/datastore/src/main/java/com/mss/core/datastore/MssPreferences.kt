package com.mss.core.datastore

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.mss.core.model.AuthSession
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
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

    val session: Flow<AuthSession?> = context.dataStore.data.map { prefs ->
        prefs[KEY_SESSION]?.let { json.decodeFromString<AuthSession>(it) }
    }

    suspend fun setApiBaseUrl(url: String) {
        context.dataStore.edit { it[KEY_API_BASE] = url.trimEnd('/') }
    }

    suspend fun getApiBaseUrl(): String = apiBaseUrl.first()

    suspend fun saveSession(session: AuthSession) {
        context.dataStore.edit { it[KEY_SESSION] = json.encodeToString(session) }
    }

    suspend fun loadSession(): AuthSession? = session.first()

    suspend fun updateAccessToken(accessToken: String) {
        val current = loadSession() ?: return
        saveSession(current.copy(accessToken = accessToken))
    }

    suspend fun clearSession() {
        context.dataStore.edit { it.remove(KEY_SESSION) }
    }

    suspend fun getOrCreateDeviceId(): String {
        val existing = context.dataStore.data.first()[KEY_DEVICE_ID]
        if (existing != null) return existing
        val id = java.util.UUID.randomUUID().toString()
        context.dataStore.edit { it[KEY_DEVICE_ID] = id }
        return id
    }

    fun connectorVault(): TokenVault = secureVault

    companion object {
        const val DEFAULT_API_BASE = "http://10.0.2.2:3001"
        private val KEY_API_BASE = stringPreferencesKey("api_base")
        private val KEY_SESSION = stringPreferencesKey("session")
        private val KEY_DEVICE_ID = stringPreferencesKey("device_id")
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
