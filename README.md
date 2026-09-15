# qltb-service

Backend REST của hệ thống quản lý thiết bị QLTB. NestJS 11 · Drizzle · PostgreSQL 16.

Tài liệu dự án, quy ước và hợp đồng API nằm ở **`qltb-workspace/docs/`** — đọc `docs/rules/backend-structure.md` trước khi sửa code.

## Chạy local

```bash
cp .env.example .env      # Postgres local, xem qltb-workspace/scripts/db-setup.sh
npm install
npm run db:migrate
npm run start:dev         # http://localhost:3400 — swagger: /docs, health: /health
```

## Lệnh

| | |
|---|---|
| `npm run start:dev` | Dev, watch |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit + test Swagger (không cần DB) |
| `npm run test:db` | Thêm test tích hợp, cần Postgres |
| `npm run db:generate` | Sinh migration từ `src/db/schema/` |
| `npm run db:migrate` | Chạy migration |
| `npm run db:seed` | Seed dữ liệu mẫu (loại thiết bị) |
