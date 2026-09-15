# qltb-service

Backend REST của hệ thống quản lý thiết bị QLTB. NestJS 11 · Drizzle · PostgreSQL 16.

Tài liệu dự án, quy ước và hợp đồng API nằm ở **`qltb-workspace/docs/`** — đọc `docs/rules/backend-structure.md` trước khi sửa code.

## Chạy local

```bash
cp .env.example .env      # Postgres local: host/port/user/pass/db
npm install
npm run db:setup          # bật postgresql, tạo role + database nếu chưa có (cần sudo)
npm run db:migrate
npm run db:seed           # loại thiết bị mẫu
npm run start:dev         # http://localhost:3400 — swagger: /docs, health: /health
```

## Lệnh

| | |
|---|---|
| `npm run start:dev` | Dev, watch |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit + test Swagger (không cần DB) |
| `npm run test:db` | Thêm test tích hợp, cần Postgres |
| `npm run db:setup` | Bật `postgresql`, tạo role + database theo `.env` (`scripts/db-setup.sh`) |
| `npm run db:generate` | Sinh migration từ `src/db/schema/` |
| `npm run db:migrate` | Chạy migration |
| `npm run db:seed` | Seed dữ liệu mẫu (loại thiết bị) |

## Deploy Vercel

Hai GitHub repo = hai project Vercel. Import `qltb-service` trước, lấy URL, rồi import `qltb-web`.

Biến Production của **service**:

| Biến | Giá trị |
|---|---|
| `DATABASE_URL` | Neon **pooled** (hostname có `-pooler`) |
| `CORS_ORIGINS` | `https://<qltb-web>.vercel.app` — lần đầu có thể `*` rồi siết sau |
| `DATABASE_POOL_MAX` | không bắt buộc (Vercel mặc định 1) |

Migrate Neon trên máy local (`npm run db:migrate`), không chạy trên Vercel.
