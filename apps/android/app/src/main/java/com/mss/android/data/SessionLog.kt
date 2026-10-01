package com.mss.android.data

import android.content.Context
import android.os.Build
import com.mss.android.BuildConfig
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ConcurrentLinkedDeque
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Локальная лента сессии для разбора сбоев: без отправки на сервер и без токенов.
 * Хвост держим в памяти и дублируем в два файла по 1 МБ.
 */
@Singleton
class SessionLog @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val ring = ConcurrentLinkedDeque<String>()
    private val writeMutex = Mutex()
    private var currentBytes = File(File(context.filesDir, "session-logs"), LOG_A).takeIf { it.isFile }?.length() ?: 0L

    val dir: File get() = File(context.filesDir, "session-logs").also { it.mkdirs() }

    fun info(category: String, message: String) = event("info", category, message)
    fun warn(category: String, message: String) = event("warn", category, message)
    fun error(category: String, message: String) = event("error", category, message)

    fun event(level: String, category: String, message: String) {
        val line = "${stamp()} ${level.uppercase()} [$category] ${maskSecrets(message)}"
        while (ring.size >= RING) ring.pollFirst()
        ring.addLast(line)
        scope.launch { append(line) }
    }

    fun recordCrash(throwable: Throwable) {
        val stack = maskSecrets(throwable.stackTraceToString())
        event("error", "crash", "${throwable.javaClass.simpleName}: ${throwable.message}")
        runCatching {
            File(dir, CRASH_FILE).writeText("${stamp()}\n$stack\n")
        }
        flushBlocking()
    }

    fun installUncaughtHandler() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching { recordCrash(error) }
            previous?.uncaughtException(thread, error)
        }
    }

    /** Собирает txt для «Поделиться». Файл лежит в каталоге, который отдаёт FileProvider. */
    fun export(): File {
        val stamp = SimpleDateFormat("yyyyMMdd-HHmm", Locale.US).format(Date())
        val out = File(dir, "mss-session-$stamp.txt")
        out.writeText(buildDump())
        return out
    }

    private fun buildDump(): String = buildString {
        appendLine("MusicStreamService — дамп сессии")
        appendLine("Версия: ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
        appendLine("Сборка: ${if (BuildConfig.DEBUG) "debug" else "release"}")
        appendLine("ОС: Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT}) ${Build.MANUFACTURER} ${Build.MODEL}")
        appendLine("Время: ${stamp()}")
        appendLine()
        appendLine("Токены и пароли в дамп не входят.")
        appendLine()
        appendLine("--- Последний сбой ---")
        val crash = File(dir, CRASH_FILE)
        appendLine(if (crash.isFile) maskSecrets(crash.readText()) else "(сбоев нет)")
        appendLine()
        appendLine("--- Сессия ---")
        val fromDisk = runCatching { readRotated() }.getOrNull()
        if (!fromDisk.isNullOrBlank()) {
            appendLine(fromDisk)
        } else {
            ring.forEach { appendLine(it) }
        }
        appendLine()
    }

    private fun readRotated(): String {
        val a = File(dir, LOG_A)
        val b = File(dir, LOG_B)
        val parts = listOf(a, b).filter { it.isFile }.sortedBy { it.lastModified() }
        return parts.joinToString("\n") { it.readText().trimEnd() }
    }

    private suspend fun append(line: String) {
        writeMutex.withLock {
            val file = File(dir, LOG_A)
            file.appendText(line + "\n")
            currentBytes = file.length()
            if (currentBytes >= FILE_MAX) rotate()
        }
    }

    private fun rotate() {
        val a = File(dir, LOG_A)
        val b = File(dir, LOG_B)
        if (b.exists()) b.delete()
        a.renameTo(b)
        currentBytes = 0
    }

    private fun flushBlocking() {
        // Запись шла асинхронно: для краша дожимаем кольцо на диск.
        runCatching {
            File(dir, LOG_A).appendText(ring.toList().takeLast(50).joinToString("\n", postfix = "\n"))
        }
    }

    companion object {
        private const val RING = 2_000
        private const val FILE_MAX = 1 * 1024 * 1024L
        const val LOG_A = "session.log"
        const val LOG_B = "session.prev.log"
        const val CRASH_FILE = "last-crash.txt"

        private val secretPatterns: List<Pair<Regex, String>> = listOf(
            Regex("""\b(OAuth|Bearer)\s+[\w.~+/=-]+""", RegexOption.IGNORE_CASE) to "$1 ***",
            Regex("""\by0_[\w-]{10,}""") to "y0_***",
            Regex(
                """((?:access|refresh|id)_?token|client_secret|authorization|password)(["']?\s*[:=]\s*["']?)[^\s"'&,}]+""",
                RegexOption.IGNORE_CASE,
            ) to "$1$2***",
        )

        fun maskSecrets(text: String): String =
            secretPatterns.fold(text) { acc, (re, to) -> acc.replace(re, to) }

        private fun stamp(): String =
            SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US).format(Date())
    }
}
