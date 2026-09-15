import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { assertSystemAdmin, inScope } from '../../common/auth/scope';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { AppException } from '../../common/errors/app.exception';
import { uniqueViolation } from '../../common/errors/db-error';
import { ErrorCode } from '../../common/errors/error-code';
import { devices } from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { DeviceRepository } from '../device/device.repository';
import { hashApiKey } from '../device/device.service';
import { actorOf, meta, type Ctx } from '../enterprise/enterprise.service';
import { QuotaRepository } from '../quota/quota.repository';
import { WarrantyRepository } from '../warranty/warranty.repository';
import type { ApproveExchangeDto, CreateExchangeDto, ExchangeView, ListExchangesDto, RejectExchangeDto, UpdateExchangeDto } from './dto/exchange.dto';
import { ExchangeRepository } from './exchange.repository';

@Injectable()
export class ExchangeService {
  constructor(
    private readonly repo: ExchangeRepository,
    private readonly devices: DeviceRepository,
    private readonly warranties: WarrantyRepository,
    private readonly quotas: QuotaRepository,
    private readonly audit: AuditService,
  ) {}

  list(query: ListExchangesDto, actor: AuthenticatedUser): Promise<CursorPage<ExchangeView>> {
    return this.repo.list(query, actor.scope);
  }

  async get(exchange_id: string, actor: AuthenticatedUser): Promise<ExchangeView> {
    const x = await this.repo.findById(exchange_id);
    if (!x || !inScope(x.enterprise_id, actor.scope)) throw AppException.notFound('yêu cầu đổi trả', exchange_id);
    return x;
  }

  /** Máy cũ phải đang gán (ACTIVE / LOCKED) và trong phạm vi người tạo. Một PENDING mỗi máy. */
  async create(dto: CreateExchangeDto, ctx: Ctx): Promise<ExchangeView> {
    const device = await this.devices.findRaw(dto.old_device_id);
    if (!device || !inScope(device.enterprise_id, ctx.actor.scope)) throw AppException.notFound('thiết bị', dto.old_device_id);
    if (device.status !== 'ACTIVE' && device.status !== 'LOCKED') {
      throw AppException.conflict(ErrorCode.DEVICE_STATE_CONFLICT, 'Chỉ đổi trả máy đang gán cho doanh nghiệp', { current_status: device.status, attempted_action: 'EXCHANGE_REQUEST' });
    }
    let row;
    try {
      row = await this.repo.create({ enterprise_id: device.enterprise_id!, old_device_id: dto.old_device_id, reason: dto.reason, requested_by: ctx.actor.user_id });
    } catch (error) {
      if (uniqueViolation(error) === 'device_exchanges_one_pending_per_device') {
        throw AppException.conflict(ErrorCode.EXCHANGE_STATE_CONFLICT, 'Máy này đã có yêu cầu đổi trả đang chờ duyệt', { old_device_id: dto.old_device_id });
      }
      throw error;
    }
    await this.audit.record({ module: 'exchange', action: 'EXCHANGE_REQUEST', resource_type: 'device_exchange', resource_id: row.exchange_id, enterprise_id: device.enterprise_id, actor: actorOf(ctx), new_values: { ...dto }, ...meta(ctx) });
    return this.get(row.exchange_id, ctx.actor);
  }

  async update(exchange_id: string, dto: UpdateExchangeDto, ctx: Ctx): Promise<ExchangeView> {
    const before = await this.get(exchange_id, ctx.actor);
    this.assertPending(before);
    const row = await this.repo.updateIfStatus(exchange_id, 'PENDING', dto);
    if (!row) throw this.stateConflict(before);
    await this.audit.record({ module: 'exchange', action: 'EXCHANGE_UPDATE', resource_type: 'device_exchange', resource_id: exchange_id, enterprise_id: before.enterprise_id, actor: actorOf(ctx), old_values: { reason: before.reason, notes: before.notes }, new_values: { ...dto }, ...meta(ctx) });
    return this.get(exchange_id, ctx.actor);
  }

  /**
   * Duyệt — một transaction:
   *   máy mới `IN_STOCK → ACTIVE` với DN, ngày bán = hôm nay, API key mới;
   *   máy cũ → `EXCHANGED`, thu hồi key;
   *   bảo hành ACTIVE của máy cũ → `TRANSFERRED`, tạo bảo hành mới cùng `end_date` (`source = EXCHANGE`);
   *   sản lượng còn lại chuyển sang máy mới: ghi `usage_logs` (meta EXCHANGE_TRANSFER) cho máy cũ
   *   và `quota_grants` cho máy mới — lịch sử append-only nên "chuyển" là hai dòng đối ứng.
   */
  async approve(exchange_id: string, dto: ApproveExchangeDto, ctx: Ctx): Promise<ExchangeView & { api_key: string | null }> {
    assertSystemAdmin(ctx.actor, 'duyệt được đổi trả');
    const before = await this.get(exchange_id, ctx.actor);
    this.assertPending(before);
    const newDevice = await this.devices.findRaw(dto.new_device_id);
    if (!newDevice) throw AppException.invalidPayload('Máy mới không tồn tại', { violations: ['new_device_id không tồn tại'] });
    if (newDevice.status !== 'IN_STOCK') throw AppException.conflict(ErrorCode.DEVICE_STATE_CONFLICT, 'Máy mới phải đang trong kho', { current_status: newDevice.status, attempted_action: 'EXCHANGE_APPROVE' });
    if (newDevice.device_id === before.old_device_id) throw AppException.invalidPayload('Máy mới phải khác máy cũ');

    const apiKey = `qltbk_${randomBytes(24).toString('base64url')}`;
    const today = new Date().toISOString().slice(0, 10);
    let transferred = 0;

    await this.repo.conn.transaction(async (tx) => {
      const x = await this.repo.updateIfStatus(exchange_id, 'PENDING', { status: 'APPROVED', new_device_id: dto.new_device_id, approved_by: ctx.actor.user_id, approved_at: new Date(), notes: dto.note ?? before.notes }, tx);
      if (!x) throw this.stateConflict(before);

      const oldRow = await this.devices.transitionTx(before.old_device_id, (await tx.select({ s: devices.status }).from(devices).where(eq(devices.device_id, before.old_device_id)).limit(1))[0]!.s as 'ACTIVE' | 'LOCKED', { status: 'EXCHANGED', api_key_hash: null }, tx);
      if (!oldRow) throw AppException.conflict(ErrorCode.DEVICE_STATE_CONFLICT, 'Máy cũ vừa đổi trạng thái', { attempted_action: 'EXCHANGE_APPROVE' });
      const newRow = await this.devices.transitionTx(dto.new_device_id, 'IN_STOCK', { status: 'ACTIVE', enterprise_id: before.enterprise_id, sold_at: today, assigned_at: new Date(), api_key_hash: hashApiKey(apiKey) }, tx);
      if (!newRow) throw AppException.conflict(ErrorCode.DEVICE_STATE_CONFLICT, 'Máy mới vừa đổi trạng thái', { attempted_action: 'EXCHANGE_APPROVE' });

      // Bảo hành: chuyển sang máy mới, giữ nguyên hạn.
      const w = await this.warranties.setStatusOfActive(before.old_device_id, 'TRANSFERRED', tx);
      if (w) {
        await this.warranties.create({ device_id: dto.new_device_id, enterprise_id: before.enterprise_id, start_date: today > w.start_date ? w.start_date : today, end_date: w.end_date, source: 'EXCHANGE', transferred_from_id: w.warranty_id, notes: `Chuyển từ máy ${before.old_serial_number}`, created_by: ctx.actor.user_id }, tx);
      }

      // Sản lượng còn lại: hai dòng đối ứng, projection cả hai máy cập nhật trong cùng tx.
      const oldQ = await this.quotas.lockRow(before.old_device_id, tx);
      await this.quotas.lockRow(dto.new_device_id, tx);
      transferred = oldQ?.quota_remaining ?? 0;
      if (transferred > 0) {
        await this.quotas.addUsed(before.old_device_id, transferred, tx);
        await this.quotas.insertUsage({ device_id: before.old_device_id, client_ref: `exchange:${exchange_id}`, amount: transferred, used_at: new Date(), rejected: false, remaining_after: 0, meta: { type: 'EXCHANGE_TRANSFER', to_device_id: dto.new_device_id }, request_id: ctx.request_id }, tx);
        const after = await this.quotas.addTotal(dto.new_device_id, transferred, tx);
        await this.quotas.insertGrant({ device_id: dto.new_device_id, amount: transferred, total_after: after.quota_total, granted_by: ctx.actor.user_id, note: `Chuyển từ máy ${before.old_serial_number} (đổi trả)`, request_id: ctx.request_id }, tx);
      }
      if (oldQ) {
        await this.quotas.update(dto.new_device_id, { warn_threshold_pct: oldQ.warn_threshold_pct, package_start_at: oldQ.package_start_at, package_end_at: oldQ.package_end_at }, tx);
        await this.quotas.update(before.old_device_id, { is_locked: true, locked_reason: 'MANUAL', locked_at: new Date() }, tx);
      }
    });

    await this.audit.record({ module: 'exchange', action: 'EXCHANGE_APPROVE', resource_type: 'device_exchange', resource_id: exchange_id, enterprise_id: before.enterprise_id, actor: actorOf(ctx), old_values: { status: 'PENDING' }, new_values: { status: 'APPROVED', new_device_id: dto.new_device_id, quota_transferred: transferred }, ...meta(ctx) });
    return { ...(await this.get(exchange_id, ctx.actor)), api_key: apiKey };
  }

  async reject(exchange_id: string, dto: RejectExchangeDto, ctx: Ctx): Promise<ExchangeView> {
    assertSystemAdmin(ctx.actor, 'từ chối được đổi trả');
    const before = await this.get(exchange_id, ctx.actor);
    this.assertPending(before);
    const row = await this.repo.updateIfStatus(exchange_id, 'PENDING', { status: 'REJECTED', reject_reason: dto.reject_reason, approved_by: ctx.actor.user_id, approved_at: new Date() });
    if (!row) throw this.stateConflict(before);
    await this.audit.record({ module: 'exchange', action: 'EXCHANGE_REJECT', resource_type: 'device_exchange', resource_id: exchange_id, enterprise_id: before.enterprise_id, actor: actorOf(ctx), old_values: { status: 'PENDING' }, new_values: { status: 'REJECTED', reject_reason: dto.reject_reason }, ...meta(ctx) });
    return this.get(exchange_id, ctx.actor);
  }

  /** Chỉ khi PENDING, chỉ người tạo hoặc admin hệ thống. */
  async delete(exchange_id: string, ctx: Ctx): Promise<void> {
    const before = await this.get(exchange_id, ctx.actor);
    this.assertPending(before);
    if (ctx.actor.scope !== null && before.requested_by !== ctx.actor.user_id) {
      throw AppException.authorizationFailed('Chỉ người tạo yêu cầu mới xoá được', { requested_by: before.requested_by });
    }
    if (!(await this.repo.deleteIfPending(exchange_id))) throw this.stateConflict(before);
    await this.audit.record({ module: 'exchange', action: 'EXCHANGE_DELETE', resource_type: 'device_exchange', resource_id: exchange_id, enterprise_id: before.enterprise_id, actor: actorOf(ctx), old_values: { reason: before.reason, old_device_id: before.old_device_id }, ...meta(ctx) });
  }

  private assertPending(x: ExchangeView): void {
    if (x.status !== 'PENDING') throw this.stateConflict(x);
  }

  private stateConflict(x: ExchangeView) {
    return AppException.conflict(ErrorCode.EXCHANGE_STATE_CONFLICT, 'Yêu cầu đổi trả không còn ở trạng thái chờ duyệt', { current_status: x.status });
  }
}
