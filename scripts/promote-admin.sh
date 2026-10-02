#!/usr/bin/env bash
# Повышает существующий аккаунт до admin, подтверждает почту, выдаёт premium.
#
#   ./scripts/promote-admin.sh user@example.com
#   pnpm db:promote-admin -- user@example.com
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

EMAIL="${1:-${PROMOTE_ADMIN_EMAIL:-}}"
if [[ -z "$EMAIL" ]]; then
  echo "Usage: $0 user@example.com" >&2
  exit 1
fi

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

promote_sql() {
  local user pass dbname
  user="${POSTGRES_USER:-mss}"
  pass="${POSTGRES_PASSWORD:-mss}"
  dbname="${POSTGRES_DB:-mss}"
  if [[ -f "$ROOT/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT/.env"
    set +a
    user="${POSTGRES_USER:-mss}"
    pass="${POSTGRES_PASSWORD:-mss}"
    dbname="${POSTGRES_DB:-mss}"
  fi
  PGPASSWORD="$pass" compose -f docker-compose.yml -f docker-compose.app.yml exec -T postgres \
    psql -U "$user" -d "$dbname" -v ON_ERROR_STOP=1 -v email="$EMAIL" <<'SQL'
UPDATE users
SET role = 'admin',
    email_verified_at = COALESCE(email_verified_at, NOW())
WHERE lower(email) = lower(:'email');

INSERT INTO user_subscriptions (user_id, plan_id, status, starts_at, ends_at, source)
SELECT u.id, p.id, 'active', NOW(), NOW() + INTERVAL '3650 days', 'promote-admin'
FROM users u
JOIN subscription_plans p ON p.code = 'premium'
WHERE lower(u.email) = lower(:'email')
  AND NOT EXISTS (
    SELECT 1 FROM user_subscriptions s
    WHERE s.user_id = u.id AND s.status = 'active'
      AND s.plan_id = p.id
      AND (s.ends_at IS NULL OR s.ends_at > NOW())
  );

SELECT email, role, (email_verified_at IS NOT NULL) AS verified
FROM users
WHERE lower(email) = lower(:'email');
SQL
}

if [[ -f "$ROOT/docker-compose.app.yml" ]] && docker info >/dev/null 2>&1; then
  out="$(promote_sql)"
  echo "$out"
  if ! grep -Eqi '@|admin' <<<"$out"; then
    echo "Пользователь не найден: $EMAIL" >&2
    exit 1
  fi
  echo "Готово. Войдите в /dashboard заново — старый токен без роли admin."
  exit 0
fi

pnpm --filter @mss/api db:promote-admin -- "$EMAIL"
