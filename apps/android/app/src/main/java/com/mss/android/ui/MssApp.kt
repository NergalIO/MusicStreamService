package com.mss.android.ui

import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.mss.core.model.SourceId

@Composable
fun MssApp(
    vm: MssViewModel = hiltViewModel(),
    spotifyCallback: Uri? = null,
    openUri: Uri? = null,
) {
    val session by vm.session.collectAsState()
    val nav = rememberNavController()

    LaunchedEffect(spotifyCallback) {
        val uri = spotifyCallback ?: return@LaunchedEffect
        val code = uri.getQueryParameter("code") ?: return@LaunchedEffect
        val state = uri.getQueryParameter("state") ?: return@LaunchedEffect
        vm.completeSpotify(code, state)
    }

    LaunchedEffect(openUri) {
        val uri = openUri ?: return@LaunchedEffect
        if (uri.scheme == "mss" && uri.host == "open") vm.openDeepLink(uri)
    }

    if (session == null) {
        LoginScreen(vm)
        return
    }

    val backStack by nav.currentBackStackEntryAsState()
    val route = backStack?.destination?.route ?: Routes.HOME

    Scaffold(
        topBar = { TopBar(title = titleFor(route)) },
        bottomBar = { MssBottomBar(nav, route) },
        floatingActionButton = {},
    ) { padding ->
        NavHost(
            navController = nav,
            startDestination = Routes.HOME,
            modifier = Modifier.padding(padding),
        ) {
            composable(Routes.HOME) {
                LaunchedEffect(Unit) { vm.loadHome() }
                TrackListScreen(vm, "Недавние треки")
            }
            composable(Routes.SEARCH) { SearchScreen(vm) }
            composable(Routes.LIBRARY) { LibraryHubScreen(nav, vm) }
            composable(Routes.LIBRARY_MSS) {
                LaunchedEffect(Unit) { vm.loadLikes() }
                TrackListScreen(vm, "MSS — понравилось")
            }
            composable(Routes.SPOTIFY) {
                LaunchedEffect(Unit) { vm.loadSpotifyLibrary() }
                TrackListScreen(vm, "Spotify")
            }
            composable(Routes.YANDEX) {
                LaunchedEffect(Unit) { vm.loadYandexLibrary() }
                TrackListScreen(vm, "Яндекс Музыка")
            }
            composable(Routes.STATS) { StatsScreen(vm) }
            composable(Routes.SUBSCRIPTION) { SubscriptionScreen(vm) }
            composable(Routes.WAVE) {
                Column(Modifier.padding(16.dp)) {
                    Text("Моя волна (Яндекс)")
                    Button(onClick = { vm.startWave() }) { Text("Старт") }
                }
            }
            composable(Routes.SETTINGS) { SettingsScreen(vm) }
        }
        MiniPlayerBar(vm)
    }
}

@Composable
private fun LoginScreen(vm: MssViewModel) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var register by remember { mutableStateOf(false) }
    val error by vm.error.collectAsState()

    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("MusicStreamService", style = MaterialTheme.typography.headlineMedium)
        OutlinedTextField(email, { email = it }, label = { Text("Email") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(password, { password = it }, label = { Text("Пароль") }, modifier = Modifier.fillMaxWidth())
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Button(onClick = { vm.login(email, password, register) }, modifier = Modifier.fillMaxWidth()) {
            Text(if (register) "Регистрация" else "Войти")
        }
        Button(onClick = { register = !register }, modifier = Modifier.fillMaxWidth()) {
            Text(if (register) "Уже есть аккаунт" else "Создать аккаунт")
        }
    }
}

@Composable
private fun SearchScreen(vm: MssViewModel) {
    var q by remember { mutableStateOf("") }
    var source by remember { mutableStateOf<SourceId?>(null) }
    Column(Modifier.padding(16.dp)) {
        OutlinedTextField(q, { q = it }, label = { Text("Запрос") }, modifier = Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { source = null }) { Text("Все") }
            Button(onClick = { source = SourceId.LOCAL }) { Text("MSS") }
            Button(onClick = { source = SourceId.YANDEX }) { Text("Яндекс") }
            Button(onClick = { source = SourceId.SPOTIFY }) { Text("Spotify") }
        }
        Button(onClick = { vm.search(q, source) }, modifier = Modifier.padding(top = 8.dp)) { Text("Искать") }
        TrackListScreen(vm, null)
    }
}

@Composable
private fun LibraryHubScreen(nav: NavHostController, vm: MssViewModel) {
    val ctx = LocalContext.current
    var yandexPrompt by remember { mutableStateOf<com.mss.core.model.DeviceCodePrompt?>(null) }
    yandexPrompt?.let { prompt ->
        AlertDialog(
            onDismissRequest = { yandexPrompt = null },
            title = { Text("Яндекс Музыка") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Код: ${prompt.userCode}")
                    Text("Откройте ${prompt.verificationUrl} и введите код")
                }
            },
            confirmButton = {
                Button(onClick = {
                    CustomTabsIntent.Builder().build().launchUrl(ctx, Uri.parse(prompt.verificationUrl))
                }) { Text("Открыть") }
            },
            dismissButton = {
                Button(onClick = { yandexPrompt = null }) { Text("Закрыть") }
            },
        )
    }
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = { nav.navigate(Routes.LIBRARY_MSS) }, modifier = Modifier.fillMaxWidth()) { Text("MSS") }
        Button(onClick = { nav.navigate(Routes.SPOTIFY) }, modifier = Modifier.fillMaxWidth()) { Text("Spotify") }
        Button(onClick = { nav.navigate(Routes.YANDEX) }, modifier = Modifier.fillMaxWidth()) { Text("Яндекс") }
        Button(onClick = { nav.navigate(Routes.STATS) }, modifier = Modifier.fillMaxWidth()) { Text("Статистика") }
        Button(onClick = { nav.navigate(Routes.SUBSCRIPTION) }, modifier = Modifier.fillMaxWidth()) { Text("Подписка") }
        Button(onClick = { nav.navigate(Routes.WAVE) }, modifier = Modifier.fillMaxWidth()) { Text("Моя волна") }
        Button(
            onClick = {
                vm.connectSpotify { url ->
                    CustomTabsIntent.Builder().build().launchUrl(ctx, Uri.parse(url))
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Подключить Spotify") }
        Button(
            onClick = { vm.connectYandex { p -> yandexPrompt = p } },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Подключить Яндекс") }
    }
}

@Composable
private fun TrackListScreen(vm: MssViewModel, title: String?) {
    val tracks by vm.tracks.collectAsState()
    val error by vm.error.collectAsState()
    Column {
        title?.let { Text(it, modifier = Modifier.padding(16.dp), style = MaterialTheme.typography.titleMedium) }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp)) }
        LazyColumn {
            items(tracks, key = { "${it.source}:${it.id}" }) { track ->
                Row(
                    Modifier.fillMaxWidth().clickable { vm.play(tracks, tracks.indexOf(track)) }.padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(track.title)
                        Text(track.artist, style = MaterialTheme.typography.bodySmall)
                    }
                    Button(onClick = { vm.download(track) }) { Text("↓") }
                    if (track.source == SourceId.YANDEX) {
                        Button(onClick = { vm.loadSimilar(track) }) { Text("~") }
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsScreen(vm: MssViewModel) {
    var url by remember { mutableStateOf("http://10.0.2.2:3001") }
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(url, { url = it }, label = { Text("URL API") }, modifier = Modifier.fillMaxWidth())
        Button(onClick = { vm.setApiBase(url) }) { Text("Сохранить") }
        Button(onClick = { vm.cycleRepeat() }) { Text("Repeat") }
        Button(onClick = { vm.setSleepTimer(30) }) { Text("Sleep 30m") }
        Button(onClick = { vm.setSleepTimer(null) }) { Text("Sleep off") }
        Button(onClick = { vm.logout() }) { Text("Выйти") }
    }
}

@Composable
private fun StatsScreen(vm: MssViewModel) {
    LaunchedEffect(Unit) { vm.loadStats() }
    val stats by vm.stats.collectAsState()
    Column(Modifier.padding(16.dp)) {
        stats?.let {
            Text("Минут: ${it.totalMinutes}, прослушиваний: ${it.totalPlays}")
            it.topTracks.take(10).forEach { t -> Text("• ${t.artist} — ${t.title} (${t.plays})") }
        } ?: Text("Загрузка…")
    }
}

@Composable
private fun SubscriptionScreen(vm: MssViewModel) {
    LaunchedEffect(Unit) { vm.loadSubscription() }
    val sub by vm.subscription.collectAsState()
    Column(Modifier.padding(16.dp)) {
        sub?.let { Text("${it.planName} (${it.status})") } ?: Text("Загрузка…")
    }
}

@Composable
private fun PlaceholderScreen(text: String) {
    Text(text, modifier = Modifier.padding(16.dp))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TopBar(title: String) {
    TopAppBar(title = { Text(title) })
}

@Composable
private fun MiniPlayerBar(vm: MssViewModel) {
    val state by vm.playerState.collectAsState()
    val track = state.current ?: return
    Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Column(Modifier.weight(1f)) {
            Text(track.title)
            Text(track.artist, style = MaterialTheme.typography.bodySmall)
        }
        Button(onClick = { vm.togglePlay() }) { Text(if (state.playing) "⏸" else "▶") }
        Button(onClick = { vm.next() }) { Text("⏭") }
    }
}

@Composable
private fun MssBottomBar(nav: NavHostController, current: String) {
    val items = listOf(
        Triple(Routes.HOME, "MSS", Icons.Default.Home),
        Triple(Routes.SEARCH, "Поиск", Icons.Default.Search),
        Triple(Routes.LIBRARY, "Библиотека", Icons.Default.LibraryMusic),
        Triple(Routes.SETTINGS, "Настройки", Icons.Default.Settings),
    )
    Surface(tonalElevation = 3.dp) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            items.forEach { (route, label, icon) ->
                val selected = current == route
                Column(
                    Modifier
                        .weight(1f)
                        .clickable { nav.navigate(route) { launchSingleTop = true } }
                        .padding(vertical = 8.dp),
                    horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally,
                ) {
                    Icon(
                        icon,
                        contentDescription = label,
                        tint = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        label,
                        style = MaterialTheme.typography.labelSmall,
                        color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

private fun titleFor(route: String) = when (route) {
    Routes.HOME -> "MSS"
    Routes.SEARCH -> "Поиск"
    Routes.LIBRARY -> "Библиотека"
    Routes.SETTINGS -> "Настройки"
    else -> "MusicStreamService"
}

object Routes {
    const val HOME = "home"
    const val SEARCH = "search"
    const val LIBRARY = "library"
    const val LIBRARY_MSS = "library/mss"
    const val SPOTIFY = "spotify"
    const val YANDEX = "yandex"
    const val STATS = "stats"
    const val SUBSCRIPTION = "subscription"
    const val WAVE = "wave"
    const val SETTINGS = "settings"
}
