import { Inject, Injectable } from '@nestjs/common';
import { count, eq, inArray } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../../db/drizzle.module';
import { permissions, roles, roles_permissions, users_roles } from '../../db/schema';
import type { PermissionView, RoleView } from './dto/role.dto';

type Row = typeof roles.$inferSelect;

@Injectable()
export class RoleRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async list(): Promise<RoleView[]> {
    const rows = await this.db.select().from(roles).orderBy(roles.code);
    return this.hydrate(rows);
  }

  async findById(role_id: string): Promise<RoleView | null> {
    const [row] = await this.db.select().from(roles).where(eq(roles.role_id, role_id)).limit(1);
    if (!row) return null;
    return (await this.hydrate([row]))[0] ?? null;
  }

  private async hydrate(rows: Row[]): Promise<RoleView[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.role_id);
    const perms = await this.db
      .select({ role_id: roles_permissions.role_id, code: permissions.code })
      .from(roles_permissions)
      .innerJoin(permissions, eq(roles_permissions.permission_id, permissions.permission_id))
      .where(inArray(roles_permissions.role_id, ids))
      .orderBy(permissions.code);
    const counts = await this.db
      .select({ role_id: users_roles.role_id, n: count() })
      .from(users_roles)
      .where(inArray(users_roles.role_id, ids))
      .groupBy(users_roles.role_id);
    return rows.map((r) => ({
      role_id: r.role_id,
      code: r.code,
      name: r.name,
      description: r.description,
      is_system: r.is_system,
      permissions: perms.filter((p) => p.role_id === r.role_id).map((p) => p.code),
      user_count: Number(counts.find((c) => c.role_id === r.role_id)?.n ?? 0),
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
    }));
  }

  async allPermissions(): Promise<PermissionView[]> {
    const rows = await this.db.select({ code: permissions.code, name: permissions.name, group: permissions.group }).from(permissions).orderBy(permissions.group, permissions.code);
    return rows;
  }

  async permissionIds(codes: string[]): Promise<Map<string, string>> {
    if (!codes.length) return new Map();
    const rows = await this.db.select({ code: permissions.code, id: permissions.permission_id }).from(permissions).where(inArray(permissions.code, codes));
    return new Map(rows.map((r) => [r.code, r.id]));
  }

  async create(input: { code: string; name: string; description?: string }, permission_ids: string[]): Promise<Row> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(roles).values(input).returning();
      if (!row) throw new Error('insert roles không trả về dòng nào');
      if (permission_ids.length) await tx.insert(roles_permissions).values(permission_ids.map((permission_id) => ({ role_id: row.role_id, permission_id })));
      return row;
    });
  }

  async update(role_id: string, patch: { name?: string; description?: string }): Promise<void> {
    await this.db.update(roles).set(patch).where(eq(roles.role_id, role_id));
  }

  async replacePermissions(role_id: string, permission_ids: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(roles_permissions).where(eq(roles_permissions.role_id, role_id));
      if (permission_ids.length) await tx.insert(roles_permissions).values(permission_ids.map((permission_id) => ({ role_id, permission_id })));
    });
  }

  async delete(role_id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(roles_permissions).where(eq(roles_permissions.role_id, role_id));
      await tx.delete(roles).where(eq(roles.role_id, role_id));
    });
  }
}
