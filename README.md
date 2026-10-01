# MusicStreamService

Десктопный стриминг (Electron) + backend: Opus/Ogg, подписки, офлайн `.mss`, Spotify/Yandex (токены только на клиенте), Web Audio + эквалайзер.

## Требования

- Node.js 20+
- pnpm 9+
- Docker (PostgreSQL, Redis; объектное хранилище — диск или S3, MinIO не обязателен)
- FFmpeg в PATH (для worker)

## Установка на VPS (production)

- **Docker (рекомендуется):** одна команда на VPS (клон + Docker + секреты + seed):  
  `curl -fsSL https://raw.githubusercontent.com/NergalIO/MusicStreamService/main/scripts/install-docker-vps.sh | sudo bash`  
  Подробности: **[deploy/README.md](deploy/README.md)** (вариант A).
- **systemd + Node на хосте:** тот же [deploy/README.md](deploy/README.md) (вариант B).

## Быстрый старт (локально)

```bash
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.host-ports.yml up -d
pnpm install
pnpm --filter @mss/shared build
pnpm --filter @mss/mss-format build
pnpm --filter @mss/audio-engine build
pnpm --filter @mss/stream-connectors build
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Если **`EADDRINUSE :3001`** — остановите старый `pnpm dev` или выполните в PowerShell:  
`Get-NetTCPConnection -LocalPort 3001 | % { Stop-Process -Id $_.OwningProcess -Force }`

- API: http://localhost:3001
- Desktop: Electron (electron-vite)

## Переменные

См. [.env.example](.env.example). Для offline на клиенте и API должен совпадать `OFFLINE_HKDF_SECRET`.

### Яндекс Музыка (OAuth)

1. Создайте приложение на [oauth.yandex.ru](https://oauth.yandex.ru/) (тип «Веб-сервисы» или «Другое»).
2. **Redirect URI:** `http://127.0.0.1:8766/callback`
3. В `.env`: `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET`
4. В приложении: **Настройки → Войти через Яндекс** (откроется Яндекс ID, токен сохранится локально).

Spotify: `SPOTIFY_CLIENT_ID`, redirect `http://127.0.0.1:8765/callback`.

## Установка клиентов (пользователям)

| Платформа | Основной путь | Быстрый запасной |
|-----------|---------------|------------------|
| **Windows** | [`scripts/client-install/install-windows.cmd`](scripts/client-install/install-windows.cmd) — исходники с GitHub Release, сборка на ПК | `MusicStreamService-setup.exe` с GitHub Releases (CI) |
| **Android** | `mss-android.apk` с GitHub Releases (CI) | — |

На VPS задайте `GITHUB_REPO` в `.env` — лендинг покажет ссылки. Клиенты **не** собираются на сервере (`BUILD_CLIENT=0`, `BUILD_APK=0`). Релиз: tag `v*` → [`.github/workflows/release.yml`](.github/workflows/release.yml).

## Сборка установщика (разработка)

```bash
pnpm --filter @mss/desktop dist
```

## Архитектура

- `apps/api` — Fastify, JWT, каталог, стрим, плейлисты, подписки, presigned URL в S3
- `apps/worker` — транскодинг Opus (BullMQ), выгрузка `master.ogg` в хранилище
- `apps/desktop` / `apps/android` — клиенты: оригинал в облако (PUT), стрим с Beget или через `/stream`
- `packages/*` — shared, mss-format, audio-engine, stream-connectors

## Хранение файлов

Два режима, переключатель — `STORAGE_BACKEND` в корневом `.env` (его читают и API, и worker).

### `local` (dev)

Файлы на диске в `LOCAL_STORAGE_PATH` (по умолчанию `./data/object-store`). MinIO не нужен:

```bash
docker compose -f docker-compose.yml -f docker-compose.host-ports.yml up -d    # postgres + redis
```

### `s3` — Beget Object Storage (прод)

Клиент грузит **оригинал** напрямую в бакет (presigned PUT). Worker кладёт туда же `master.ogg`. Стрим: сначала сохранённый presigned GET (пока не истёк, до ~6 суток), иначе `GET /stream/:id` через API. Тексты песен (`.lrc` / `.txt` рядом с файлом или теги) пишутся в тот же бакет `tracks` объектом `tracks/{id}/lyrics.lrc` или `.txt`.

Ключи Access/Secret **только** в `.env` API и worker, не в клиентах.

В `.env`:

```env
STORAGE_BACKEND=s3
MINIO_ENDPOINT=s3.ru1.storage.beget.cloud
MINIO_PORT=443
MINIO_USE_SSL=true
MINIO_REGION=ru1
MINIO_ACCESS_KEY_TRACKS=
MINIO_SECRET_KEY_TRACKS=
MINIO_ACCESS_KEY_COVERS=
MINIO_SECRET_KEY_COVERS=
MINIO_BUCKET_TRACKS=tracks
MINIO_BUCKET_COVERS=covers
```

Beget выдаёт Access/Secret **на бакет** — подставьте обе пары. Если заданы только `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`, ими подписываются оба бакета (так у MinIO). Тексты песен лежат в бакете треков, отдельный ключ не нужен.

Имена `MINIO_*` исторические: тот же клиент ходит и в MinIO, и в Beget.

**В панели Beget** (API бакет не создаёт):

1. Создайте приватные бакеты `tracks` и `covers` (или как в `MINIO_BUCKET_*`) и впишите ключи каждого в `.env`.
2. CORS на бакете треков — только если ПК стримит **напрямую** с Beget: методы `GET`, `HEAD`; заголовок `Range`; origin Electron в dev (`http://localhost:…`). Android (ExoPlayer) CORS не использует. PUT оригинала идёт из Electron main / Android, без CORS. Тексты песен API пишет сам, отдельный CORS не нужен.
3. Перезапустите API и worker после правки `.env`. Миграции (`pnpm db:migrate`) добавляют `storage_key_original` и `storage_key_lyrics`.

### MinIO в Docker

Образы MinIO с Docker Hub часто не тянутся. Если всё же нужен локальный S3:

```bash
# в .env: STORAGE_BACKEND=s3
docker compose --profile s3 up -d
```

Либо поставьте MinIO [с сайта](https://min.io/download) и укажите `MINIO_ENDPOINT=127.0.0.1`.
