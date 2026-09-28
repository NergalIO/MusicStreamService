# Установка клиента (GitHub Release)

## Windows (основной путь)

1. Скачайте [`install-windows.cmd`](install-windows.cmd) с лендинга или из репозитория.
2. Запустите двойным щелчком (нужны **Node.js 20+** и интернет).
3. Укажите URL вашего MSS API.
4. Скрипт скачает **последний GitHub Release** (zipball), выполнит `pnpm build` и соберёт NSIS локально.

Переменные:

- `MSS_GITHUB_REPO=owner/repo` — если форк.
- `API_PUBLIC_URL` — можно задать до запуска, чтобы не вводить вручную.

Обновление:

```powershell
.\install-windows.ps1 -Update
```

## Windows (быстро, без сборки)

Скачайте `MusicStreamService-setup.exe` с [GitHub Releases](https://github.com/mss/MusicStreamService/releases) — файл собирается в CI.

## Android

Скачайте `mss-android.apk` с GitHub Releases (сборка в CI). Установите вручную (sideload).

## Синхронизация с лендингом

Копии скриптов для раздачи API: [`apps/api/public/downloads/`](../apps/api/public/downloads/) — обновляйте вместе с этой папкой.

## Разработчикам

Локальный Gradle для Android: `pnpm run build:android` из корня monorepo.
