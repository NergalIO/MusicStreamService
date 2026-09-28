# Релизные сборки (не в git)

Сюда попадают артеfactы после `./scripts/update-server.sh` на VPS:

- `MusicStreamService-setup.exe` — Windows (NSIS)
- `mss-android.apk` — Android

Имена можно переопределить через `RELEASE_WINDOWS_FILE` и `RELEASE_ANDROID_FILE` в `.env`.

Landing отдаёт файлы по `{PUBLIC_BASE_PATH}/downloads/…`.

Сборка APK на слабом VPS: тонкий Docker-образ (как RF4 Spots, без NDK/эмулятора), кэш Gradle в volume `mss-gradle-cache`. При нехватке RAM: `GRADLE_JVM_ARGS=-Xmx768m` в `.env` или `BUILD_APK=0` / `./scripts/update-server.sh --no-apk`.
