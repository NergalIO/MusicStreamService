# Установка MusicStreamService на VPS

Инструкция для production: API, worker, PostgreSQL, Redis, лендинг со ссылками на клиентов (GitHub Releases). **Клиенты (.exe / .apk) на VPS не собираются** — только backend.

---

## Вариант A — Docker (рекомендуется)

Postgres, Redis, migrate, API и worker в контейнерах. Node/pnpm/ffmpeg на хосте **не нужны**.

### Автоустановка (одна команда)

Используйте **raw**-URL (не страницу `github.com/.../blob/...`):

```bash
curl -fsSL https://raw.githubusercontent.com/NergalIO/MusicStreamService/main/scripts/install-docker-vps.sh | sudo bash
```

Скрипт [`scripts/install-docker-vps.sh`](../scripts/install-docker-vps.sh) сам:

1. Ставит `git`, `curl`, `openssl`, `python3` (apt).
2. Клонирует репозиторий в `/opt/MusicStreamService` (или обновляет, если уже есть).
3. Устанавливает **Docker Engine + Compose** через [get.docker.com](https://get.docker.com).
4. Создаёт `.env`, генерирует `JWT_SECRET`, `POSTGRES_PASSWORD`, `OFFLINE_HKDF_SECRET`, admin email/password.
5. Поднимает `docker compose -f docker-compose.yml -f docker-compose.app.yml up -d --build`, ждёт health, запускает **seed** (планы + admin).

Учётные данные: **`/opt/MusicStreamService/.mss-install-credentials`** (chmod 600).

Переменные: `MSS_INSTALL_DIR`, `MSS_REPO`, `MSS_BRANCH`, `MSS_GITHUB_REPO`.

### Автоустановка из уже клонированного репозитория

```bash
cd /opt/MusicStreamService
chmod +x scripts/install-docker-vps.sh
./scripts/install-docker-vps.sh
```

После установки при домене/TLS обновите `API_PUBLIC_URL` в `.env` и перезапустите api/worker.

```bash
curl -s http://127.0.0.1:3001/MusicStreamService/health
cat /opt/MusicStreamService/.mss-install-credentials
```

Обновление:

```bash
cd /opt/MusicStreamService && git pull
docker compose -f docker-compose.yml -f docker-compose.app.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.app.yml run --rm migrate
```

| Файл | Роль |
|------|------|
| [`Dockerfile`](../Dockerfile) | Образ API/worker (ffmpeg внутри) |
| [`docker-compose.app.yml`](../docker-compose.app.yml) | migrate, api, worker, volumes |

Postgres/Redis при полном стеке слушают **127.0.0.1** (см. override в `docker-compose.app.yml`).

---

## Вариант B — systemd + Node на хосте

### B.1. Что понадобится

| Компонент | Назначение |
|-----------|------------|
| VPS (Linux, 2+ GB RAM) | API + worker |
| Домен + TLS | Nginx или Caddy |
| Node.js 20+, pnpm 9+ | Сборка и запуск |
| Docker | Postgres + Redis |
| ffmpeg | Worker |
| Git | `update-server.sh` |

```bash
sudo apt update
sudo apt install -y git curl ffmpeg docker.io docker-compose-plugin
sudo usermod -aG docker "$USER"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
corepack enable && corepack prepare pnpm@latest --activate
```

### B.2. Клонирование и каталог

```bash
sudo mkdir -p /opt/MusicStreamService
sudo chown "$USER:$USER" /opt/MusicStreamService
git clone https://github.com/YOUR_ORG/MusicStreamService.git /opt/MusicStreamService
cd /opt/MusicStreamService
```

### B.3. Файл `.env`

```bash
cp .env.example .env
nano .env
```

### Обязательно для VPS

| Переменная | Пример | Описание |
|------------|--------|----------|
| `NODE_ENV` | `production` | Режим API |
| `JWT_SECRET` | длинная случайная строка | Подпись access/refresh токенов |
| `OFFLINE_HKDF_SECRET` | отдельный секрет | Должен **совпадать** с клиентами для офлайн `.mss` |
| `DATABASE_URL` | `postgresql://mss:STRONG_PASS@127.0.0.1:5432/mss` | Пароль Postgres из `docker-compose.yml` |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Очередь worker |
| `PUBLIC_BASE_PATH` | `/MusicStreamService` | URL-префикс API и лендинга |
| `API_PUBLIC_URL` | `https://example.com/MusicStreamService` | Публичный URL API |
| `STORAGE_BACKEND` | `local` | Файлы в `LOCAL_STORAGE_PATH` |
| `GITHUB_REPO` | `your-org/MusicStreamService` | Лендинг → GitHub Releases |

Для **Docker-стека** используйте [`.env.docker.example`](../.env.docker.example) (`DATABASE_URL` с хостом `postgres`).

### B.4. Docker: только PostgreSQL и Redis

```bash
docker compose up -d
docker compose exec postgres psql -U mss -d mss -c 'SELECT 1'
```

### B.5. Сборка backend и миграции

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm db:migrate
pnpm db:seed
```

### B.6. Systemd

```bash
sudo cp deploy/systemd/mss-api.service /etc/systemd/system/
sudo cp deploy/systemd/mss-worker.service /etc/systemd/system/
sudo cp deploy/systemd/mss-update.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mss-api mss-worker
chmod +x scripts/update-server.sh && ./scripts/update-server.sh --force
sudo systemctl enable --now mss-update
```

---

## 7. Reverse proxy (Nginx)

```nginx
location /MusicStreamService/ {
    proxy_pass http://127.0.0.1:3001/MusicStreamService/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    client_max_body_size 500M;
}
```

---

## 8. GitHub Releases (клиенты)

1. Secret `API_PUBLIC_URL` в GitHub Actions (Windows CI).
2. `git tag v0.1.0 && git push origin v0.1.0`
3. `GITHUB_REPO` в `.env` на VPS.

---

## 9. Обновление и откат

**Docker:** `git pull` → `docker compose -f docker-compose.yml -f docker-compose.app.yml up -d --build` → `run --rm migrate`.

**systemd:** `./scripts/update-server.sh --force` или `systemctl restart mss-api mss-worker`.

---

## 10. Частые проблемы

| Симптом | Что проверить |
|---------|----------------|
| 404 на лендинге | `PUBLIC_BASE_PATH` = путь в Nginx |
| Пустые кнопки загрузки | `GITHUB_REPO`, Release с assets, `GITHUB_TOKEN` |
| API не стартует в Docker | `docker compose logs api`, `DATABASE_URL` → `postgres` |
| Worker без ffmpeg | используйте образ из [`Dockerfile`](../Dockerfile) |

---

## 11. Структура

```
/opt/MusicStreamService/
├── .env
├── Dockerfile
├── docker-compose.yml
├── docker-compose.app.yml
└── scripts/install-docker-vps.sh
```

Локальная разработка — [README.md](../README.md).
