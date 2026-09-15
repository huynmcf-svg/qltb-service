import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { assertInScope, assertSystemAdmin, inScope } from '../../common/auth/scope';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { AppException } from '../../common/errors/app.exception';
import { foreignKeyViolation, uniqueViolation } from '../../common/errors/db-error';
import { ErrorCode } from '../../common/errors/error-code';
import { AppLogger } from '../../common/logger/app-logger.service';
import type { DeviceStatus } from '../../db/schema';
import { AUDIT_ACTIONS, AuditService } from '../audit/audit.service';
import { EnterpriseRepository } from '../enterprise/enterprise.repository';
import { actorOf, meta, pick, type Ctx } from '../enterprise/enterprise.service';
import { QuotaRepository } from '../quota/quota.repository';
import { QuotaService } from '../quota/quota.service';
import { WarrantyRepository } from '../warranty/warranty.repository';
import { nextStatus, transitionHint, type DeviceAction } from './device-state';
import { DeviceRepository } from './device.repository';
import type { AssignDeviceDto, ChangeDeviceStatusDto, CreateDeviceDto, DeviceDetailView, DeviceView, ListDevicesDto, UnassignDeviceDto, UpdateDeviceDto } from './dto/device.dto';

/** Ngữ cảnh của một thao tác — actor từ token, meta từ request. */
export type ActionContext = Ctx;

/**
 * Nghiệp vụ thiết bị. Mọi đường đổi `status` đi qua `device-state.ts` +
 * `repo.transition()` (kiểm `from` ở WHERE) — không có đường tắt.
 */
@Injectable()
export class DeviceService {
  constructor(
    private readonly repo: DeviceRepository,
    private readonly enterprises: EnterpriseRepository,
    private readonly warranties: WarrantyRepository,
    private readonly quotas: QuotaRepository,
    private readonly quotaService: QuotaService,
    private readonly audit: AuditService,
    private readonly logger: AppLogger,
  ) {}

  list(query: ListDevicesDto, actor: AuthenticatedUser): Promise<CursorPage<DeviceView>> {
    return this.repo.list(query, actor.scope);
  }

  /** Ngoài phạm vi → 404 (không 403), để không xác nhận id đó tồn tại. */
  async get(device_id: string, actor: AuthenticatedUser): Promise<DeviceDetailView> {
    const device = await this.repo.findDetailById(device_id);
    if (!device || !inScope(device.enterprise_id, actor.scope)) throw AppException.notFound('thiết bị', device_id);
    return device;
  }

  async create(dto: CreateDeviceDto, ctx: ActionContext): Promise<DeviceDetailView> {
    assertSystemAdmin(ctx.actor, 'nhập được thiết bị vào kho');
    let device_id: string;
    try {
      device_id = (await this.repo.create({ ...dto, status: 'IN_STOCK' })).device_id;
    } catch (error) {
      // Cứ INSERT rồi bắt 23505 — không SELECT trước, hai request song song lọt cả hai.
      if (uniqueViolation(error) === 'devices_serial_number_key') {
        throw AppException.conflict(ErrorCode.DEVICE_SERIAL_CONFLICT, 'Serial thiết bị đã tồn tại', { serial_number: dto.serial_number });
      }
      throw error;
    }
    this.logger.info('device registered', { request_id: ctx.request_id, user_id: ctx.actor.user_id, device_id, serial_number: dto.serial_number });
    await this.audit.record({ module: 'device', action: AUDIT_ACTIONS.DEVICE_CREATE, resource_type: 'device', resource_id: device_id, actor: actorOf(ctx), new_values: { ...dto, status: 'IN_STOCK' }, ...meta(ctx) });
    return this.get(device_id, ctx.actor);
  }

  async update(device_id: string, dto: UpdateDeviceDto, ctx: ActionContext): Promise<DeviceDetailView> {
    const before = await this.get(device_id, ctx.actor);
    await this.repo.update(device_id, dto);
    await this.audit.record({ module: 'device', action: AUDIT_ACTIONS.DEVICE_UPDATE, resource_type: 'device', resource_id: device_id, enterprise_id: before.enterprise_id, actor: actorOf(ctx), old_values: pick(before, Object.keys(dto)), new_values: { ...dto }, ...meta(ctx) });
    return this.get(device_id, ctx.actor);
  }

  /**
   * Gán cho doanh nghiệp: `IN_STOCK → ACTIVE`, ghi ngày bán, tạo bảo hành
   * (`source = SALE`), cấp API key cho thiết bị (hiện MỘT lần). Một transaction.
   */
  async assign(device_id: string, dto: AssignDeviceDto, ctx: ActionContext): Promise<DeviceDetailView & { api_key: string }> {
    assertSystemAdmin(ctx.actor, 'gán được thiết bị');
    const before = await this.get(device_id, ctx.actor);
    this.assertTransition(before.status, 'ASSIGN');
    const enterprise = await this.enterprises.findRaw(dto.enterprise_id);
    if (!enterprise) throw AppException.invalidPayload('Doanh nghiệp không tồn tại', { violations: ['enterprise_id không tồn tại'] });
    if (enterprise.status !== 'ACTIVE') throw AppException.unprocessable(ErrorCode.INVALID_PAYLOAD, 'Doanh nghiệp đang bị đình chỉ', { enterprise_status: enterprise.status });

    const sold_at = dto.sold_at ?? new Date().toISOString().slice(0, 10);
    const months = dto.warranty_months ?? 12;
    const apiKey = newApiKey();
    await this.repo.conn.transaction(async (tx) => {
      const row = await this.repo.transitionTx(device_id, 'IN_STOCK', { status: 'ACTIVE', enterprise_id: dto.enterprise_id, sold_at, assigned_at: new Date(), api_key_hash: apiKey.hash }, tx);
      if (!row) throw AppException.conflict(ErrorCode.DEVICE_STATE_CONFLICT, 'Trạng thái thiết bị vừa thay đổi', { attempted_action: 'ASSIGN' });
      if (months > 0) {
        await this.warranties.create({ device_id, enterprise_id: dto.enterprise_id, start_date: sold_at, end_date: addMonths(sold_at, months), source: 'SALE', notes: dto.note, created_by: ctx.actor.user_id }, tx);
      }
    });
    await this.audit.record({ module: 'device', action: 'DEVICE_ASSIGN', resource_type: 'device', resource_id: device_id, enterprise_id: dto.enterprise_id, actor: actorOf(ctx), old_values: { status: 'IN_STOCK', enterprise_id: null }, new_values: { status: 'ACTIVE', enterprise_id: dto.enterprise_id, sold_at, warranty_months: months }, ...meta(ctx) });
    return { ...(await this.get(device_id, ctx.actor)), api_key: apiKey.plain };
  }

  /** Thu hồi: `ACTIVE | LOCKED → IN_STOCK`, xoá DN, thu hồi API key, bảo hành ACTIVE → VOID. */
  async unassign(device_id: string, dto: UnassignDeviceDto, ctx: ActionContext): Promise<DeviceDetailView> {
    assertSystemAdmin(ctx.actor, 'thu hồi được thiết bị');
    const before = await this.get(device_id, ctx.actor);
    this.assertTransition(before.status, 'UNASSIGN');
    await this.repo.conn.transaction(async (tx) => {
      const row = await this.repo.transitionTx(device_id, before.status, { status: 'IN_STOCK', enterprise_id: null, assigned_at: null, api_key_hash: null }, tx);
      if (!row) throw AppException.conflict(ErrorCode.DEVICE_STATE_CONFLICT, 'Trạng thái thiết bị vừa thay đổi', { attempted_action: 'UNASSIGN' });
      await this.warranties.setStatusOfActive(device_id, 'VOID', tx);
      // Máy về kho thì cờ khoá không còn ý nghĩa; sản lượng còn lại giữ nguyên trên máy.
      await this.quotas.update(device_id, { is_locked: false, locked_reason: null, locked_at: null }, tx);
    });
    await this.audit.record({ module: 'device', action: 'DEVICE_UNASSIGN', resource_type: 'device', resource_id: device_id, enterprise_id: before.enterprise_id, actor: actorOf(ctx), old_values: { status: before.status, enterprise_id: before.enterprise_id }, new_values: { status: 'IN_STOCK', enterprise_id: null, reason: dto.reason }, ...meta(ctx) });
    return this.get(device_id, ctx.actor);
  }

  /** Đổi trạng thái tay: LOCK / UNLOCK (uỷ cho quota) hoặc RETIRE từ kho. */
  async changeStatus(device_id: string, dto: ChangeDeviceStatusDto, ctx: ActionContext): Promise<DeviceDetailView> {
    const before = await this.get(device_id, ctx.actor);
    if (dto.status === 'RETIRED') {
      assertSystemAdmin(ctx.actor, 'thanh lý được thiết bị');
      this.assertTransition(before.status, 'RETIRE');
      const row = await this.repo.transition(device_id, 'IN_STOCK', { status: 'RETIRED', api_key_hash: null });
      if (!row) throw AppException.conflict(ErrorCode.DEVICE_STATE_CONFLICT, 'Trạng thái thiết bị vừa thay đổi', { attempted_action: 'RETIRE' });
      await this.audit.record({ module: 'device', action: 'DEVICE_RETIRE', resource_type: 'device', resource_id: device_id, actor: actorOf(ctx), old_values: { status: before.status }, new_values: { status: 'RETIRED', reason: dto.reason }, ...meta(ctx) });
    } else if (dto.status === 'LOCKED') {
      await this.quotaService.transitionLock(device_id, before.status, 'LOCKED', 'MANUAL', ctx, dto.reason);
    } else {
      if (before.quota.quota_remaining <= 0) throw AppException.unprocessable(ErrorCode.QUOTA_INSUFFICIENT, 'Sản lượng còn 0 — cấp thêm trước khi mở khoá', { remaining: 0, requested: 1 });
      await this.quotaService.transitionLock(device_id, before.status, 'ACTIVE', null, ctx, dto.reason);
    }
    return this.get(device_id, ctx.actor);
  }

  /** Cấp lại API key cho máy đang gán. Key cũ chết ngay. */
  async rotateApiKey(device_id: string, ctx: ActionContext): Promise<{ api_key: string }> {
    assertSystemAdmin(ctx.actor, 'cấp lại được API key');
    const before = await this.get(device_id, ctx.actor);
    if (before.status !== 'ACTIVE' && before.status !== 'LOCKED') {
      throw AppException.conflict(ErrorCode.DEVICE_STATE_CONFLICT, 'Chỉ cấp API key cho máy đang gán', { current_status: before.status, attempted_action: 'ROTATE_API_KEY' });
    }
    const key = newApiKey();
    await this.repo.update(device_id, { api_key_hash: key.hash });
    await this.audit.record({ module: 'device', action: 'DEVICE_ROTATE_API_KEY', resource_type: 'device', resource_id: device_id, enterprise_id: before.enterprise_id, actor: actorOf(ctx), ...meta(ctx) });
    return { api_key: key.plain };
  }

  /** Xác thực thiết bị bằng `X-Device-Key`. Trả device_id hoặc null. */
  async authenticateDevice(apiKey: string): Promise<string | null> {
    const row = await this.repo.findByApiKeyHash(hashApiKey(apiKey));
    return row?.device_id ?? null;
  }

  async delete(device_id: string, ctx: ActionContext): Promise<void> {
    assertSystemAdmin(ctx.actor, 'xoá được thiết bị');
    const before = await this.get(device_id, ctx.actor);
    if (before.status !== 'IN_STOCK') throw AppException.unprocessable(ErrorCode.DEVICE_STATE_CONFLICT, 'Chỉ xoá được máy trong kho — dùng thanh lý (RETIRED) cho máy đã dùng', { current_status: before.status });
    if (await this.quotas.hasHistory(device_id)) throw AppException.unprocessable(ErrorCode.INVALID_PAYLOAD, 'Máy đã có lịch sử sản lượng, không xoá được — dùng thanh lý', {});
    try {
      await this.repo.hardDelete(device_id);
    } catch (error) {
      if (foreignKeyViolation(error)) throw AppException.unprocessable(ErrorCode.INVALID_PAYLOAD, 'Máy còn lịch sử liên quan, không xoá được — dùng thanh lý', { constraint: foreignKeyViolation(error) });
      throw error;
    }
    await this.audit.record({ module: 'device', action: 'DEVICE_DELETE', resource_type: 'device', resource_id: device_id, actor: actorOf(ctx), old_values: { serial_number: before.serial_number }, ...meta(ctx) });
  }

  private assertTransition(current: DeviceStatus, action: DeviceAction): void {
    if (!nextStatus(current, action)) {
      throw AppException.conflict(ErrorCode.DEVICE_STATE_CONFLICT, transitionHint(current, action), { current_status: current, attempted_action: action });
    }
  }
}

function newApiKey(): { plain: string; hash: string } {
  const plain = `qltbk_${randomBytes(24).toString('base64url')}`;
  return { plain, hash: hashApiKey(plain) };
}

export function hashApiKey(plain: string): string {
  return createHash('sha256').update(plain, 'utf8').digest('hex');
}

/** Cộng tháng vào YYYY-MM-DD, giữ ngày; cuối tháng thì kẹp về ngày cuối. */
export function addMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}
