import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { assertInScope, assertSystemAdmin } from '../../common/auth/scope';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { AppException } from '../../common/errors/app.exception';
import { foreignKeyViolation, uniqueViolation } from '../../common/errors/db-error';
import { ErrorCode } from '../../common/errors/error-code';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import { EnterpriseRepository } from './enterprise.repository';
import type { ChangeEnterpriseStatusDto, CreateEnterpriseDto, EnterpriseView, ListEnterprisesDto, UpdateEnterpriseDto } from './dto/enterprise.dto';

export interface Ctx extends RequestMeta {
  actor: AuthenticatedUser;
}

@Injectable()
export class EnterpriseService {
  constructor(
    private readonly repo: EnterpriseRepository,
    private readonly audit: AuditService,
  ) {}

  list(query: ListEnterprisesDto, actor: AuthenticatedUser): Promise<CursorPage<EnterpriseView>> {
    return this.repo.list(query, actor.scope);
  }

  async get(enterprise_id: string, actor: AuthenticatedUser): Promise<EnterpriseView> {
    const row = await this.repo.findById(enterprise_id);
    if (!row) throw AppException.notFound('doanh nghiệp', enterprise_id);
    assertInScope('doanh nghiệp', enterprise_id, enterprise_id, actor);
    return row;
  }

  async branches(enterprise_id: string, actor: AuthenticatedUser): Promise<EnterpriseView[]> {
    await this.get(enterprise_id, actor);
    return this.repo.branches(enterprise_id);
  }

  async create(dto: CreateEnterpriseDto, ctx: Ctx): Promise<EnterpriseView> {
    assertSystemAdmin(ctx.actor, 'tạo được doanh nghiệp');
    if (dto.parent_id) {
      const parent = await this.repo.findRaw(dto.parent_id);
      if (!parent) throw AppException.invalidPayload('Doanh nghiệp cha không tồn tại', { violations: ['parent_id không tồn tại'] });
      // Tối đa 2 cấp: chi nhánh không được có chi nhánh.
      if (parent.parent_id) {
        throw AppException.unprocessable(ErrorCode.INVALID_PAYLOAD, 'Chi nhánh không thể có chi nhánh con — tối đa 2 cấp', {
          parent_id: dto.parent_id,
          parent_of_parent_id: parent.parent_id,
        });
      }
    }
    let id: string;
    try {
      id = (await this.repo.create(dto)).enterprise_id;
    } catch (error) {
      if (uniqueViolation(error) === 'enterprises_code_key') {
        throw AppException.conflict(ErrorCode.ENTERPRISE_CODE_CONFLICT, 'Mã doanh nghiệp đã tồn tại', { code: dto.code });
      }
      throw error;
    }
    await this.audit.record({ module: 'enterprise', action: 'ENTERPRISE_CREATE', resource_type: 'enterprise', resource_id: id, enterprise_id: id, actor: actorOf(ctx), new_values: { ...dto }, ...meta(ctx) });
    return this.get(id, ctx.actor);
  }

  async update(enterprise_id: string, dto: UpdateEnterpriseDto, ctx: Ctx): Promise<EnterpriseView> {
    const before = await this.get(enterprise_id, ctx.actor);
    // DN admin sửa được hồ sơ DN mình, nhưng không nới `max_users` — đó là hạn mức nhà cung cấp đặt.
    if (ctx.actor.scope !== null && dto.max_users !== undefined && dto.max_users !== before.max_users) {
      throw AppException.authorizationFailed('Chỉ quản trị hệ thống mới đổi được max_users', { field: 'max_users' });
    }
    await this.repo.update(enterprise_id, dto);
    await this.audit.record({ module: 'enterprise', action: 'ENTERPRISE_UPDATE', resource_type: 'enterprise', resource_id: enterprise_id, enterprise_id, actor: actorOf(ctx), old_values: pick(before, Object.keys(dto)), new_values: { ...dto }, ...meta(ctx) });
    return this.get(enterprise_id, ctx.actor);
  }

  async changeStatus(enterprise_id: string, dto: ChangeEnterpriseStatusDto, ctx: Ctx): Promise<EnterpriseView> {
    assertSystemAdmin(ctx.actor, 'đổi được trạng thái doanh nghiệp');
    const before = await this.get(enterprise_id, ctx.actor);
    if (before.status !== dto.status) {
      const affected = await this.repo.setStatusWithBranches(enterprise_id, dto.status);
      await this.audit.record({ module: 'enterprise', action: dto.status === 'SUSPENDED' ? 'ENTERPRISE_SUSPEND' : 'ENTERPRISE_ACTIVATE', resource_type: 'enterprise', resource_id: enterprise_id, enterprise_id, actor: actorOf(ctx), old_values: { status: before.status }, new_values: { status: dto.status, reason: dto.reason ?? null, affected_including_branches: affected }, ...meta(ctx) });
    }
    return this.get(enterprise_id, ctx.actor);
  }

  async delete(enterprise_id: string, ctx: Ctx): Promise<void> {
    assertSystemAdmin(ctx.actor, 'xoá được doanh nghiệp');
    const before = await this.get(enterprise_id, ctx.actor);
    if (before.device_count > 0 || before.branch_count > 0 || before.user_count > 0) {
      throw AppException.unprocessable(ErrorCode.INVALID_PAYLOAD, 'Doanh nghiệp còn thiết bị, người dùng hoặc chi nhánh — thu hồi / xoá trước', {
        device_count: before.device_count,
        user_count: before.user_count,
        branch_count: before.branch_count,
      });
    }
    try {
      await this.repo.delete(enterprise_id);
    } catch (error) {
      // Còn bản ghi lịch sử (bảo hành, phân bổ, audit) trỏ tới → không xoá được; đình chỉ thay vì xoá.
      if (foreignKeyViolation(error)) {
        throw AppException.unprocessable(ErrorCode.INVALID_PAYLOAD, 'Doanh nghiệp còn lịch sử liên quan, không xoá được — dùng SUSPENDED', { constraint: foreignKeyViolation(error) });
      }
      throw error;
    }
    await this.audit.record({ module: 'enterprise', action: 'ENTERPRISE_DELETE', resource_type: 'enterprise', resource_id: enterprise_id, enterprise_id, actor: actorOf(ctx), old_values: { code: before.code, name: before.name }, ...meta(ctx) });
  }
}

export const actorOf = (ctx: Ctx) => ({ user_id: ctx.actor.user_id, username: ctx.actor.username });
export const meta = (ctx: Ctx) => ({ request_id: ctx.request_id, ip: ctx.ip, user_agent: ctx.user_agent });
export const pick = (obj: object, keys: string[]) => Object.fromEntries(keys.map((k) => [k, (obj as Record<string, unknown>)[k]]));
