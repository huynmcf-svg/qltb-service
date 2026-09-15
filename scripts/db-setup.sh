#!/usr/bin/env bash
# Chuẩn bị PostgreSQL local cho dev: bật service, tạo role + database nếu chưa có.
# Đọc DB_* từ .env của qltb-service. Chạy lại nhiều lần được.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[ -f .env ] || { echo "Thiếu .env — chạy: cp .env.example .env"; exit 1; }
set -a; . ./.env; set +a
: "${DB_HOST:=localhost}"
: "${DB_PORT:=5432}"
: "${DB_USER:?thiếu DB_USER trong .env}"
: "${DB_PASS:?thiếu DB_PASS trong .env}"
: "${DB_NAME:?thiếu DB_NAME trong .env}"

# ── 1. Bật postgresql ──────────────────────────────────────────
if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" -q 2>/dev/null; then
  echo "→ PostgreSQL chưa chạy, đang bật (cần sudo)..."
  sudo systemctl start postgresql
  for _ in $(seq 1 10); do
    pg_isready -h "$DB_HOST" -p "$DB_PORT" -q 2>/dev/null && break
    sleep 1
  done
  pg_isready -h "$DB_HOST" -p "$DB_PORT" -q || { echo "  PostgreSQL vẫn không trả lời trên ${DB_HOST}:${DB_PORT}"; exit 1; }
fi
echo "  PostgreSQL OK — ${DB_HOST}:${DB_PORT}"

# ── 2. Role ────────────────────────────────────────────────────
# Chạy qua user hệ thống `postgres` (peer auth) — không cần mật khẩu superuser.
psql_su() { sudo -u postgres psql -v ON_ERROR_STOP=1 -qtA "$@"; }

if [ "$(psql_su -c "SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}'")" = "1" ]; then
  echo "→ role ${DB_USER}: đã có"
else
  echo "→ role ${DB_USER}: tạo mới"
  psql_su -c "CREATE ROLE \"${DB_USER}\" LOGIN PASSWORD '${DB_PASS}'"
fi

# ── 3. Database ────────────────────────────────────────────────
if [ "$(psql_su -c "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'")" = "1" ]; then
  echo "→ database ${DB_NAME}: đã có"
else
  echo "→ database ${DB_NAME}: tạo mới"
  psql_su -c "CREATE DATABASE \"${DB_NAME}\" OWNER \"${DB_USER}\" ENCODING 'UTF8'"
fi

# ── 4. Kiểm tra kết nối bằng đúng credential mà service sẽ dùng ─
if PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -qtAc 'select 1' >/dev/null 2>&1; then
  echo "  Kết nối OK: postgresql://${DB_USER}:***@${DB_HOST}:${DB_PORT}/${DB_NAME}"
else
  cat <<MSG

  Tạo xong nhưng KHÔNG kết nối được bằng mật khẩu. Thường do pg_hba.conf
  đang để `peer` cho kết nối local. Sửa dòng local trong
  /etc/postgresql/16/main/pg_hba.conf thành `scram-sha-256` rồi:
      sudo systemctl reload postgresql

MSG
  exit 1
fi

cat <<MSG

  Xong. Bước tiếp theo:
      npm run db:migrate
      npm run db:seed

MSG
