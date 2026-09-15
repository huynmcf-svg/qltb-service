import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { scopeCondition } from '../../common/auth/scope';
import { cursorOrder, cursorWhere, defined, likePattern, pageLimit, toPage } from '../../common/dto/cursor-page';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { DRIZZLE, type Db } from '../../db/drizzle.module';
import { enterprises, roles, users, users_roles } from '../../db/schema';
import type { ListUsersDto, UserRoleRef, UserView } from './dto/user.dto';

type Row = typeof users.$inferSelect;
type Insert = typeof users.$inferInsert;

@Injectable()
export class UserRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async list(query: ListUsersDto, scope: string[] | null): Promise<CursorPage<UserView>> {
    const limit = pageLimit(query);
    const roleFilter = query.role_code
      ? inArray(
          users.user_id,
          this.db
            .select({ id: users_roles.user_id })
            .from(users_roles)
            .innerJoin(roles, eq(users_roles.role_id, roles.role_id))
            .where(eq(roles.code, query.role_code)),
        )
      : undefined;
    const conditions = defined([
      isNull(users.deleted_at),
      scopeCondition(users.enterprise_id, scope),
      query.enterprise_id ? eq(users.enterprise_id, query.enterprise_id) : undefined,
      query.status ? eq(users.status, query.status) : undefined,
      roleFilter,
      query.q ? or(ilike(users.username, likePattern(query.q)), ilike(users.full_name, likePattern(query.q)), ilike(users.email, likePattern(query.q))) : undefined,
      cursorWhere(users.created_at, users.user_id, query),
    ]);
    const rows = await this.db
      .select({ user: users, enterprise_name: enterprises.name })
      .from(users)
      .leftJoin(enterprises, eq(users.enterprise_id, enterprises.enterprise_id))
      .where(and(...conditions))
      .orderBy(...cursorOrder(users.created_at, users.user_id))
      .limit(limit + 1);
    const roleMap = await this.rolesOf(rows.map((r) => r.user.user_id));
    return toPage(rows, limit, (r) => ({ ts: r.user.created_at, id: r.user.user_id }), (r) => toView(r.user, r.enterprise_name, roleMap.get(r.user.user_id) ?? []));
  }

  async findById(user_id: string): Promise<UserView | null> {
    const [row] = await this.db
      .select({ user: users, enterprise_name: enterprises.name })
      .from(users)
      .leftJoin(enterprises, eq(users.enterprise_id, enterprises.enterprise_id))
      .where(and(eq(users.user_id, user_id), isNull(users.deleted_at)))
      .limit(1);
    if (!row) return null;
    const roleMap = await this.rolesOf([user_id]);
    return toView(row.user, row.enterprise_name, roleMap.get(user_id) ?? []);
  }

  async findRaw(user_id: string): Promise<Row | null> {
    const [row] = await this.db.select().from(users).where(and(eq(users.user_id, user_id), isNull(users.deleted_at))).limit(1);
    return row ?? null;
  }

  private async rolesOf(userIds: string[]): Promise<Map<string, UserRoleRef[]>> {
    const map = new Map<string, UserRoleRef[]>();
    if (!userIds.length) return map;
    const rows = await this.db
      .select({ user_id: users_roles.user_id, role_id: roles.role_id, code: roles.code, name: roles.name })
      .from(users_roles)
      .innerJoin(roles, eq(users_roles.role_id, roles.role_id))
      .where(inArray(users_roles.user_id, userIds))
      .orderBy(roles.code);
    for (const r of rows) {
      const list = map.get(r.user_id) ?? [];
      list.push({ role_id: r.role_id, code: r.code, name: r.name });
      map.set(r.user_id, list);
    }
    return map;
  }

  async countActiveInEnterprise(enterprise_id: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.enterprise_id, enterprise_id), isNull(users.deleted_at)));
    return Number(row?.n ?? 0);
  }

  async rolesExist(role_ids: string[]): Promise<{ role_id: string; code: string }[]> {
    return this.db.select({ role_id: roles.role_id, code: roles.code }).from(roles).where(inArray(roles.role_id, role_ids));
  }

  /** Tạo user + gán vai trò trong MỘT transaction. 23505 lọt lên cho service. */
  async create(input: Insert, role_ids: string[], assigned_by: string): Promise<Row> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(users).values(input).returning();
      if (!row) throw new Error('insert users không trả về dòng nào');
      await tx.insert(users_roles).values(role_ids.map((role_id) => ({ user_id: row.user_id, role_id, assigned_by })));
      return row;
    });
  }

  async update(user_id: string, patch: Partial<Insert>): Promise<Row | null> {
    const [row] = await this.db.update(users).set(patch).where(eq(users.user_id, user_id)).returning();
    return row ?? null;
  }

  /** THAY THẾ toàn bộ vai trò. */
  async replaceRoles(user_id: string, role_ids: string[], assigned_by: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(users_roles).where(eq(users_roles.user_id, user_id));
      await tx.insert(users_roles).values(role_ids.map((role_id) => ({ user_id, role_id, assigned_by })));
    });
  }

  /** Soft delete: giữ dòng cho audit trỏ về; đổi username để giải phóng tên. */
  async softDelete(user_id: string): Promise<void> {
    await this.db
      .update(users)
      .set({ deleted_at: new Date(), status: 'DISABLED', username: sql`${users.username} || '#deleted#' || substr(${users.user_id}::text, 1, 8)` })
      .where(eq(users.user_id, user_id));
  }
}

export function toView(row: Row, enterprise_name: string | null, userRoles: UserRoleRef[]): UserView {
  return {
    user_id: row.user_id,
    username: row.username,
    email: row.email,
    full_name: row.full_name,
    phone: row.phone,
    enterprise_id: row.enterprise_id,
    enterprise_name,
    roles: userRoles,
    status: row.status,
    must_change_password: row.must_change_password,
    locked_until: row.locked_until?.toISOString() ?? null,
    last_login_at: row.last_login_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
