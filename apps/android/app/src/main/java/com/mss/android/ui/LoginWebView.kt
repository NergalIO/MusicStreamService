package com.mss.android.ui

import android.annotation.SuppressLint
import android.graphics.Color
import android.os.Message
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout

@SuppressLint("SetJavaScriptEnabled")
fun WebView.prepareLogin(userAgent: String) {
    setBackgroundColor(Color.WHITE)
    layoutParams = FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
    )
    val cookies = CookieManager.getInstance()
    cookies.setAcceptCookie(true)
    cookies.setAcceptThirdPartyCookies(this, true)
    settings.javaScriptEnabled = true
    settings.domStorageEnabled = true
    settings.databaseEnabled = true
    settings.loadsImagesAutomatically = true
    settings.javaScriptCanOpenWindowsAutomatically = true
    settings.setSupportMultipleWindows(true)
    settings.useWideViewPort = true
    settings.loadWithOverviewMode = true
    settings.mediaPlaybackRequiresUserGesture = false
    settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
    settings.setSupportZoom(false)
    settings.builtInZoomControls = false
    settings.displayZoomControls = false
    settings.userAgentString = userAgent
    isVerticalScrollBarEnabled = true
    isHorizontalScrollBarEnabled = false
    isFocusable = true
    isFocusableInTouchMode = true
    setLayerType(WebView.LAYER_TYPE_HARDWARE, null)
}

/** Всплывающие окна входа (VK ID, Spotify) рисуем поверх той же страницы, а не в пустом окне. */
class LoginPopupChrome(
    private val host: FrameLayout,
    private val userAgent: String,
) : WebChromeClient() {
    override fun onCreateWindow(
        view: WebView,
        isDialog: Boolean,
        isUserGesture: Boolean,
        resultMsg: Message,
    ): Boolean {
        val popup = WebView(host.context)
        popup.prepareLogin(userAgent)
        popup.webViewClient = view.webViewClient
        popup.webChromeClient = this
        host.addView(
            popup,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        val transport = resultMsg.obj as WebView.WebViewTransport
        transport.webView = popup
        resultMsg.sendToTarget()
        return true
    }

    override fun onCloseWindow(window: WebView) {
        (window.parent as? FrameLayout)?.removeView(window)
        window.destroy()
    }
}
