package com.mss.android.ui

import android.annotation.SuppressLint
import android.net.Uri
import android.webkit.WebView
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.mss.android.ui.auth.LoginScreen
import com.mss.android.ui.catalog.CatalogList
import com.mss.android.ui.home.HomeScreen
import com.mss.android.ui.library.ArtistHub
import com.mss.android.ui.library.DownloadsScreen
import com.mss.android.ui.library.LibraryHub
import com.mss.android.ui.library.PlaylistHub
import com.mss.android.ui.library.UploadsScreen
import com.mss.android.ui.lobby.LobbyScreen
import com.mss.android.ui.more.MoreHub
import com.mss.android.ui.navigation.Routes
import com.mss.android.ui.navigation.parseMssLink
import com.mss.android.ui.player.LobbyBar
import com.mss.android.ui.player.MiniPlayer
import com.mss.android.ui.player.NowPlayingScreen
import com.mss.android.ui.search.SearchScreen
import com.mss.android.ui.settings.SettingsScreen
import com.mss.android.ui.stats.StatsScreen
import com.mss.android.ui.stats.SubScreen
import com.mss.android.ui.wave.WaveScreen
import com.mss.core.model.SourceId
import com.mss.core.model.sourceFrom

@Composable
fun MssApp(
    vm: MssViewModel = hiltViewModel(),
    incomingUri: Uri? = null,
) {
    val session by vm.session.collectAsState()
    val nav = rememberNavController()
    val spotifyVisible by vm.spotifyWeb.loggedIn.collectAsState()
    val settings by vm.playbackSettings.collectAsState()
    val primary = when (settings.accent) {
        "teal" -> Color(0xFF2DD4BF)
        "amber" -> Color(0xFFF59E0B)
        else -> Color(0xFFA78BFA)
    }

    LaunchedEffect(incomingUri) {
        val uri = incomingUri ?: return@LaunchedEffect
        val url = uri.toString()
        if (uri.host == "spotify" && uri.path?.contains("callback") == true) {
            val code = uri.getQueryParameter("code") ?: return@LaunchedEffect
            val state = uri.getQueryParameter("state") ?: return@LaunchedEffect
            vm.completeSpotify(code, state)
            return@LaunchedEffect
        }
        parseMssLink(url)?.let { action ->
            vm.applyDeepLink(url)
            nav.navigate(action.route)
        }
    }

    MaterialTheme(colorScheme = darkColorScheme(primary = primary)) {
        Box(Modifier.fillMaxSize()) {
            if (session == null) {
                LoginScreen()
            } else {
                MainShell(vm, nav)
            }
            SpotifyWebLayer(vm, visible = !spotifyVisible && vm.spotifyWeb.visibleForLogin)
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun SpotifyWebLayer(vm: MssViewModel, visible: Boolean) {
    Box(Modifier.fillMaxWidth().then(if (visible) Modifier.fillMaxSize() else Modifier.height(1.dp))) {
        AndroidView(
            factory = { ctx ->
                WebView(ctx).also { vm.spotifyWeb.attach(it) }
            },
            modifier = Modifier.fillMaxSize(),
        )
        if (visible) {
            Button(
                onClick = { vm.spotifyWeb.hideLogin() },
                modifier = Modifier.align(Alignment.TopEnd).padding(16.dp),
            ) { Text("Скрыть Spotify") }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MainShell(vm: MssViewModel, nav: NavHostController) {
    val back by nav.currentBackStackEntryAsState()
    val route = back?.destination?.route ?: Routes.HOME
    val error by vm.error.collectAsState()
    val prompt by vm.yandexPrompt.collectAsState()
    val ctx = LocalContext.current
    val onboarded by vm.onboarded.collectAsState()
    val lobby by vm.lobbyState.collectAsState()

    prompt?.let { p ->
        AlertDialog(
            onDismissRequest = {},
            title = { Text("Яндекс Музыка") },
            text = { Text("Код ${p.userCode}\nОткройте ${p.verificationUrl}") },
            confirmButton = {
                Button(onClick = {
                    CustomTabsIntent.Builder().build().launchUrl(ctx, Uri.parse(p.verificationUrl))
                }) { Text("Открыть") }
            },
        )
    }
    if (!onboarded) {
        AlertDialog(
            onDismissRequest = { vm.setOnboarded() },
            title = { Text("MusicStreamService") },
            text = { Text("Единая медиатека: MSS, Яндекс, Spotify и VK. Подключите источники в разделе «Ещё».") },
            confirmButton = { Button(onClick = { vm.setOnboarded() }) { Text("Понятно") } },
        )
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text(titleFor(route)) }) },
        bottomBar = {
            Column {
                LobbyBar(lobby) { nav.navigate(Routes.LOBBY) }
                MiniPlayer(vm) { nav.navigate(Routes.NOW_PLAYING) }
                NavigationBar {
                    listOf(
                        Triple(Routes.HOME, "Главная", Icons.Default.Home),
                        Triple(Routes.SEARCH, "Поиск", Icons.Default.Search),
                        Triple(Routes.LIBRARY, "Медиатека", Icons.Default.LibraryMusic),
                        Triple(Routes.MORE, "Ещё", Icons.Default.MoreHoriz),
                    ).forEach { (r, label, icon) ->
                        NavigationBarItem(
                            selected = route == r || (r == Routes.LIBRARY && route.startsWith("library")),
                            onClick = { nav.navigate(r) { launchSingleTop = true } },
                            icon = { Icon(icon, label) },
                            label = { Text(label) },
                        )
                    }
                }
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(8.dp)) }
            NavHost(nav, Routes.HOME, Modifier.weight(1f)) {
                composable(Routes.HOME) { HomeScreen(vm, nav) }
                composable(Routes.SEARCH) { SearchScreen(vm, nav) }
                composable(Routes.LIBRARY) { LibraryHub(nav) }
                composable(Routes.MORE) { MoreHub(vm, nav) }
                composable(Routes.LIKES) { LaunchedEffect(Unit) { vm.loadLikes() }; CatalogList(vm, nav) }
                composable(Routes.PLAYLISTS) { LaunchedEffect(Unit) { vm.loadPlaylists() }; PlaylistHub(vm, nav) }
                composable(Routes.ARTISTS) { LaunchedEffect(Unit) { vm.loadArtists() }; ArtistHub(vm, nav) }
                composable(Routes.UPLOADS) { UploadsScreen(vm, nav) }
                composable(Routes.DOWNLOADS) { DownloadsScreen(vm) }
                composable(Routes.OFFLINE) { LaunchedEffect(Unit) { vm.loadOffline() }; CatalogList(vm, nav) }
                composable(Routes.HISTORY) { LaunchedEffect(Unit) { vm.loadHistory() }; CatalogList(vm, nav) }
                composable(Routes.STATS) { StatsScreen(vm) }
                composable(Routes.WRAPPED) { LaunchedEffect(Unit) { vm.loadStats("year") }; StatsScreen(vm) }
                composable(Routes.SUBSCRIPTION) { SubScreen(vm) }
                composable(Routes.SETTINGS) { SettingsScreen() }
                composable(Routes.WAVE) { WaveScreen(vm) }
                composable(Routes.LOBBY) { LobbyScreen(nav) }
                composable(Routes.NOW_PLAYING) { NowPlayingScreen(vm) }
                composable(Routes.MSS_PLAYLIST, listOf(navArgument("id") { type = NavType.StringType })) { e ->
                    val id = e.arguments?.getString("id") ?: return@composable
                    LaunchedEffect(id) { vm.openMssPlaylist(id) }
                    CatalogList(vm, nav)
                }
                composable(Routes.EXT_PLAYLIST, listOf(
                    navArgument("source") { type = NavType.StringType },
                    navArgument("id") { type = NavType.StringType },
                )) { e ->
                    val s = e.arguments?.getString("source") ?: return@composable
                    val id = e.arguments?.getString("id") ?: return@composable
                    LaunchedEffect(s, id) { vm.openExternalPlaylist(s, id) }
                    CatalogList(vm, nav)
                }
                composable(Routes.ALBUM, listOf(
                    navArgument("source") { type = NavType.StringType },
                    navArgument("id") { type = NavType.StringType },
                )) { e ->
                    val s = e.arguments?.getString("source") ?: return@composable
                    val id = e.arguments?.getString("id") ?: return@composable
                    LaunchedEffect(s, id) { vm.openAlbum(s, id) }
                    CatalogList(vm, nav)
                }
                composable(Routes.ARTIST, listOf(navArgument("name") { type = NavType.StringType })) { e ->
                    val name = e.arguments?.getString("name") ?: return@composable
                    LaunchedEffect(name) { vm.openArtist(name) }
                    CatalogList(vm, nav)
                }
                composable(Routes.SIMILAR, listOf(
                    navArgument("source") { type = NavType.StringType },
                    navArgument("id") { type = NavType.StringType },
                )) { e ->
                    val id = e.arguments?.getString("id") ?: return@composable
                    LaunchedEffect(id) {
                        vm.loadSimilar(com.mss.core.model.UnifiedTrack(SourceId.YANDEX, id, "", ""))
                    }
                    CatalogList(vm, nav)
                }
                composable(Routes.SOURCE_HOME, listOf(navArgument("source") { type = NavType.StringType })) { e ->
                    val s = e.arguments?.getString("source") ?: return@composable
                    LaunchedEffect(s) { vm.setHomeSource(sourceFrom(s)) }
                    HomeScreen(vm, nav)
                }
            }
        }
    }
}

private fun titleFor(route: String) = when {
    route == Routes.HOME -> "Главная"
    route == Routes.SEARCH -> "Поиск"
    route.startsWith("library") -> "Медиатека"
    route == Routes.SETTINGS -> "Настройки"
    route == Routes.NOW_PLAYING -> "Сейчас играет"
    route == Routes.LOBBY -> "Лобби"
    route == Routes.WAVE -> "Волна"
    else -> "MusicStreamService"
}
