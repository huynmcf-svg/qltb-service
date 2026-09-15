import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { resolveDatabaseUrl } from '../config/configuration';
import * as schema from './schema';

/**
 * Seed danh mục loại thiết bị: `npm run db:seed`
 *
 * Chạy lại được nhiều lần — `ON CONFLICT DO NOTHING` theo `code`.
 */
const CATEGORIES = [
  { code: 'LAPTOP', name: 'Laptop' },
  { code: 'DESKTOP', name: 'Máy tính để bàn' },
  { code: 'MONITOR', name: 'Màn hình' },
  { code: 'PRINTER', name: 'Máy in' },
  { code: 'PHONE', name: 'Điện thoại' },
  { code: 'NETWORK', name: 'Thiết bị mạng' },
  { code: 'OTHER', name: 'Khác' },
];

async function main() {
  const url = resolveDatabaseUrl();
  if (!url) throw new Error('Thiếu DATABASE_URL (hoặc bộ DB_HOST / DB_USER / DB_NAME)');

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool, { schema });
  try {
    const inserted = await db
      .insert(schema.device_categories)
      .values(CATEGORIES)
      .onConflictDoNothing({ target: schema.device_categories.code })
      .returning({ code: schema.device_categories.code });
    console.log(`[seed] thêm ${inserted.length} loại thiết bị mới (${CATEGORIES.length} trong danh sách)`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('[seed] thất bại:', error);
  process.exit(1);
});
