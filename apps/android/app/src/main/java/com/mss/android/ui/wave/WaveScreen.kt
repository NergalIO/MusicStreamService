package com.mss.android.ui.wave

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.mss.android.ui.MssViewModel
import com.mss.core.model.WaveSettings

@Composable
fun WaveScreen(vm: MssViewModel) {
    var mood by remember { mutableStateOf<String?>(null) }
    var diversity by remember { mutableStateOf<String?>(null) }
    var language by remember { mutableStateOf<String?>(null) }
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Моя волна")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(mood == "fun", { mood = "fun" }, label = { Text("Весело") })
            FilterChip(mood == "calm", { mood = "calm" }, label = { Text("Спокойно") })
            FilterChip(mood == "sad", { mood = "sad" }, label = { Text("Грустно") })
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(diversity == "favorite", { diversity = "favorite" }, label = { Text("Любимое") })
            FilterChip(diversity == "discover", { diversity = "discover" }, label = { Text("Открытия") })
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(language == "russian", { language = "russian" }, label = { Text("Русский") })
            FilterChip(language == "not-russian", { language = "not-russian" }, label = { Text("Иностранный") })
        }
        Button({
            vm.startWave(WaveSettings(moodEnergy = mood, diversity = diversity, language = language))
        }) { Text("Старт") }
    }
}
