package com.mss.core.model

data class EqPreset(
    val id: String,
    val label: String,
    val bands: List<Float>,
)

object EqPresets {
    val frequencies = listOf("60", "150", "400", "1k", "2.4k", "6k", "10k", "15k")

    val all = listOf(
        EqPreset("flat", "Ровно", listOf(0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f)),
        EqPreset("bass", "Бас", listOf(6f, 4f, 2f, 0f, 0f, 0f, 0f, 0f)),
        EqPreset("treble", "Высокие", listOf(0f, 0f, 0f, 0f, 2f, 4f, 6f, 6f)),
        EqPreset("vocal", "Вокал", listOf(-2f, -1f, 0f, 2f, 4f, 2f, 0f, -1f)),
        EqPreset("rock", "Рок", listOf(4f, 3f, -2f, -3f, -1f, 2f, 3f, 4f)),
        EqPreset("pop", "Поп", listOf(-1f, 2f, 3f, 1f, -1f, -1f, 2f, 3f)),
        EqPreset("electronic", "Электроника", listOf(5f, 3f, 0f, -2f, 0f, 2f, 4f, 5f)),
        EqPreset("classical", "Классика", listOf(3f, 2f, 0f, 0f, 0f, 0f, 2f, 3f)),
    )

    fun padded(bands: List<Float>): List<Float> = (bands + List(8) { 0f }).take(8)

    fun matching(bands: List<Float>): EqPreset? {
        val current = padded(bands)
        return all.find { preset ->
            preset.bands.indices.all { i -> kotlin.math.abs(preset.bands[i] - current[i]) < 0.51f }
        }
    }
}
