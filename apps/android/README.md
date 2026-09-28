# MusicStreamService — Android

Kotlin + Jetpack Compose клиент с MSS API, коннекторами Spotify/Yandex и фоновым воспроизведением (Media3).

## Требования

- **JDK 21** для Gradle (Java 26 не поддерживается AGP 8.7; задайте `JAVA_HOME` на Temurin 21)
- Android SDK 35
- Запущенный [`apps/api`](../../api) (по умолчанию `http://10.0.2.2:3001` в эмуляторе; с префиксом на VPS — `http://10.0.2.2:3001/MusicStreamService`)

## Настройка

1. Скопируйте `local.properties.example` → `local.properties` и укажите `sdk.dir`.
2. Опционально: `SPOTIFY_CLIENT_ID`, redirect `mss://spotify/callback` в Spotify Dashboard.
3. Сборка: `gradlew.bat :app:assembleDebug` (из `apps/android`).
4. Deep links: `mss://open/track/{id}`, `mss://open/playlist/{id}`, Spotify OAuth `mss://spotify/callback`.

## HTTPS и prod API

- В настройках приложения укажите базовый URL API, например `https://your-domain/MusicStreamService` (без trailing slash).
- WebSocket presence: `wss://your-domain/MusicStreamService/ws` (тот же host/path, что и REST).
- Для HTTPS на реальном домене используйте release-сборку или network security config; cleartext `http://10.0.2.2` — только для эмулятора.

## VPS

APK для лендинга собирается на сервере: `./scripts/update-server.sh` (см. корневой `scripts/` и `data/releases/README.md`).

## Модули

| Модуль | Назначение |
|--------|------------|
| `app` | UI, навигация, ViewModel |
| `core:model` | DTO (зеркало `@mss/shared`) |
| `core:network` | Ktor MSS API, presence WS |
| `core:datastore` | Сессия JWT, encrypted vault |
| `core:connectors` | Spotify PKCE, Yandex device code |
| `core:player` | ExoPlayer + foreground service |
| `core:downloads` | WorkManager загрузки |
