import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { resolveDatabaseUrl } from '../config/configuration';
import { PERMISSION_CATALOG, ROLE_SEED } from '../modules/permission/permission.catalog';
import * as schema from './schema';

/**
 * Seed: danh mục quyền · 3 vai trò hệ thống · tài khoản quản trị đầu tiên.
 * `npm run db:seed` — chạy lại được nhiều lần (upsert theo `code` / `username`).
 *
 * Tài khoản admin: SEED_ADMIN_USERNAME (mặc định `admin`), SEED_ADMIN_PASSWORD
 * bỏ trống thì sinh ngẫu nhiên và in ra MỘT LẦN. Chỉ tạo khi chưa có.
 */
async function main() {
  const url = resolveDatabaseUrl();
  if (!url) throw new Error('Thiếu DATABASE_URL (hoặc bộ DB_HOST / DB_USER / DB_NAME)');

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool, { schema });
  try {
    // ── 1. Quyền ─────────────────────────────────────────────
    await db
      .insert(schema.permissions)
      .values(PERMISSION_CATALOG.map((p) => ({ code: p.code, name: p.name, group: p.group })))
      .onConflictDoUpdate({
        target: schema.permissions.code,
        set: { name: sql`excluded.name`, group: sql`excluded."group"` },
      });
    const permissionRows = await db.select().from(schema.permissions);
    const permissionIdByCode = new Map(permissionRows.map((p) => [p.code, p.permission_id]));
    console.log(`[seed] ${PERMISSION_CATALOG.length} quyền`);

    // ── 2. Vai trò + ma trận quyền ──────────────────────────
    for (const role of ROLE_SEED) {
      const [row] = await db
        .insert(schema.roles)
        .values({ code: role.code, name: role.name, description: role.description, is_system: role.is_system })
        .onConflictDoUpdate({
          target: schema.roles.code,
          set: { name: role.name, description: role.description, is_system: role.is_system },
        })
        .returning();
      if (!row) throw new Error(`không upsert được vai trò ${role.code}`);

      // Thay thế toàn bộ ma trận của vai trò hệ thống theo catalog.
      await db.delete(schema.roles_permissions).where(eq(schema.roles_permissions.role_id, row.role_id));
      const ids = role.permissions.map((code) => {
        const id = permissionIdByCode.get(code);
        if (!id) throw new Error(`quyền ${code} không có trong catalog`);
        return id;
      });
      if (ids.length) {
        await db
          .insert(schema.roles_permissions)
          .values(ids.map((permission_id) => ({ role_id: row.role_id, permission_id })));
      }
      console.log(`[seed] vai trò ${role.code}: ${ids.length} quyền`);
    }

    // ── 3. Admin đầu tiên ───────────────────────────────────
    const username = process.env.SEED_ADMIN_USERNAME ?? 'admin';
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.username, username)).limit(1);
    if (existing) {
      console.log(`[seed] tài khoản ${username} đã có, bỏ qua`);
    } else {
      const password = process.env.SEED_ADMIN_PASSWORD || randomBytes(9).toString('base64url');
      const [admin] = await db
        .insert(schema.users)
        .values({
          username,
          full_name: 'Quản trị hệ thống',
          password_hash: await hash(password),
          must_change_password: !process.env.SEED_ADMIN_PASSWORD,
        })
        .returning();
      const [adminRole] = await db.select().from(schema.roles).where(inArray(schema.roles.code, ['SYSTEM_ADMIN']));
      if (!admin || !adminRole) throw new Error('không tạo được admin');
      await db.insert(schema.users_roles).values({ user_id: admin.user_id, role_id: adminRole.role_id });
      console.log(`[seed] tạo tài khoản ${username}${process.env.SEED_ADMIN_PASSWORD ? '' : ` — mật khẩu (in MỘT lần): ${password}`}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('[seed] thất bại:', error);
  process.exit(1);
});
