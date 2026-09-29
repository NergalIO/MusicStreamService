package com.mss.android.ui.lobby

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavHostController

@Composable
fun LobbyScreen(nav: NavHostController, vm: LobbyViewModel = hiltViewModel()) {
    val lobby by vm.lobbyState.collectAsState()
    val list by vm.list.collectAsState()
    val error by vm.error.collectAsState()
    var title by remember { mutableStateOf("Listening party") }
    var code by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { vm.refresh() }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        error?.let {
            Text(it, color = MaterialTheme.colorScheme.error, maxLines = 4, overflow = TextOverflow.Ellipsis)
        }
        if (lobby == null) {
            OutlinedTextField(title, { title = it }, label = { Text("Название") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            Button({ vm.create(title, true) }, Modifier.fillMaxWidth()) { Text("Создать лобби") }
            OutlinedTextField(code, { code = it }, label = { Text("Код приглашения") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            Button({ vm.join(code) }, Modifier.fillMaxWidth(), enabled = code.isNotBlank()) { Text("Войти") }
            Text("Публичные", style = MaterialTheme.typography.titleMedium)
            list.forEach { item ->
                TextButton(
                    { vm.join(item.inviteCode) },
                    Modifier.fillMaxWidth(),
                ) {
                    Text(
                        "${item.title} · ${item.listeners} слушателей",
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        } else {
            Text("${lobby!!.title} · код ${lobby!!.inviteCode}", maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text("Участников: ${lobby!!.members.size}")
            if (!vm.isHost()) {
                Text(
                    "Найдите трек в поиске или медиатеке и в меню нажмите «Предложить». DJ увидит заявку здесь.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            lobby!!.queue.forEach { item ->
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        "${item.track.title} (${item.status})",
                        modifier = Modifier.weight(1f),
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (vm.isHost() && item.status == "suggested") {
                        TextButton({ vm.accept(item.id) }) { Text("Ок") }
                        TextButton({ vm.reject(item.id) }) { Text("Нет") }
                    }
                }
            }
            Button({ vm.leave() }, Modifier.fillMaxWidth()) { Text("Выйти") }
        }
    }
}
