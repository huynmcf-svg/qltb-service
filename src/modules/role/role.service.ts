import { Injectable } from '@nestjs/common';
import { assertSystemAdmin } from '../../common/auth/scope';
import { AppException } from '../../common/errors/app.exception';
import { uniqueViolation } from '../../common/errors/db-error';
import { ErrorCode } from '../../common/errors/error-code';
import { AuditService } from '../audit/audit.service';
import { actorOf, meta, type Ctx } from '../enterprise/enterprise.service';
import type { CreateRoleDto, PermissionView, RoleView, SetRolePermissionsDto, UpdateRoleDto } from './dto/role.dto';
import { RoleRepository } from './role.repository';

/**
 * Vai trò là DỮ LIỆU dùng chung toàn hệ thống (không theo DN). Quản trị DN chỉ
 * đọc; tạo / sửa / xoá là việc của quản trị hệ thống. Vai trò `is_system`
 * không sửa được ma trận qua API — đó là bộ mặc định seed, muốn khác thì tạo
 * vai trò mới.
 */
@Injectable()
export class RoleService {
  constructor(
    private readonly repo: RoleRepository,
    private readonly audit: AuditService,
  ) {}

  list(): Promise<RoleView[]> {
    return this.repo.list();
  }

  permissions(): Promise<PermissionView[]> {
    return this.repo.allPermissions();
  }

  async get(role_id: string): Promise<RoleView> {
    const role = await this.repo.findById(role_id);
    if (!role) throw AppException.notFound('vai trò', role_id);
    return role;
  }

  async create(dto: CreateRoleDto, ctx: Ctx): Promise<RoleView> {
    assertSystemAdmin(ctx.actor, 'tạo được vai trò');
    const ids = await this.resolvePermissions(dto.permission_codes, ctx);
    let role_id: string;
    try {
      role_id = (await this.repo.create({ code: dto.code, name: dto.name, description: dto.description }, ids)).role_id;
    } catch (error) {
      if (uniqueViolation(error) === 'roles_code_key') throw AppException.conflict(ErrorCode.INVALID_PAYLOAD, 'Mã vai trò đã tồn tại', { code: dto.code });
      throw error;
    }
    await this.audit.record({ module: 'user', action: 'ROLE_CREATE', resource_type: 'role', resource_id: role_id, actor: actorOf(ctx), new_values: { ...dto }, ...meta(ctx) });
    return this.get(role_id);
  }

  async update(role_id: string, dto: UpdateRoleDto, ctx: Ctx): Promise<RoleView> {
    assertSystemAdmin(ctx.actor, 'sửa được vai trò');
    const before = await this.get(role_id);
    if (before.is_system) throw AppException.authorizationFailed('Vai trò hệ thống không sửa được', { role: before.code });
    await this.repo.update(role_id, dto);
    await this.audit.record({ module: 'user', action: 'ROLE_UPDATE', resource_type: 'role', resource_id: role_id, actor: actorOf(ctx), old_values: { name: before.name, description: before.description }, new_values: { ...dto }, ...meta(ctx) });
    return this.get(role_id);
  }

  async setPermissions(role_id: string, dto: SetRolePermissionsDto, ctx: Ctx): Promise<RoleView> {
    assertSystemAdmin(ctx.actor, 'sửa được quyền của vai trò');
    const before = await this.get(role_id);
    if (before.is_system) throw AppException.authorizationFailed('Vai trò hệ thống không sửa được ma trận quyền — tạo vai trò mới', { role: before.code });
    const ids = await this.resolvePermissions(dto.permission_codes, ctx);
    await this.repo.replacePermissions(role_id, ids);
    await this.audit.record({ module: 'user', action: 'ROLE_SET_PERMISSIONS', resource_type: 'role', resource_id: role_id, actor: actorOf(ctx), old_values: { permissions: before.permissions }, new_values: { permissions: dto.permission_codes }, ...meta(ctx) });
    return this.get(role_id);
  }

  async delete(role_id: string, ctx: Ctx): Promise<void> {
    assertSystemAdmin(ctx.actor, 'xoá được vai trò');
    const before = await this.get(role_id);
    if (before.is_system) throw AppException.authorizationFailed('Vai trò hệ thống không xoá được', { role: before.code });
    if (before.user_count > 0) throw AppException.unprocessable(ErrorCode.INVALID_PAYLOAD, 'Vai trò còn người dùng đang gán', { user_count: before.user_count });
    await this.repo.delete(role_id);
    await this.audit.record({ module: 'user', action: 'ROLE_DELETE', resource_type: 'role', resource_id: role_id, actor: actorOf(ctx), old_values: { code: before.code, permissions: before.permissions }, ...meta(ctx) });
  }

  private async resolvePermissions(codes: string[], ctx: Ctx): Promise<string[]> {
    const map = await this.repo.permissionIds(codes);
    const missing = codes.filter((c) => !map.has(c));
    if (missing.length) throw AppException.invalidPayload('Quyền không tồn tại', { violations: missing.map((c) => `permission_codes: ${c}`) });
    void ctx;
    return codes.map((c) => map.get(c)!);
  }
}
