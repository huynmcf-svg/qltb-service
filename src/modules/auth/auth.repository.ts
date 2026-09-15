import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../../db/drizzle.module';
import { enterprises, permissions, roles, roles_permissions, user_sessions, users, users_roles } from '../../db/schema';

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof user_sessions.$inferSelect;

export interface UserWithAccess {
  user: UserRow;
  enterprise: { enterprise_id: string; name: string; status: string; parent_id: string | null } | null;
  roles: string[];
  permissions: string[];
}

@Injectable()
export class AuthRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  findUserByUsername(username: string): Promise<UserWithAccess | null> {
    return this.loadUser(and(eq(users.username, username), isNull(users.deleted_at)));
  }

  findUserById(user_id: string): Promise<UserWithAccess | null> {
    return this.loadUser(and(eq(users.user_id, user_id), isNull(users.deleted_at)));
  }

  /** Người dùng + doanh nghiệp + mã vai trò + mã quyền (qua 2 bảng N-N). */
  private async loadUser(where: ReturnType<typeof and>): Promise<UserWithAccess | null> {
    const rows = await this.db
      .select({ user: users, enterprise: enterprises })
      .from(users)
      .leftJoin(enterprises, eq(users.enterprise_id, enterprises.enterprise_id))
      .where(where)
      .limit(1);
    const row = rows[0];
    if (!row) return null;

    const roleRows = await this.db
      .select({ code: roles.code, role_id: roles.role_id })
      .from(users_roles)
      .innerJoin(roles, eq(users_roles.role_id, roles.role_id))
      .where(eq(users_roles.user_id, row.user.user_id));

    const permissionRows = roleRows.length
      ? await this.db
          .selectDistinct({ code: permissions.code })
          .from(roles_permissions)
          .innerJoin(permissions, eq(roles_permissions.permission_id, permissions.permission_id))
          .where(inArray(roles_permissions.role_id, roleRows.map((r) => r.role_id)))
      : [];

    return {
      user: row.user,
      enterprise: row.enterprise
        ? {
            enterprise_id: row.enterprise.enterprise_id,
            name: row.enterprise.name,
            status: row.enterprise.status,
            parent_id: row.enterprise.parent_id,
          }
        : null,
      roles: roleRows.map((r) => r.code),
      permissions: permissionRows.map((p) => p.code),
    };
  }

  /** Phạm vi: doanh nghiệp + chi nhánh con (tối đa 2 cấp theo đặc tả). */
  async enterpriseScope(enterprise_id: string): Promise<string[]> {
    const rows = await this.db
      .select({ enterprise_id: enterprises.enterprise_id })
      .from(enterprises)
      .where(or(eq(enterprises.enterprise_id, enterprise_id), eq(enterprises.parent_id, enterprise_id)));
    return rows.map((r) => r.enterprise_id);
  }

  /** Tăng đếm sai; quá trần thì khoá tạm. Một câu UPDATE, không SELECT trước. */
  async recordLoginFailure(user_id: string, maxFailed: number, lockSeconds: number): Promise<void> {
    await this.db
      .update(users)
      .set({
        failed_login_count: sql`${users.failed_login_count} + 1`,
        locked_until: sql`CASE WHEN ${users.failed_login_count} + 1 >= ${maxFailed}
          THEN now() + make_interval(secs => ${lockSeconds}) ELSE ${users.locked_until} END`,
      })
      .where(eq(users.user_id, user_id));
  }

  async recordLoginSuccess(user_id: string): Promise<void> {
    await this.db
      .update(users)
      .set({ failed_login_count: 0, locked_until: null, last_login_at: new Date() })
      .where(eq(users.user_id, user_id));
  }

  async createSessionToken(input: {
    session_id: string;
    user_id: string;
    refresh_token_hash: string;
    expires_at: Date;
    ip?: string;
    user_agent?: string;
  }): Promise<SessionRow> {
    const [row] = await this.db.insert(user_sessions).values(input).returning();
    if (!row) throw new Error('insert user_sessions không trả về dòng nào');
    return row;
  }

  async findSessionByHash(hash: string): Promise<SessionRow | null> {
    const [row] = await this.db.select().from(user_sessions).where(eq(user_sessions.refresh_token_hash, hash)).limit(1);
    return row ?? null;
  }

  /**
   * Đánh dấu đã dùng CÓ ĐIỀU KIỆN `used_at IS NULL`: hai request refresh song
   * song cùng một thẻ thì chỉ một cái thắng, cái kia coi là dùng lại.
   */
  async markUsedIfUnused(session_token_id: string, replaced_by: string): Promise<boolean> {
    const rows = await this.db
      .update(user_sessions)
      .set({ used_at: new Date(), replaced_by, revoked_at: new Date(), revoked_reason: 'ROTATED' })
      .where(and(eq(user_sessions.session_token_id, session_token_id), isNull(user_sessions.used_at)))
      .returning({ id: user_sessions.session_token_id });
    return rows.length > 0;
  }

  /** Huỷ cả họ token của một phiên. Trả số thẻ bị huỷ. */
  async revokeSessionFamily(session_id: string, reason: string): Promise<number> {
    const rows = await this.db
      .update(user_sessions)
      .set({ revoked_at: new Date(), revoked_reason: reason })
      .where(and(eq(user_sessions.session_id, session_id), isNull(user_sessions.revoked_at)))
      .returning({ id: user_sessions.session_token_id });
    return rows.length;
  }

  /** Huỷ mọi phiên của người dùng (đổi mật khẩu, bị khoá). Trừ phiên `keep` nếu có. */
  async revokeAllSessions(user_id: string, reason: string, keep?: string): Promise<number> {
    const rows = await this.db
      .update(user_sessions)
      .set({ revoked_at: new Date(), revoked_reason: reason })
      .where(
        and(
          eq(user_sessions.user_id, user_id),
          isNull(user_sessions.revoked_at),
          keep ? sql`${user_sessions.session_id} <> ${keep}` : undefined,
        ),
      )
      .returning({ id: user_sessions.session_token_id });
    return rows.length;
  }

  async findUserByIdentifier(identifier: string): Promise<UserRow | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(or(eq(users.username, identifier), eq(users.email, identifier)), isNull(users.deleted_at)))
      .limit(1);
    return row ?? null;
  }

  async setResetToken(user_id: string, hash: string, expires_at: Date): Promise<void> {
    await this.db.update(users).set({ password_reset_token_hash: hash, password_reset_expires_at: expires_at }).where(eq(users.user_id, user_id));
  }

  async findByResetTokenHash(hash: string): Promise<UserRow | null> {
    const [row] = await this.db.select().from(users).where(and(eq(users.password_reset_token_hash, hash), isNull(users.deleted_at))).limit(1);
    return row ?? null;
  }

  async clearResetToken(user_id: string): Promise<void> {
    await this.db.update(users).set({ password_reset_token_hash: null, password_reset_expires_at: null }).where(eq(users.user_id, user_id));
  }

  async updatePassword(user_id: string, password_hash: string): Promise<void> {
    await this.db.update(users).set({ password_hash, must_change_password: false, updated_by: user_id }).where(eq(users.user_id, user_id));
  }

  async updateProfile(user_id: string, patch: { full_name?: string; email?: string | null; phone?: string | null }): Promise<UserRow | null> {
    const [row] = await this.db.update(users).set({ ...patch, updated_by: user_id }).where(eq(users.user_id, user_id)).returning();
    return row ?? null;
  }
}
