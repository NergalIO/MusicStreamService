# MusicStreamService

Десктопный стриминг (Electron) + backend: Opus/Ogg, подписки, офлайн `.mss`, Spotify/Yandex (токены только на клиенте), Web Audio + эквалайзер.

## Требования

- Node.js 20+
- pnpm 9+
- Docker (PostgreSQL, Redis; **MinIO не обязателен** — см. ниже)
- FFmpeg в PATH (для worker)

## Быстрый старт

```bash
cp .env.example .env
docker compose up -d
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

## Сборка установщика

```bash
pnpm --filter @mss/desktop dist
```

## Архитектура

- `apps/api` — Fastify, JWT, треки, стрим, плейлисты, подписки
- `apps/worker` — транскодинг Opus (BullMQ)
- `apps/desktop` — Electron + React
- `packages/*` — shared, mss-format, audio-engine, stream-connectors

## Хранение файлов (MinIO и «зависший» docker pull)

По умолчанию **`STORAGE_BACKEND=local`**: треки лежат в `./data/object-store`. Для разработки достаточно:

```bash
docker compose up -d    # только postgres + redis
```

Образы **MinIO** на Docker Hub часто удалены или тянутся очень долго (застревание на большом слое после мелких — типично для медленной сети). **MinIO не нужен**, если в `.env` указано `STORAGE_BACKEND=local`.

Если нужен именно S3/MinIO в Docker:

```bash
# в .env: STORAGE_BACKEND=s3
docker compose --profile s3 up -d
```

Если `docker pull minio/minio` не работает — оставайтесь на `local` или установите MinIO [с официального сайта](https://min.io/download) на Windows и укажите `MINIO_ENDPOINT=127.0.0.1`.
