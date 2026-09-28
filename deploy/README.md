# Деплой на VPS

1. Клон репозитория, например `/opt/MusicStreamService`.
2. Скопируйте `.env.example` → `.env`, задайте `PUBLIC_BASE_PATH=/MusicStreamService`, `API_PUBLIC_URL=https://ваш-домен/MusicStreamService`, секреты БД.
3. `docker compose up -d` (Postgres, Redis).
4. Установите unit-файлы из `deploy/systemd/` (поправьте `WorkingDirectory` при необходимости):
   - `mss-api.service`, `mss-worker.service`
   - `mss-update.service` — `./scripts/update-server.sh --watch`
5. `chmod +x scripts/update-server.sh` и один раз `./scripts/update-server.sh --force`.

Nginx/Caddy на корне домена проксирует другой сервис; MSS — `location /MusicStreamService/` → `http://127.0.0.1:3001/MusicStreamService/`.
