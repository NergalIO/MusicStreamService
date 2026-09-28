package com.mss.android

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import com.mss.android.ui.MssApp
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    private var spotifyUri: Uri? = null
    private var openUri: Uri? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        splitIntent(intent)
        render()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        splitIntent(intent)
        render()
    }

    private fun splitIntent(intent: Intent?) {
        val data = intent?.data
        spotifyUri = if (data?.host == "spotify") data else spotifyUri
        openUri = if (data?.host == "open") data else openUri
    }

    private fun render() {
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                MssApp(spotifyCallback = spotifyUri, openUri = openUri)
            }
        }
    }
}
