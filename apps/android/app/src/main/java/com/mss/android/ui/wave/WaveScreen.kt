package com.mss.android.ui.wave

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import com.mss.android.ui.components.MssChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.mss.android.ui.MssViewModel
import com.mss.android.ui.theme.ChipFlow
import com.mss.core.model.WaveSettings

@Composable
fun WaveScreen(vm: MssViewModel) {
    var mood by remember { mutableStateOf<String?>(null) }
    var diversity by remember { mutableStateOf<String?>(null) }
    var language by remember { mutableStateOf<String?>(null) }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            "Настроение, любимое или открытия — волна подстроится.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
        Text("Настроение", style = MaterialTheme.typography.labelLarge)
        ChipFlow {
            MssChip(mood == "fun", "Весело") { mood = if (mood == "fun") null else "fun" }
            MssChip(mood == "calm", "Спокойно") { mood = if (mood == "calm") null else "calm" }
            MssChip(mood == "sad", "Грустно") { mood = if (mood == "sad") null else "sad" }
        }
        Text("Разнообразие", style = MaterialTheme.typography.labelLarge)
        ChipFlow {
            MssChip(diversity == "favorite", "Любимое") { diversity = if (diversity == "favorite") null else "favorite" }
            MssChip(diversity == "discover", "Открытия") { diversity = if (diversity == "discover") null else "discover" }
        }
        Text("Язык", style = MaterialTheme.typography.labelLarge)
        ChipFlow {
            MssChip(language == "russian", "Русский") { language = if (language == "russian") null else "russian" }
            MssChip(language == "not-russian", "Иностранный") { language = if (language == "not-russian") null else "not-russian" }
        }
        Button(
            { vm.startWave(WaveSettings(moodEnergy = mood, diversity = diversity, language = language)) },
            Modifier.fillMaxWidth(),
        ) { Text("Запустить волну") }
    }
}
