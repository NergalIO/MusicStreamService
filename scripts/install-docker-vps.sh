#!/usr/bin/env bash
# Полная установка MusicStreamService на VPS (Docker + Compose).
#
# Одной командой (raw URL, не github.com/blob):
#   curl -fsSL https://raw.githubusercontent.com/NergalIO/MusicStreamService/main/scripts/install-docker-vps.sh | sudo bash
#
# Из клона:
#   ./scripts/install-docker-vps.sh
#
# Переменные:
#   MSS_REPO          — git URL (default: https://github.com/NergalIO/MusicStreamService.git)
#   MSS_INSTALL_DIR   — каталог (default: /opt/MusicStreamService)
#   MSS_BRANCH        — ветка (default: main)
#   MSS_SKIP_CLONE=1  — не клонировать, только текущий каталог
#   MSS_SKIP_DOCKER=1 — не ставить Docker
#
set -euo pipefail

MSS_REPO="${MSS_REPO:-https://github.com/NergalIO/MusicStreamService.git}"
MSS_INSTALL_DIR="${MSS_INSTALL_DIR:-/opt/MusicStreamService}"
MSS_BRANCH="${MSS_BRANCH:-main}"
MSS_GITHUB_REPO="${MSS_GITHUB_REPO:-NergalIO/MusicStreamService}"

COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.app.yml)
ROOT=""
CREDENTIALS_FILE=""

log() { echo "[install-docker] $*"; }
warn() { echo "[install-docker] WARN: $*" >&2; }

need_root_hint() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]] && ! sudo -n true 2>/dev/null; then
    warn "Для установки в ${MSS_INSTALL_DIR} и Docker может понадобиться sudo:"
    warn "  curl -fsSL …/install-docker-vps.sh | sudo bash"
  fi
}

run_sudo() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

install_prerequisites() {
  if command -v apt-get >/dev/null 2>&1; then
    log "Пакеты: git, curl, openssl…"
    run_sudo apt-get update -qq
    run_sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git curl openssl ca-certificates python3
  else
    for c in git curl openssl; do
      command -v "$c" >/dev/null 2>&1 || {
        echo "Нужен $c (или Debian/Ubuntu с apt)" >&2
        exit 1
      }
    done
  fi
}

resolve_root() {
  local src="${BASH_SOURCE[0]:-}"
  if [[ -n "$src" && "$src" != bash && -f "$src" ]]; then
    local dir
    dir="$(cd "$(dirname "$src")/.." && pwd)"
    if [[ -f "$dir/docker-compose.app.yml" ]]; then
      echo "$dir"
      return 0
    fi
  fi
  if [[ -f "${MSS_INSTALL_DIR}/docker-compose.app.yml" ]]; then
    echo "$MSS_INSTALL_DIR"
    return 0
  fi
  echo ""
}

clone_or_update_repo() {
  if [[ "${MSS_SKIP_CLONE:-0}" == "1" ]]; then
    local r
    r="$(resolve_root)"
    if [[ -z "$r" ]]; then
      echo "MSS_SKIP_CLONE=1, но репозиторий не найден" >&2
      exit 1
    fi
    echo "$r"
    return 0
  fi

  local existing
  existing="$(resolve_root)"
  if [[ -n "$existing" && "$existing" != "$MSS_INSTALL_DIR" ]]; then
    log "Используем существующий клон: $existing"
    echo "$existing"
    return 0
  fi

  if [[ ! -d "$MSS_INSTALL_DIR" ]]; then
    log "Клонирование ${MSS_REPO} → ${MSS_INSTALL_DIR}"
    run_sudo mkdir -p "$(dirname "$MSS_INSTALL_DIR")"
    run_sudo git clone --depth 1 --branch "$MSS_BRANCH" "$MSS_REPO" "$MSS_INSTALL_DIR"
    if [[ "${EUID:-$(id -u)}" -ne 0 ]] && [[ -n "${SUDO_USER:-}" ]]; then
      run_sudo chown -R "$SUDO_USER:$SUDO_USER" "$MSS_INSTALL_DIR"
    elif [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
      run_sudo chown -R "$USER:$USER" "$MSS_INSTALL_DIR" 2>/dev/null || true
    fi
  elif [[ -d "$MSS_INSTALL_DIR/.git" ]]; then
    log "Обновление репозитория в ${MSS_INSTALL_DIR}"
    git -C "$MSS_INSTALL_DIR" fetch origin "$MSS_BRANCH" --depth 1 2>/dev/null || true
    git -C "$MSS_INSTALL_DIR" checkout "$MSS_BRANCH" 2>/dev/null || true
    git -C "$MSS_INSTALL_DIR" pull --ff-only origin "$MSS_BRANCH" 2>/dev/null || warn "git pull пропущен (локальные изменения?)"
  else
    echo "Каталог ${MSS_INSTALL_DIR} существует, но это не git-клон" >&2
    exit 1
  fi
  echo "$MSS_INSTALL_DIR"
}

docker_bin() {
  if docker info >/dev/null 2>&1; then
    echo docker
  elif run_sudo docker info >/dev/null 2>&1; then
    echo "sudo docker"
  else
    echo ""
  fi
}

install_docker() {
  if [[ "${MSS_SKIP_DOCKER:-0}" == "1" ]]; then
    return 0
  fi
  local d
  d="$(docker_bin)"
  if [[ -n "$d" ]] && $d compose version >/dev/null 2>&1; then
    log "Docker уже установлен: $($d --version)"
    return 0
  fi
  if [[ -n "$d" ]] && $d-compose version >/dev/null 2>&1; then
    log "Docker уже установлен (legacy compose)"
    return 0
  fi

  log "Устанавливаем Docker через get.docker.com…"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | run_sudo sh
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- https://get.docker.com | run_sudo sh
  else
    echo "Нужен curl или wget" >&2
    exit 1
  fi

  d="$(docker_bin)"
  if [[ -z "$d" ]]; then
    echo "Docker установлен, но daemon недоступен. Перезайдите в shell или: sudo systemctl start docker" >&2
    exit 1
  fi

  if [[ "${EUID:-$(id -u)}" -ne 0 ]] && ! id -nG "$USER" 2>/dev/null | grep -qw docker; then
    run_sudo usermod -aG docker "$USER" 2>/dev/null || true
    warn "Пользователь $USER добавлен в группу docker — выполните newgrp docker или перелогиньтесь"
  fi
}

compose() {
  local d
  d="$(docker_bin)"
  if [[ -z "$d" ]]; then
    echo "Docker недоступен" >&2
    exit 1
  fi
  if $d compose version >/dev/null 2>&1; then
    $d compose "${COMPOSE_FILES[@]}" "$@"
  else
    $d-compose "${COMPOSE_FILES[@]}" "$@"
  fi
}

rand_hex() {
  local n="${1:-32}"
  openssl rand -hex "$n"
}

env_get() {
  local key="$1"
  [[ -f "$ROOT/.env" ]] || return 0
  grep -E "^${key}=" "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r'
}

env_set() {
  local key="$1" val="$2"
  python3 - "$ROOT/.env" "$key" "$val" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
key = sys.argv[2]
val = sys.argv[3]
lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
out = []
found = False
prefix = key + "="
for line in lines:
    if line.startswith(prefix):
        out.append(f"{key}={val}")
        found = True
    else:
        out.append(line)
if not found:
    out.append(f"{key}={val}")
path.write_text("\n".join(out) + "\n", encoding="utf-8")
PY
}

placeholder() {
  local v="$1"
  [[ -z "$v" ]] && return 0
  case "$v" in
    change-me-* | change-offline-secret | owner/MusicStreamService | https://your-domain.com/*)
      return 0
      ;;
  esac
  return 1
}

detect_public_host() {
  local host=""
  if command -v curl >/dev/null 2>&1; then
    host="$(curl -fsSL --max-time 8 https://api.ipify.org 2>/dev/null || true)"
    [[ -z "$host" ]] && host="$(curl -fsSL --max-time 8 https://ifconfig.me 2>/dev/null || true)"
  fi
  if [[ -z "$host" ]]; then
    host="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  echo "$host"
}

ensure_env() {
  if [[ ! -f "$ROOT/.env.docker.example" ]]; then
    echo "Нет .env.docker.example в $ROOT" >&2
    exit 1
  fi
  if [[ ! -f "$ROOT/.env" ]]; then
    cp "$ROOT/.env.docker.example" "$ROOT/.env"
    log "Создан .env из .env.docker.example"
  else
    log ".env уже существует — дополним только пустые/placeholder значения"
  fi
}

configure_env() {
  if ! command -v openssl >/dev/null 2>&1; then
    warn "openssl не найден — секреты задайте в .env вручную"
    return 0
  fi

  local jwt pg offline admin_email admin_pass
  jwt="$(env_get JWT_SECRET)"
  if placeholder "$jwt"; then
    jwt="$(rand_hex 32)"
    env_set JWT_SECRET "$jwt"
    log "JWT_SECRET сгенерирован"
  fi

  pg="$(env_get POSTGRES_PASSWORD)"
  if placeholder "$pg"; then
    pg="$(rand_hex 16)"
    env_set POSTGRES_PASSWORD "$pg"
    log "POSTGRES_PASSWORD сгенерирован"
  fi
  local db_url
  db_url="$(env_get DATABASE_URL)"
  if placeholder "$db_url" || [[ "$db_url" == *change-me-postgres* ]]; then
    env_set DATABASE_URL "postgresql://mss:${pg}@postgres:5432/mss"
  fi

  offline="$(env_get OFFLINE_HKDF_SECRET)"
  if placeholder "$offline"; then
    offline="$(rand_hex 32)"
    env_set OFFLINE_HKDF_SECRET "$offline"
    log "OFFLINE_HKDF_SECRET сгенерирован"
  fi

  local gh
  gh="$(env_get GITHUB_REPO)"
  if placeholder "$gh"; then
    env_set GITHUB_REPO "$MSS_GITHUB_REPO"
  fi

  local api_url base_path port host
  base_path="$(env_get PUBLIC_BASE_PATH)"
  [[ -z "$base_path" ]] && base_path="/MusicStreamService"
  port="$(env_get API_PORT)"
  [[ -z "$port" ]] && port="3001"

  api_url="$(env_get API_PUBLIC_URL)"
  if placeholder "$api_url"; then
    host="$(detect_public_host)"
    if [[ -n "$host" ]]; then
      api_url="http://${host}:${port}${base_path}"
      env_set API_PUBLIC_URL "$api_url"
      log "API_PUBLIC_URL=${api_url} (при домене/TLS замените в .env на https://…)"
    fi
  fi

  admin_email="$(env_get MSS_BOOTSTRAP_ADMIN_EMAIL)"
  admin_pass="$(env_get MSS_BOOTSTRAP_ADMIN_PASSWORD)"
  if [[ -z "$admin_email" ]] || placeholder "$admin_email"; then
    admin_email="admin@$(hostname -s 2>/dev/null || echo mss).local"
    env_set MSS_BOOTSTRAP_ADMIN_EMAIL "$admin_email"
  fi
  if [[ -z "$admin_pass" ]] || placeholder "$admin_pass"; then
    admin_pass="$(rand_hex 16)"
    env_set MSS_BOOTSTRAP_ADMIN_PASSWORD "$admin_pass"
    log "Учётная запись администратора приложения будет создана при seed"
  fi

  mkdir -p "$ROOT/data/object-store" "$ROOT/tmp/uploads" 2>/dev/null || true
}

write_credentials() {
  CREDENTIALS_FILE="${MSS_CREDENTIALS_FILE:-$ROOT/.mss-install-credentials}"
  local pg_user api_url base_path port
  pg_user="$(env_get POSTGRES_USER)"
  [[ -z "$pg_user" ]] && pg_user="mss"
  base_path="$(env_get PUBLIC_BASE_PATH)"
  [[ -z "$base_path" ]] && base_path="/MusicStreamService"
  port="$(env_get API_PORT)"
  [[ -z "$port" ]] && port="3001"
  api_url="$(env_get API_PUBLIC_URL)"

  umask 077
  cat >"$CREDENTIALS_FILE" <<EOF
# MusicStreamService — сгенерировано $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Храните в безопасном месте. Файл на сервере: chmod 600

INSTALL_DIR=${ROOT}

POSTGRES_USER=${pg_user}
POSTGRES_PASSWORD=$(env_get POSTGRES_PASSWORD)
DATABASE_URL=$(env_get DATABASE_URL)

MSS_ADMIN_EMAIL=$(env_get MSS_BOOTSTRAP_ADMIN_EMAIL)
MSS_ADMIN_PASSWORD=$(env_get MSS_BOOTSTRAP_ADMIN_PASSWORD)

API_PUBLIC_URL=${api_url}
LOCAL_HEALTH=http://127.0.0.1:${port}${base_path}/health
LANDING=http://127.0.0.1:${port}${base_path}/

PROMO_PREMIUM=PREMIUM30
EOF
  chmod 600 "$CREDENTIALS_FILE" 2>/dev/null || true
  log "Учётные данные: ${CREDENTIALS_FILE}"
}

wait_for_api() {
  local base_path port url i
  base_path="$(env_get PUBLIC_BASE_PATH)"
  [[ -z "$base_path" ]] && base_path="/MusicStreamService"
  port="$(env_get API_PORT)"
  [[ -z "$port" ]] && port="3001"
  url="http://127.0.0.1:${port}${base_path}/health"
  log "Ожидание API: ${url}"
  for i in $(seq 1 90); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      log "API отвечает"
      return 0
    fi
    sleep 2
  done
  warn "API не ответил за 3 мин — проверьте: compose logs api"
  return 1
}

run_seed() {
  log "Миграции (migrate) и seed (планы + admin)…"
  compose up -d --build
  wait_for_api || true
  compose run --rm api node apps/api/dist/db/seed.js
}

print_summary() {
  local base_path port
  base_path="$(env_get PUBLIC_BASE_PATH)"
  [[ -z "$base_path" ]] && base_path="/MusicStreamService"
  port="$(env_get API_PORT)"
  [[ -z "$port" ]] && port="3001"

  echo ""
  log "========== Готово =========="
  log "Каталог: ${ROOT}"
  log "Лендинг:  http://127.0.0.1:${port}${base_path}/"
  log "Health:   curl -s http://127.0.0.1:${port}${base_path}/health"
  log "Логи:     cd ${ROOT} && $(docker_bin) compose ${COMPOSE_FILES[*]} logs -f api"
  echo ""
  log "Логин приложения (admin): $(env_get MSS_BOOTSTRAP_ADMIN_EMAIL)"
  log "Пароль приложения:       см. ${CREDENTIALS_FILE}"
  log "PostgreSQL: user=$(env_get POSTGRES_USER) password в ${CREDENTIALS_FILE}"
  echo ""
  log "После настройки домена/TLS обновите API_PUBLIC_URL в .env и перезапустите api/worker."
}

main() {
  need_root_hint
  install_prerequisites
  ROOT="$(clone_or_update_repo)"
  cd "$ROOT"
  log "Рабочий каталог: $ROOT"

  install_docker
  ensure_env
  configure_env
  write_credentials

  log "Сборка и запуск контейнеров…"
  compose up -d --build

  wait_for_api || true
  compose run --rm api node apps/api/dist/db/seed.js

  print_summary
}

main "$@"
