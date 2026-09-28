#!/usr/bin/env bash
# Обновление MSS на VPS (Docker): git pull + compose rebuild + migrate.
#
#   cd /opt/MusicStreamService && ./scripts/update-docker-vps.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.app.yml)

log() { echo "[update-docker] $*" >&2; }

docker_bin() {
  if docker info >/dev/null 2>&1; then
    echo docker
    return 0
  fi
  if [[ "${EUID:-$(id -u)}" -ne 0 ]] && sudo docker info >/dev/null 2>&1; then
    echo "sudo docker"
    return 0
  fi
  echo ""
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

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  branch="$(git rev-parse --abbrev-ref HEAD)"
  [[ "$branch" == "HEAD" ]] && branch="main"
  log "git pull ($branch)"
  if [[ -f .git/shallow ]]; then
    git fetch --unshallow origin "$branch" 2>/dev/null || git fetch origin "$branch" || true
  else
    git fetch origin "$branch" || true
  fi
  git pull --ff-only origin "$branch" || {
    log "WARN: git pull не удался — продолжаем с текущей версии"
  }
else
  log "WARN: не git-клон, пропуск pull"
fi

log "compose up -d --build"
compose up -d --build

log "migrate (one-shot)"
compose run --rm migrate

log "готово; логи: compose logs -f api worker"
