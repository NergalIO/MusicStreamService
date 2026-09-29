package com.mss.core.connectors

import com.mss.core.model.LyricsLine
import com.mss.core.model.TrackLyrics
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Разбор ответа color-lyrics веб-плеера Spotify. Тайминги — как на десктопе. */
fun mapSpotifyLyrics(root: JsonObject): TrackLyrics? {
    val block = root["lyrics"] as? JsonObject ?: return null
    val rawLines = block["lines"] as? JsonArray ?: return null
    if (rawLines.isEmpty()) return null
    val sync = block["syncType"]?.jsonPrimitive?.contentOrNull?.uppercase().orEmpty()
    val synced = sync == "LINE_SYNCED" || sync == "SYLLABLE_SYNCED"
    val lines = rawLines.map { element ->
        val line = element.jsonObject
        val time = if (synced) line["startTimeMs"]?.jsonPrimitive?.contentOrNull?.toLongOrNull() ?: 0L else -1L
        LyricsLine(time, spotifyLineWords(line["words"]))
    }.filter { it.text.isNotBlank() || synced }
    if (lines.none { it.text.isNotBlank() }) return null
    val writers = block["credits"]?.jsonObject?.get("sourceNames")?.jsonArray
        ?.mapNotNull { it.jsonPrimitive.contentOrNull?.takeIf(String::isNotBlank) }
    return TrackLyrics(synced, lines, writers?.takeIf { it.isNotEmpty() })
}

private fun spotifyLineWords(words: JsonElement?): String = when (words) {
    is JsonPrimitive -> words.contentOrNull.orEmpty()
    is JsonArray -> words.joinToString("") { part ->
        when (part) {
            is JsonPrimitive -> part.contentOrNull.orEmpty()
            is JsonObject -> part["string"]?.jsonPrimitive?.contentOrNull.orEmpty()
            else -> ""
        }
    }
    else -> ""
}
