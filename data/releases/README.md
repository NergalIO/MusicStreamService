# Релизные сборки (legacy)

Клиенты больше **не собираются на VPS** по умолчанию (`BUILD_CLIENT=0`, `BUILD_APK=0`).

- **Windows:** [`scripts/client-install/`](../scripts/client-install/) или `.exe` из [GitHub Releases](https://github.com/mss/MusicStreamService/releases).
- **Android:** `mss-android.apk` из GitHub Releases (CI).

Эта папка оставлена для ручной отладки (`update-server.sh --client --apk`) и старых ссылок.
