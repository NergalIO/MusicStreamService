package com.mss.android.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.mss.android.BuildConfig
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class UpdateUi(
    val current: String = BuildConfig.VERSION_NAME,
    val latest: String? = null,
    val apkUrl: String? = null,
    val checking: Boolean = false,
    /** 0..1 во время скачивания. */
    val progress: Float? = null,
    val readyFile: String? = null,
    val error: String? = null,
    /** Результат ручной проверки: «установлена последняя версия». */
    val upToDate: Boolean = false,
    val dismissed: Boolean = false,
) {
    val available: Boolean get() = latest != null && apkUrl != null && isNewer(latest, current)
}

/** Сравнение x.y.z: суффиксы вроде -beta игнорируются. */
internal fun isNewer(candidate: String, current: String): Boolean {
    fun parts(v: String) = v.substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
    val a = parts(candidate)
    val b = parts(current)
    for (i in 0 until maxOf(a.size, b.size)) {
        val x = a.getOrElse(i) { 0 }
        val y = b.getOrElse(i) { 0 }
        if (x != y) return x > y
    }
    return false
}

/**
 * Обновление APK из последнего релиза GitHub (через /site/downloads сервера MSS):
 * проверка версии, скачивание в кеш и запуск системного установщика.
 */
@Singleton
class AppUpdater @Inject constructor(
    @ApplicationContext private val context: Context,
    private val repo: MssRepository,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val prefs = context.getSharedPreferences("mss_updates", Context.MODE_PRIVATE)
    private val _state = MutableStateFlow(UpdateUi())
    val state: StateFlow<UpdateUi> = _state
    private var downloadJob: Job? = null
    private var checkedThisLaunch = false

    var autoCheck: Boolean
        get() = prefs.getBoolean(KEY_AUTO, true)
        set(value) = prefs.edit().putBoolean(KEY_AUTO, value).apply()

    /** Автопроверка один раз за запуск. Debug-сборки подписаны другим ключом — релиз поверх них не встанет. */
    fun checkOnLaunch() {
        if (checkedThisLaunch || !autoCheck || BuildConfig.DEBUG) return
        checkedThisLaunch = true
        scope.launch { check(manual = false) }
    }

    fun checkNow() {
        scope.launch { check(manual = true) }
    }

    private suspend fun check(manual: Boolean) {
        if (_state.value.checking) return
        _state.value = _state.value.copy(checking = true, error = null, upToDate = false)
        val result = runCatching {
            val info = repo.apiClient.siteDownloads()
            val base = repo.apiClient.apiBase()
            val url = info.androidApkUrl?.let { resolve(base, it) }
            info.version to url
        }
        result.onSuccess { (latest, url) ->
            val skipped = !manual && latest != null && prefs.getString(KEY_SKIPPED, null) == latest
            val next = _state.value.copy(checking = false, latest = latest, apkUrl = url, dismissed = skipped)
            _state.value = next.copy(upToDate = manual && !next.available)
        }.onFailure {
            _state.value = _state.value.copy(
                checking = false,
                error = if (manual) "Не удалось проверить обновления" else null,
            )
        }
    }

    private fun resolve(base: String, href: String): String =
        if (href.startsWith("http://") || href.startsWith("https://")) href
        else URI(base.trimEnd('/') + "/").resolve(href.trimStart('/')).toString()

    /** «Позже» в диалоге: эту версию автоматически больше не предлагаем, в настройках она остаётся. */
    fun dismiss() {
        _state.value.latest?.let { prefs.edit().putString(KEY_SKIPPED, it).apply() }
        _state.value = _state.value.copy(dismissed = true)
    }

    fun download() {
        val s = _state.value
        val url = s.apkUrl ?: return
        val version = s.latest ?: return
        if (downloadJob?.isActive == true) return
        s.readyFile?.let { file ->
            if (File(file).exists()) {
                install()
                return
            }
        }
        downloadJob = scope.launch {
            _state.value = _state.value.copy(progress = 0f, error = null)
            val file = runCatching { fetch(url, version) }.getOrElse {
                _state.value = _state.value.copy(progress = null, error = "Не удалось скачать обновление")
                return@launch
            }
            _state.value = _state.value.copy(progress = null, readyFile = file.absolutePath)
            install()
        }
    }

    fun cancelDownload() {
        downloadJob?.cancel()
        _state.value = _state.value.copy(progress = null)
    }

    private suspend fun fetch(url: String, version: String): File = withContext(Dispatchers.IO) {
        val dir = File(context.cacheDir, "updates").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val target = File(dir, "mss-$version.apk")
        val part = File(dir, "mss-$version.apk.part")
        var conn = open(url)
        var redirects = 0
        while (conn.responseCode in 300..399 && redirects < 5) {
            val location = conn.getHeaderField("Location") ?: break
            conn.disconnect()
            conn = open(URL(URL(url), location).toString())
            redirects++
        }
        if (conn.responseCode !in 200..299) error("HTTP ${conn.responseCode}")
        val total = conn.contentLengthLong
        conn.inputStream.use { input ->
            part.outputStream().use { output ->
                val buf = ByteArray(64 * 1024)
                var read = 0L
                var lastEmit = 0L
                while (isActive) {
                    val n = input.read(buf)
                    if (n < 0) break
                    output.write(buf, 0, n)
                    read += n
                    if (total > 0 && read - lastEmit > 256 * 1024) {
                        lastEmit = read
                        val p = (read.toFloat() / total).coerceIn(0f, 1f)
                        withContext(Dispatchers.Main) { _state.value = _state.value.copy(progress = p) }
                    }
                }
            }
        }
        conn.disconnect()
        if (!isActive) error("cancelled")
        if (!part.renameTo(target)) error("rename")
        target
    }

    private fun open(url: String): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = false
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("User-Agent", "MusicStreamService-Android/${BuildConfig.VERSION_NAME}")
        }

    /** true — установщик открыт; false — сначала нужно разрешить установку из этого приложения. */
    fun install(): Boolean {
        val path = _state.value.readyFile ?: return false
        val file = File(path)
        if (!file.exists()) {
            _state.value = _state.value.copy(readyFile = null)
            return false
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
            val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            runCatching { context.startActivity(intent) }
            pendingInstall = true
            return false
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", file)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        return runCatching { context.startActivity(intent) }.isSuccess
    }

    private var pendingInstall = false

    /** Вызывать при возвращении в приложение: после выдачи разрешения установка продолжается сама. */
    fun onResume() {
        if (!pendingInstall) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) return
        pendingInstall = false
        install()
    }

    private companion object {
        const val KEY_AUTO = "auto_check"
        const val KEY_SKIPPED = "skipped_version"
    }
}
