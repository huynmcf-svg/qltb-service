import 'dotenv/config';
import type { Config } from 'drizzle-kit';
import { resolveDatabaseUrl } from './src/config/configuration';

/**
 * Sinh migration từ `src/db/schema/`, xuất ra `src/db/migrations/`.
 *
 * Lưu ý: drizzle-kit KHÔNG sinh trigger. Ràng buộc append-only của
 * `device_history` nằm ở migration viết tay `0001_append_only_guards.sql`.
 * Sau mỗi lần `drizzle-kit generate`, kiểm tra migration mới không drop mất
 * trigger đó.
 */
export default {
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: resolveDatabaseUrl(),
  },
  strict: true,
  verbose: true,
} satisfies Config;
