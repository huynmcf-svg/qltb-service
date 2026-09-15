import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { assertInScope, assertSystemAdmin } from '../../common/auth/scope';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { AppException } from '../../common/errors/app.exception';
import { uniqueViolation } from '../../common/errors/db-error';
import { ErrorCode } from '../../common/errors/error-code';
import { AuditService } from '../audit/audit.service';
import { AuthRepository } from '../auth/auth.repository';
import { PasswordService } from '../auth/password.service';
import { EnterpriseRepository } from '../enterprise/enterprise.repository';
import { actorOf, meta, pick, type Ctx } from '../enterprise/enterprise.service';
import type { AssignRolesDto, CreateUserDto, DisableUserDto, ListUsersDto, ResetPasswordByAdminDto, UpdateUserDto, UserView } from './dto/user.dto';
import { UserRepository } from './user.repository';

/** Vai trò chỉ admin hệ thống mới gán được. */
const SYSTEM_ONLY_ROLES = new Set(['SYSTEM_ADMIN']);

@Injectable()
export class UserService {
  constructor(
    private readonly repo: UserRepository,
    private readonly enterprises: EnterpriseRepository,
    private readonly auth: AuthRepository,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  list(query: ListUsersDto, actor: AuthenticatedUser): Promise<CursorPage<UserView>> {
    return this.repo.list(query, actor.scope);
  }

  async get(user_id: string, actor: AuthenticatedUser): Promise<UserView> {
    const user = await this.repo.findById(user_id);
    if (!user) throw AppException.notFound('người dùng', user_id);
    assertInScope('người dùng', user_id, user.enterprise_id, actor);
    return user;
  }

  async create(dto: CreateUserDto, ctx: Ctx): Promise<UserView & { temporary_password?: string }> {
    const enterprise_id = dto.enterprise_id ?? null;
    if (enterprise_id === null) assertSystemAdmin(ctx.actor, 'tạo được tài khoản quản trị hệ thống');
    else {
      assertInScope('doanh nghiệp', enterprise_id, enterprise_id, ctx.actor);
      const enterprise = await this.enterprises.findRaw(enterprise_id);
      if (!enterprise) throw AppException.invalidPayload('Doanh nghiệp không tồn tại', { violations: ['enterprise_id không tồn tại'] });
      // Hạn mức tài khoản: kiểm ở service là đủ cho nghiệp vụ này (không phải đường nóng).
      const current = await this.repo.countActiveInEnterprise(enterprise_id);
      if (current >= enterprise.max_users) {
        throw AppException.unprocessable(ErrorCode.ENTERPRISE_USER_LIMIT, `Doanh nghiệp đã đủ ${enterprise.max_users} tài khoản`, { max_users: enterprise.max_users, current });
      }
    }
    await this.assertRolesAssignable(dto.role_ids, ctx.actor);

    const password = dto.password ?? randomBytes(9).toString('base64url');
    let user_id: string;
    try {
      const row = await this.repo.create(
        {
          username: dto.username,
          full_name: dto.full_name,
          email: dto.email,
          phone: dto.phone,
          enterprise_id,
          password_hash: await this.passwords.hash(password),
          must_change_password: true,
          created_by: ctx.actor.user_id,
        },
        dto.role_ids,
        ctx.actor.user_id,
      );
      user_id = row.user_id;
    } catch (error) {
      if (uniqueViolation(error) === 'users_username_key') {
        throw AppException.conflict(ErrorCode.USERNAME_CONFLICT, 'Tên đăng nhập đã tồn tại', { username: dto.username });
      }
      throw error;
    }
    await this.audit.record({ module: 'user', action: 'USER_CREATE', resource_type: 'user', resource_id: user_id, enterprise_id, actor: actorOf(ctx), new_values: { username: dto.username, full_name: dto.full_name, enterprise_id, role_ids: dto.role_ids }, ...meta(ctx) });
    const view = await this.get(user_id, ctx.actor);
    // Mật khẩu tạm chỉ hiện MỘT LẦN, và chỉ khi server sinh.
    return dto.password ? view : { ...view, temporary_password: password };
  }

  async update(user_id: string, dto: UpdateUserDto, ctx: Ctx): Promise<UserView> {
    const before = await this.get(user_id, ctx.actor);
    await this.repo.update(user_id, { ...dto, updated_by: ctx.actor.user_id });
    await this.audit.record({ module: 'user', action: 'USER_UPDATE', resource_type: 'user', resource_id: user_id, enterprise_id: before.enterprise_id, actor: actorOf(ctx), old_values: pick(before, Object.keys(dto)), new_values: { ...dto }, ...meta(ctx) });
    return this.get(user_id, ctx.actor);
  }

  async setDisabled(user_id: string, dto: DisableUserDto, ctx: Ctx): Promise<UserView> {
    const before = await this.get(user_id, ctx.actor);
    if (user_id === ctx.actor.user_id) throw AppException.unprocessable(ErrorCode.INVALID_PAYLOAD, 'Không tự khoá tài khoản của mình');
    const status = dto.disabled ? 'DISABLED' : 'ACTIVE';
    if (before.status !== status) {
      await this.repo.update(user_id, { status, updated_by: ctx.actor.user_id });
      // Khoá thì đá mọi phiên — guard nạp lại mỗi request nên access token cũng chết ngay.
      const revoked = dto.disabled ? await this.auth.revokeAllSessions(user_id, 'USER_DISABLED') : 0;
      await this.audit.record({ module: 'user', action: dto.disabled ? 'USER_DISABLE' : 'USER_ENABLE', resource_type: 'user', resource_id: user_id, enterprise_id: before.enterprise_id, actor: actorOf(ctx), old_values: { status: before.status }, new_values: { status, reason: dto.reason ?? null, revoked_sessions: revoked }, ...meta(ctx) });
    }
    return this.get(user_id, ctx.actor);
  }

  async assignRoles(user_id: string, dto: AssignRolesDto, ctx: Ctx): Promise<UserView> {
    const before = await this.get(user_id, ctx.actor);
    await this.assertRolesAssignable(dto.role_ids, ctx.actor);
    await this.repo.replaceRoles(user_id, dto.role_ids, ctx.actor.user_id);
    await this.audit.record({ module: 'user', action: 'USER_ASSIGN_ROLE', resource_type: 'user', resource_id: user_id, enterprise_id: before.enterprise_id, actor: actorOf(ctx), old_values: { roles: before.roles.map((r) => r.code) }, new_values: { role_ids: dto.role_ids }, ...meta(ctx) });
    return this.get(user_id, ctx.actor);
  }

  /** Quản trị đặt lại mật khẩu cho người khác — người đó phải đổi ở lần đăng nhập sau. */
  async resetPassword(user_id: string, dto: ResetPasswordByAdminDto, ctx: Ctx): Promise<{ temporary_password?: string }> {
    const before = await this.get(user_id, ctx.actor);
    const password = dto.new_password ?? randomBytes(9).toString('base64url');
    await this.repo.update(user_id, { password_hash: await this.passwords.hash(password), must_change_password: true, failed_login_count: 0, locked_until: null, updated_by: ctx.actor.user_id });
    const revoked = await this.auth.revokeAllSessions(user_id, 'PASSWORD_CHANGED');
    await this.audit.record({ module: 'user', action: 'USER_RESET_PASSWORD', resource_type: 'user', resource_id: user_id, enterprise_id: before.enterprise_id, actor: actorOf(ctx), new_values: { revoked_sessions: revoked }, ...meta(ctx) });
    return dto.new_password ? {} : { temporary_password: password };
  }

  async delete(user_id: string, ctx: Ctx): Promise<void> {
    const before = await this.get(user_id, ctx.actor);
    if (user_id === ctx.actor.user_id) throw AppException.unprocessable(ErrorCode.INVALID_PAYLOAD, 'Không tự xoá tài khoản của mình');
    await this.auth.revokeAllSessions(user_id, 'USER_DISABLED');
    await this.repo.softDelete(user_id);
    await this.audit.record({ module: 'user', action: 'USER_DELETE', resource_type: 'user', resource_id: user_id, enterprise_id: before.enterprise_id, actor: actorOf(ctx), old_values: { username: before.username, full_name: before.full_name }, ...meta(ctx) });
  }

  /** Vai trò phải tồn tại; DN admin không gán được SYSTEM_ADMIN. */
  private async assertRolesAssignable(role_ids: string[], actor: AuthenticatedUser): Promise<void> {
    const found = await this.repo.rolesExist(role_ids);
    const missing = role_ids.filter((id) => !found.some((r) => r.role_id === id));
    if (missing.length) throw AppException.invalidPayload('Vai trò không tồn tại', { violations: missing.map((id) => `role_ids: ${id} không tồn tại`) });
    if (actor.scope !== null) {
      const escalated = found.filter((r) => SYSTEM_ONLY_ROLES.has(r.code)).map((r) => r.code);
      if (escalated.length) throw AppException.authorizationFailed('Không thể gán vai trò cao hơn quyền của bạn', { escalated_roles: escalated });
    }
  }
}
