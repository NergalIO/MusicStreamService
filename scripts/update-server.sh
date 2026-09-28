#!/usr/bin/env bash
# Git pull + пересборка API/worker. Клиенты (.exe/.apk) — GitHub Releases (см. scripts/client-install).
#
#   ./scripts/update-server.sh
#   ./scripts/update-server.sh --watch
#   ./scripts/update-server.sh --force
#   ./scripts/update-server.sh --no-client
#   ./scripts/update-server.sh --client
#   ./scripts/update-server.sh --apk
#   ./scripts/update-server.sh --no-apk
set -euo pipefail

INTERVAL="${INTERVAL:-60}"
WINE_IMAGE="${ELECTRON_BUILDER_IMAGE:-electronuserland/builder:wine}"
APK_IMAGE_DEFAULT="mss-apk:local"
WATCH=0
FORCE=0
RESET=0
DO_CLIENT="${BUILD_CLIENT:-0}"
DO_APK="${BUILD_APK:-0}"
FORCE_CLIENT=0
FORCE_APK=0

for arg in "$@"; do
  case "$arg" in
    --watch) WATCH=1 ;;
    --force) FORCE=1 ;;
    --reset) RESET=1 ;;
    --no-client) DO_CLIENT=0 ;;
    --client) FORCE_CLIENT=1 ;;
    --no-apk) DO_APK=0 ;;
    --apk) FORCE_APK=1 ;;
    -h|--help)
      echo "Usage: $0 [--watch] [--force] [--reset] [--client] [--no-client] [--apk] [--no-apk]"
      echo "  --client / --no-client  Windows (.exe через Wine), BUILD_CLIENT=1 для включения"
      echo "  --apk / --no-apk        Android APK (Docker), BUILD_APK=1 для включения"
      echo "  --force                 сервер + клиенты (если BUILD_*=1); --client/--apk форсируют только свой target"
      exit 0
      ;;
    *)
      echo "Неизвестный аргумент: $arg" >&2
      exit 1
      ;;
  esac
done

ARGS=("$@")
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOCK="$ROOT/.update.lock"
STAMP_SERVER="$ROOT/.update-stamp-server"
STAMP_DESKTOP="$ROOT/.update-stamp-desktop"
STAMP_APK="$ROOT/.update-stamp-apk"
RELEASES_DIR="$ROOT/data/releases"
CANONICAL_EXE="${RELEASE_WINDOWS_FILE:-MusicStreamService-setup.exe}"
CANONICAL_APK="${RELEASE_ANDROID_FILE:-mss-android.apk}"

LOG_PREFIX() { echo "[$(date -Iseconds)]"; }

exec 9>"$LOCK"
if ! flock -n 9; then
  echo "$(LOG_PREFIX) уже выполняется, выход"
  exit 0
fi

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

hash_files() {
  sha256sum "$@" 2>/dev/null || true
}

fingerprint_server() {
  (
    cd "$ROOT"
    hash_files docker-compose.yml pnpm-lock.yaml package.json
    find apps/api apps/worker packages -type f \
      ! -path '*/node_modules/*' \
      ! -path '*/dist/*' \
      2>/dev/null | sort | xargs -r sha256sum
  ) | sha256sum | awk '{print $1}'
}

fingerprint_desktop() {
  (
    cd "$ROOT"
    hash_files apps/desktop/package.json apps/desktop/electron.vite.config.ts
    find apps/desktop/src apps/desktop/electron apps/desktop/scripts -type f \
      ! -path '*/node_modules/*' \
      2>/dev/null | sort | xargs -r sha256sum
    find packages -type f \
      ! -path '*/node_modules/*' \
      ! -path '*/dist/*' \
      2>/dev/null | sort | xargs -r sha256sum
  ) | sha256sum | awk '{print $1}'
}

fingerprint_apk() {
  (
    cd "$ROOT"
    hash_files apps/android/Dockerfile apps/android/build.gradle.kts
    find apps/android -type f \
      ! -path '*/build/*' \
      ! -path '*/.gradle/*' \
      ! -name 'local.properties' \
      2>/dev/null | sort | xargs -r sha256sum
  ) | sha256sum | awk '{print $1}'
}

changed() {
  local now="$1" stamp="$2"
  local old=""
  [[ -f "$stamp" ]] && old="$(cat "$stamp")"
  [[ "$now" != "$old" ]]
}

git_update() {
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "$(LOG_PREFIX) не git-репозиторий, пропускаю pull"
    return 1
  fi
  git fetch --quiet origin || {
    echo "$(LOG_PREFIX) git fetch не удался" >&2
    return 1
  }
  local branch remote local_rev remote_rev
  branch="$(git rev-parse --abbrev-ref HEAD)"
  [[ "$branch" == "HEAD" ]] && branch="main"
  remote="origin/$branch"
  git rev-parse --verify "$remote" >/dev/null 2>&1 || remote="origin/main"
  local_rev="$(git rev-parse HEAD)"
  remote_rev="$(git rev-parse "$remote")"
  [[ "$local_rev" == "$remote_rev" ]] && return 1
  echo "$(LOG_PREFIX) git: $local_rev → $remote_rev"
  if [[ "$RESET" == 1 ]]; then
    git reset --hard "$remote"
  else
    git merge --ff-only "$remote"
  fi
}

cleanup_old_installers() {
  mkdir -p "$RELEASES_DIR"
  local f base
  shopt -s nullglob
  for f in "$RELEASES_DIR"/*.exe "$RELEASES_DIR"/*.apk; do
    base="$(basename "$f")"
    [[ "$base" == "$CANONICAL_EXE" || "$base" == "$CANONICAL_APK" || "$base" == "README.md" ]] && continue
    rm -f "$f"
    echo "$(LOG_PREFIX) удалено ${f#"$ROOT/"}"
  done
  shopt -u nullglob
}

load_env_api_public() {
  if [[ -f "$ROOT/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT/.env"
    set +a
  fi
}

rebuild_server() {
  echo "$(LOG_PREFIX) сервер: docker compose + pnpm build"
  compose up -d postgres redis
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "$(LOG_PREFIX) pnpm не найден" >&2
    return 1
  fi
  pnpm install --frozen-lockfile
  pnpm build
  pnpm db:migrate
  if systemctl is-active --quiet mss-api 2>/dev/null; then
    systemctl restart mss-api mss-worker
    echo "$(LOG_PREFIX) systemd: mss-api, mss-worker перезапущены"
  else
    echo "$(LOG_PREFIX) systemd units не найдены — запустите api/worker вручную или установите deploy/systemd/*.service"
  fi
  echo "$(LOG_PREFIX) сервер готов"
}

pack_win() {
  echo "$(LOG_PREFIX) desktop: Windows через ${WINE_IMAGE}"
  if ! docker info >/dev/null 2>&1; then
    echo "$(LOG_PREFIX) docker недоступен, Windows пропущен" >&2
    return 1
  fi
  load_env_api_public
  docker run --rm \
    -e CSC_IDENTITY_AUTO_DISCOVERY=false \
    -e PACK_ON_SERVER=1 \
    -e PACK_RELEASE_DIR=/tmp/mss-win-release \
    -e "API_PUBLIC_URL=${API_PUBLIC_URL:-}" \
    -e "RELEASE_WINDOWS_FILE=${CANONICAL_EXE}" \
    -v "$ROOT":/project \
    -v mss-electron-cache:/root/.cache/electron \
    -v mss-electron-builder-cache:/root/.cache/electron-builder \
    -w /project \
    "$WINE_IMAGE" \
    bash -lc 'corepack enable && corepack prepare pnpm@latest --activate && pnpm install --frozen-lockfile && pnpm build && node apps/desktop/scripts/pack-win.cjs' || return 1
  cleanup_old_installers
  [[ -f "$RELEASES_DIR/$CANONICAL_EXE" ]] || {
    echo "$(LOG_PREFIX) нет $CANONICAL_EXE" >&2
    return 1
  }
  echo "$(LOG_PREFIX) Windows: $RELEASES_DIR/$CANONICAL_EXE"
}

ensure_apk_image() {
  if [[ -n "${ANDROID_BUILD_IMAGE:-}" ]]; then
    printf '%s' "$ANDROID_BUILD_IMAGE"
    return 0
  fi
  echo "$(LOG_PREFIX) docker: образ APK (${APK_IMAGE_DEFAULT})" >&2
  docker build -t "$APK_IMAGE_DEFAULT" -f "$ROOT/apps/android/Dockerfile" "$ROOT/apps/android" >&2
  printf '%s' "$APK_IMAGE_DEFAULT"
}

pack_apk() {
  if ! docker info >/dev/null 2>&1; then
    echo "$(LOG_PREFIX) docker недоступен, APK пропущен" >&2
    return 1
  fi
  local image
  image="$(ensure_apk_image)"
  echo "$(LOG_PREFIX) android: APK через ${image}"
  load_env_api_public
  docker run --rm \
    -e PACK_ON_SERVER=1 \
    -e "RELEASE_ANDROID_FILE=${CANONICAL_APK}" \
    -e "APK_VARIANT=${APK_VARIANT:-debug}" \
    -e "GRADLE_JVM_ARGS=${GRADLE_JVM_ARGS:--Xmx768m -Dfile.encoding=UTF-8}" \
    -e ANDROID_HOME=/opt/android-sdk \
    -e ANDROID_SDK_ROOT=/opt/android-sdk \
    -e TMPDIR=/root/.gradle/tmp \
    -v "$ROOT":/project \
    -v mss-gradle-cache:/root/.gradle \
    -w /project/apps/android \
    "$image" \
    bash -lc 'mkdir -p /root/.gradle/tmp && node scripts/pack-apk.cjs' || return 1
  cleanup_old_installers
  [[ -f "$RELEASES_DIR/$CANONICAL_APK" ]] || {
    echo "$(LOG_PREFIX) нет $CANONICAL_APK" >&2
    return 1
  }
  echo "$(LOG_PREFIX) APK: $RELEASES_DIR/$CANONICAL_APK"
}

once() {
  if git_update; then
    if [[ "$WATCH" == 1 ]]; then
      echo "$(LOG_PREFIX) git: перезапуск после pull"
      exec bash "$ROOT/scripts/update-server.sh" "${ARGS[@]}"
    fi
  fi

  local server_now desktop_now apk_now failed=0
  server_now="$(fingerprint_server)"
  desktop_now="$(fingerprint_desktop)"
  apk_now="$(fingerprint_apk)"

  if [[ "$FORCE" == 1 ]] || changed "$server_now" "$STAMP_SERVER"; then
    rebuild_server && echo "$server_now" >"$STAMP_SERVER"
  else
    echo "$(LOG_PREFIX) сервер без изменений"
  fi

  if [[ "$DO_CLIENT" != 1 ]]; then
    echo "$(LOG_PREFIX) сборка Windows отключена"
  elif [[ "$FORCE" == 1 || "$FORCE_CLIENT" == 1 ]] || changed "$desktop_now" "$STAMP_DESKTOP"; then
    if pack_win; then
      echo "$desktop_now" >"$STAMP_DESKTOP"
    else
      failed=1
    fi
  else
    echo "$(LOG_PREFIX) Windows без изменений"
  fi

  if [[ "$DO_APK" != 1 ]]; then
    echo "$(LOG_PREFIX) сборка APK отключена"
  elif [[ "$FORCE" == 1 || "$FORCE_APK" == 1 ]] || changed "$apk_now" "$STAMP_APK"; then
    if pack_apk; then
      echo "$apk_now" >"$STAMP_APK"
    else
      failed=1
    fi
  else
    echo "$(LOG_PREFIX) APK без изменений"
  fi

  return "$failed"
}

if [[ "$WATCH" == 1 ]]; then
  echo "$(LOG_PREFIX) слежение каждые ${INTERVAL} с ($ROOT)"
  while true; do
    once || echo "$(LOG_PREFIX) ошибка, повтор через ${INTERVAL} с" >&2
    sleep "$INTERVAL"
  done
else
  once
fi
