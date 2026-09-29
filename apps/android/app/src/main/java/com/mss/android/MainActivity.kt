package com.mss.android

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.mss.android.ui.MssApp
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    private var incoming: Uri? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        incoming = intent?.data
        render()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        incoming = intent.data
        render()
    }

    private fun render() {
        setContent {
            MssApp(incomingUri = incoming)
        }
    }
}
