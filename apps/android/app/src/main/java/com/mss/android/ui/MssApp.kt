package com.mss.android.ui

import android.annotation.SuppressLint
import android.net.Uri
import android.view.View
import android.webkit.WebView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.zIndex
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.union
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import android.app.Activity
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavGraph.Companion.findStartDestination
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
import com.mss.android.ui.more.VkIdOverlay
import com.mss.android.ui.more.YandexLoginDialog
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
import com.mss.android.ui.theme.COVER_ACCENT
import com.mss.android.ui.theme.MssTheme
import com.mss.android.ui.theme.rememberCoverHsl
import com.mss.core.model.SourceId
import com.mss.core.model.sourceFrom
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first

@Composable
fun MssApp(
    vm: MssViewModel = hiltViewModel(),
    incomingUri: Uri? = null,
) {
    val session by vm.session.collectAsState()
    val nav = rememberNavController()
    val spotifyLoggedIn by vm.spotifyWeb.loggedIn.collectAsState()
    val spotifyLogin by vm.spotifyWeb.visibleForLogin.collectAsState()
    val vkLogin by vm.vkLogin.collectAsState()
    val yandexPrompt by vm.yandexPrompt.collectAsState()
    val settings by vm.playbackSettings.collectAsState()
    val player by vm.playerState.collectAsState()
    val cover = if (settings.accent == COVER_ACCENT) rememberCoverHsl(player.current?.coverUrl) else null
    LaunchedEffect(spotifyLoggedIn) {
        if (spotifyLoggedIn) vm.spotifyWeb.hideLogin()
    }

    LaunchedEffect(incomingUri, session) {
        if (session == null) return@LaunchedEffect
        val uri = incomingUri ?: return@LaunchedEffect
        val url = uri.toString()
        val action = parseMssLink(url) ?: return@LaunchedEffect
        vm.applyDeepLink(url)
        snapshotFlow { nav.currentBackStackEntry }.filterNotNull().first()
        nav.navigate(action.route)
    }

    val spotifyVisible = spotifyLogin && !spotifyLoggedIn
    MssTheme(accent = settings.accent, cover = cover) {
        Box(Modifier.fillMaxSize()) {
            SpotifyWebLayer(
                vm,
                visible = spotifyVisible,
                modifier = Modifier
                    .zIndex(if (spotifyVisible) 2f else 0f)
                    .offset(x = if (spotifyVisible) 0.dp else 4000.dp),
            )
            Box(Modifier.fillMaxSize().zIndex(if (spotifyVisible) 0f else 1f)) {
                if (session == null) {
                    LoginScreen()
                } else {
                    MainShell(vm, nav)
                }
            }
            if (vkLogin.open && vkLogin.step == VkLoginStep.VKID) {
                VkIdOverlay(
                    error = vkLogin.error,
                    onClose = { vm.closeVkLogin() },
                    onDone = { vm.completeVkId(it) },
                    modifier = Modifier.zIndex(3f),
                )
            }
            yandexPrompt?.let { prompt ->
                YandexLoginDialog(prompt, onCancel = { vm.cancelYandexLogin() }, modifier = Modifier.zIndex(3f))
            }
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun SpotifyWebLayer(vm: MssViewModel, visible: Boolean, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize()) {
        AndroidView(
            factory = { ctx ->
                android.widget.FrameLayout(ctx).also { frame ->
                    frame.setBackgroundColor(android.graphics.Color.WHITE)
                    val view = WebView(ctx)
                    frame.addView(
                        view,
                        android.widget.FrameLayout.LayoutParams(
                            android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                            android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                        ),
                    )
                    view.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                    vm.spotifyWeb.attach(view)
                    view.webChromeClient = LoginPopupChrome(frame, view.settings.userAgentString)
                }
            },
            update = { frame ->
                val view = frame.getChildAt(0) as? WebView ?: return@AndroidView
                view.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                view.visibility = View.VISIBLE
                view.isFocusable = visible
                view.isFocusableInTouchMode = visible
                if (visible) {
                    view.requestLayout()
                    view.invalidate()
                }
            },
            modifier = Modifier.fillMaxSize(),
        )
        if (visible) {
            Button(
                onClick = { vm.spotifyWeb.hideLogin() },
                modifier = Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(16.dp),
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
    val notice by vm.notice.collectAsState()
    val onboarded by vm.onboarded.collectAsState()
    val lobby by vm.lobbyState.collectAsState()

    if (!onboarded) {
        AlertDialog(
            onDismissRequest = { vm.setOnboarded() },
            title = { Text("MusicStreamService") },
            text = { Text("Единая медиатека: MSS, Яндекс, Spotify и VK. Подключите источники в разделе «Ещё».") },
            confirmButton = { Button(onClick = { vm.setOnboarded() }) { Text("Понятно") } },
        )
    }

    val hideTop = route in setOf(Routes.HOME, Routes.SEARCH, Routes.LIBRARY, Routes.MORE, Routes.NOW_PLAYING) ||
        route.startsWith("source/")
    ApplySystemBars(darkBackground = isSystemInDarkTheme() || route == Routes.NOW_PLAYING)
    val scheme = MaterialTheme.colorScheme

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets.systemBars.union(WindowInsets.ime),
        topBar = {
            if (!hideTop) {
                TopAppBar(
                    title = {
                        Text(titleFor(route), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    },
                    navigationIcon = {
                        IconButton({ if (!nav.popBackStack()) nav.navigate(Routes.HOME) }) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад")
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = scheme.background,
                        titleContentColor = scheme.onBackground,
                        navigationIconContentColor = scheme.onBackground,
                    ),
                )
            }
        },
        bottomBar = {
            if (route != Routes.NOW_PLAYING) {
                Column {
                    LobbyBar(lobby) { nav.navigate(Routes.LOBBY) }
                    MiniPlayer(vm) { nav.navigate(Routes.NOW_PLAYING) }
                    NavigationBar(containerColor = scheme.surfaceContainer, tonalElevation = 0.dp) {
                        listOf(
                            Triple(Routes.HOME, "Главная", Icons.Default.Home),
                            Triple(Routes.SEARCH, "Поиск", Icons.Default.Search),
                            Triple(Routes.LIBRARY, "Медиатека", Icons.Default.LibraryMusic),
                            Triple(Routes.MORE, "Ещё", Icons.Default.MoreHoriz),
                        ).forEach { (r, label, icon) ->
                            val selected = route == r || (r == Routes.LIBRARY && route.startsWith("library"))
                            NavigationBarItem(
                                selected = selected,
                                onClick = {
                                    nav.navigate(r) {
                                        popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                },
                                icon = { Icon(icon, contentDescription = null) },
                                label = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                alwaysShowLabel = true,
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = scheme.primary,
                                    selectedTextColor = scheme.onSurface,
                                    unselectedIconColor = scheme.onSurfaceVariant,
                                    unselectedTextColor = scheme.onSurfaceVariant,
                                    indicatorColor = scheme.onSurface.copy(alpha = 0.10f),
                                ),
                            )
                        }
                    }
                }
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            error?.let { msg ->
                Row(
                    Modifier
                        .padding(horizontal = 16.dp, vertical = 8.dp)
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(MaterialTheme.colorScheme.error.copy(alpha = 0.12f))
                        .padding(start = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        msg,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                    IconButton({ vm.clearError() }) { Icon(Icons.Default.Close, "Закрыть") }
                }
            }
            if (error == null) {
                notice?.let { msg ->
                    Row(
                        Modifier
                            .padding(horizontal = 16.dp, vertical = 8.dp)
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f))
                            .padding(start = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            msg,
                            color = MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier.weight(1f),
                            style = MaterialTheme.typography.bodySmall,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        IconButton({ vm.clearNotice() }) { Icon(Icons.Default.Close, "Закрыть") }
                    }
                }
            }
            NavHost(nav, Routes.HOME, Modifier.weight(1f).fillMaxWidth()) {
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
                composable(Routes.WRAPPED) { StatsScreen(vm, initialPeriod = "year") }
                composable(Routes.SUBSCRIPTION) { SubScreen(vm) }
                composable(Routes.SETTINGS) { SettingsScreen() }
                composable(Routes.WAVE) { WaveScreen(vm) }
                composable(Routes.LOBBY) { LobbyScreen(nav) }
                composable(Routes.NOW_PLAYING) {
                    NowPlayingScreen(vm, onBack = { nav.popBackStack() }, onArtist = { nav.navigate(Routes.artist(it)) })
                }
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

@Composable
private fun ApplySystemBars(darkBackground: Boolean) {
    val view = LocalView.current
    if (view.isInEditMode) return
    androidx.compose.runtime.SideEffect {
        val window = (view.context as? Activity)?.window ?: return@SideEffect
        val controller = WindowCompat.getInsetsController(window, view)
        controller.isAppearanceLightStatusBars = !darkBackground
        controller.isAppearanceLightNavigationBars = !darkBackground
    }
}

private fun titleFor(route: String) = when {
    route == Routes.HOME -> "Главная"
    route == Routes.SEARCH -> "Поиск"
    route.startsWith("library") -> "Медиатека"
    route == Routes.SETTINGS -> "Настройки"
    route == Routes.STATS -> "Статистика"
    route == Routes.WRAPPED -> "Итоги года"
    route == Routes.SUBSCRIPTION -> "Подписка"
    route == Routes.NOW_PLAYING -> "Сейчас играет"
    route == Routes.LOBBY -> "Лобби"
    route == Routes.WAVE -> "Волна"
    else -> "MusicStreamService"
}
