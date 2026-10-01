package com.mss.android.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import com.mss.core.datastore.MssPreferences
import com.mss.core.localtracks.LocalTrackStore
import com.mss.core.network.MssApiClient
import com.mss.core.network.PresenceClient
import com.mss.core.network.RelayUploadService
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

@Singleton
class RelayCoordinator @Inject constructor(
    @ApplicationContext private val context: Context,
    private val presence: PresenceClient,
    private val local: LocalTrackStore,
    private val api: MssApiClient,
    private val prefs: MssPreferences,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    init {
        presence.resolveHolding = { local.get(it) }
        scope.launch {
            presence.relay.collect { msg ->
                val holding = local.get(msg.trackId)
                if (holding == null) {
                    presence.notifyNeedFile(msg)
                    return@collect
                }
                val session = prefs.loadSession() ?: return@collect
                val intent = Intent(context, RelayUploadService::class.java)
                runCatching {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        context.startForegroundService(intent)
                    } else {
                        context.startService(intent)
                    }
                }
                runCatching {
                    val bytes = local.readBytes(Uri.parse(holding.uri))
                    api.relayUpload(
                        msg.uploadUrl,
                        msg.token,
                        session.accessToken,
                        holding.displayName ?: "audio",
                        bytes,
                    )
                }
                context.stopService(intent)
            }
        }
    }
}
