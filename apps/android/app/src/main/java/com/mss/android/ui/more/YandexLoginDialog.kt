package com.mss.android.ui.more

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.mss.android.ui.LoginPopupChrome
import com.mss.android.ui.prepareLogin
import com.mss.core.model.DeviceCodePrompt

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun YandexLoginDialog(prompt: DeviceCodePrompt, onCancel: () -> Unit, modifier: Modifier = Modifier) {
    var copied by remember(prompt.userCode) { mutableStateOf(false) }
    val ctx = LocalContext.current
    val copy = {
        copyCode(ctx, prompt.userCode)
        copied = true
    }
    Column(
        modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .statusBarsPadding()
            .imePadding()
            .navigationBarsPadding(),
    ) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "Яндекс Музыка",
                    modifier = Modifier.weight(1f).padding(start = 8.dp),
                    style = MaterialTheme.typography.titleMedium,
                )
                TextButton(onClick = onCancel) { Text("Отмена") }
            }
            Text(
                "Страница ya.ru/device откроется здесь, код вставится сам. Подтвердите доступ к Яндекс.Музыке — одного Яндекс ID недостаточно.",
                modifier = Modifier.padding(horizontal = 16.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                prompt.userCode,
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = copy)
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.SemiBold,
                fontSize = 28.sp,
                letterSpacing = 4.sp,
            )
            TextButton(onClick = copy, modifier = Modifier.padding(horizontal = 8.dp)) {
                Text(if (copied) "Код скопирован" else "Скопировать код")
            }
        AndroidView(
            factory = { viewCtx ->
                android.widget.FrameLayout(viewCtx).apply {
                    setBackgroundColor(android.graphics.Color.WHITE)
                    val web = WebView(viewCtx)
                    addView(
                        web,
                        android.widget.FrameLayout.LayoutParams(
                            android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                            android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                        ),
                    )
                    web.prepareLogin(MOBILE_UA)
                    web.webViewClient = object : WebViewClient() {
                        override fun onPageFinished(view: WebView?, url: String?) {
                            val target = view ?: return
                            val script = fillDeviceCode(prompt.userCode)
                            target.evaluateJavascript(script, null)
                            target.postDelayed({ target.evaluateJavascript(script, null) }, 700)
                            target.postDelayed({ target.evaluateJavascript(script, null) }, 1800)
                        }
                    }
                    web.webChromeClient = LoginPopupChrome(this, MOBILE_UA)
                    web.loadUrl("https://ya.ru/device")
                    web.requestFocus()
                }
            },
            modifier = Modifier.fillMaxWidth().weight(1f),
            onRelease = { frame ->
                for (i in frame.childCount - 1 downTo 0) {
                    (frame.getChildAt(i) as? WebView)?.destroy()
                }
            },
        )
    }
}

private const val MOBILE_UA =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36"

private fun copyCode(ctx: Context, code: String) {
    val clipboard = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("yandex-device-code", code))
}

private fun fillDeviceCode(code: String): String {
    val safe = code.filter { it.isLetterOrDigit() || it == '-' }
    return """
        (function(){
          const code = '$safe';
          const inputs = Array.from(document.querySelectorAll('input')).filter((el) => {
            const type = (el.type || 'text').toLowerCase();
            return type !== 'hidden' && type !== 'password' && type !== 'checkbox' && type !== 'submit' && !el.disabled;
          });
          const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          const set = (el, value) => {
            proto.set.call(el, value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          };
          const boxes = inputs.filter((el) => el.maxLength === 1);
          const chars = code.replace(/-/g, '');
          if (boxes.length >= chars.length && boxes.length >= 4) {
            if (chars.split('').every((ch, i) => boxes[i].value === ch)) return;
            chars.split('').forEach((ch, i) => set(boxes[i], ch));
            boxes[0].scrollIntoView({ block: 'center' });
            return;
          }
          const field = inputs.find((el) => /code|код|user_code/i.test(
            (el.name || '') + (el.id || '') + (el.placeholder || '') + (el.getAttribute('aria-label') || '')
          )) || inputs.find((el) => el.maxLength >= chars.length && el.maxLength <= 32);
          if (!field || field.value.replace(/\s/g, '') === code) return;
          set(field, code);
          field.scrollIntoView({ block: 'center' });
          const root = field.closest('form') || document;
          const button = Array.from(root.querySelectorAll('button')).find((b) =>
            /^(далее|продолжить|войти)$/i.test((b.textContent || '').trim())
          );
          if (button) button.click();
        })();
    """.trimIndent()
}
