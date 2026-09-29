# MusicStreamService — Android

Kotlin + Jetpack Compose клиент с MSS API, коннекторами Yandex / Spotify / VK, Media3, офлайн `.mss`, relay и лобби.

## Требования

- **JDK 21** для Gradle (задайте `JAVA_HOME` на Temurin 21)
- Android SDK 35
- Запущенный [`apps/api`](../../api) (по умолчанию `http://10.0.2.2:3001` в эмуляторе)

## Настройка

1. Скопируйте `local.properties.example` → `local.properties` и укажите `sdk.dir`.
2. Опционально: `API_PUBLIC_URL` (базовый URL API на экране входа), `SPOTIFY_CLIENT_ID`, `YANDEX_CLIENT_ID` / `YANDEX_CLIENT_SECRET`, `OFFLINE_HKDF_SECRET` (должен совпадать с API). В GitHub Actions release APK собирается с `secrets.API_PUBLIC_URL` (тот же секрет, что для Windows).
3. Сборка: `gradlew.bat :app:assembleDebug` (из `apps/android`).
4. Deep links: `mss://track|album|playlist|artist|wave|search|library|stats|settings|lobby|similar`, Spotify OAuth `mss://spotify/callback`.

## HTTPS и prod API

В настройках укажите базовый URL API. WebSocket presence: тот же host, схема `wss://…/ws`.

## Модули

| Модуль | Назначение |
|--------|------------|
| `app` | UI, навигация, ViewModel |
| `core:model` | DTO (зеркало `@mss/shared`) |
| `core:network` | Ktor MSS API, presence WS, scrobble |
| `core:datastore` | Сессия JWT, настройки, vault |
| `core:connectors` | Spotify PKCE + WebView, Yandex, VK |
| `core:player` | Dual ExoPlayer, EQ, crossfade, MediaSession |
| `core:downloads` | WorkManager загрузки |
| `core:offline` | Формат `.mss` |
| `core:localtracks` | Holdings / SAF |
| `core:lobby` | REST + WS лобби |

Release APK подписывается, если заданы `MSS_KEYSTORE`, `MSS_KEYSTORE_PASSWORD`, `MSS_KEY_ALIAS`, `MSS_KEY_PASSWORD`.

## GitHub Actions (подпись)

Секреты репозитория (Settings → Secrets and variables → Actions):

| Secret | Что положить |
|--------|----------------|
| `MSS_KEYSTORE_BASE64` | `base64 -w 0 mss-release.jks` (PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("mss-release.jks"))`) |
| `MSS_KEYSTORE_PASSWORD` | Пароль keystore |
| `MSS_KEY_ALIAS` | Alias ключа, например `mss` |
| `MSS_KEY_PASSWORD` | Пароль ключа (если пусто — берётся пароль keystore) |
| `OFFLINE_HKDF_SECRET` | Тот же секрет, что у API |
| `SPOTIFY_CLIENT_ID` / `YANDEX_CLIENT_ID` / `YANDEX_CLIENT_SECRET` | OAuth клиентов |

На push в `apps/android` собирается подписанный `mss-android.apk` (артефакт). Тег `v*` кладёт его в GitHub Release рядом с Windows EXE.
