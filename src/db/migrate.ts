import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { resolveDatabaseUrl } from '../config/configuration';

/**
 * Chạy migration: `npm run db:migrate`
 *
 * Dùng migrator của drizzle-orm thay vì `drizzle-kit migrate` vì có migration
 * viết tay (`0001_constraints_and_guards.sql` — CHECK, trigger). Migrator đọc
 * `meta/_journal.json` nên chạy cả file sinh tự động lẫn file viết tay.
 */
async function main() {
  const url = resolveDatabaseUrl();
  if (!url) throw new Error('Thiếu DATABASE_URL (hoặc bộ DB_HOST / DB_USER / DB_NAME)');

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: './src/db/migrations' });
    console.log('[migrate] xong');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('[migrate] thất bại:', error);
  process.exit(1);
});
