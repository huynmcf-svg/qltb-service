import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { assertInScope, assertSystemAdmin, inScope } from '../../common/auth/scope';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-code';
import { AppLogger } from '../../common/logger/app-logger.service';
import { devices, enterprises } from '../../db/schema';
import { AlertEmitter } from '../alert/alert-emitter.service';
import { AuditService } from '../audit/audit.service';
import { DeviceRepository } from '../device/device.repository';
import { actorOf, meta, type Ctx } from '../enterprise/enterprise.service';
import type { AllocateQuotaDto, GrantQuotaDto, ListAllocationsDto, ListQuotasDto, ListUsageDto, LockQuotaDto, QuotaAllocationView, QuotaGrantView, RecordUsageDto, UpdateQuotaDto, UsageLogView } from './dto/quota.dto';
import { QuotaRepository, toUsageView, type QuotaFullView, type QuotaRow, type Tx } from './quota.repository';

/**
 * Sản lượng. Mọi thay đổi: MỘT transaction ghi lịch sử (append-only) + cập
 * nhật projection `device_quotas`, khoá dòng `FOR UPDATE` để hai lượt song
 * song không cùng trừ. Bất biến `remaining = total − used ≥ 0` do CHECK ở DB
 * bảo vệ lớp cuối.
 */
@Injectable()
export class QuotaService {
  constructor(
    private readonly repo: QuotaRepository,
    private readonly devices: DeviceRepository,
    private readonly alerts: AlertEmitter,
    private readonly audit: AuditService,
    private readonly logger: AppLogger,
  ) {}

  list(query: ListQuotasDto, actor: AuthenticatedUser): Promise<CursorPage<QuotaFullView>> {
    return this.repo.list(query, actor.scope);
  }

  async get(device_id: string, actor: AuthenticatedUser): Promise<QuotaFullView> {
    const q = await this.repo.findFull(device_id);
    if (!q || !inScope(q.enterprise_id, actor.scope)) throw AppException.notFound('thiết bị', device_id);
    return q;
  }

  async update(device_id: string, dto: UpdateQuotaDto, ctx: Ctx): Promise<QuotaFullView> {
    assertSystemAdmin(ctx.actor, 'sửa được ngưỡng / thời gian gói');
    const before = await this.get(device_id, ctx.actor);
    const start = dto.package_start_at !== undefined ? new Date(dto.package_start_at) : undefined;
    const end = dto.package_end_at !== undefined ? new Date(dto.package_end_at) : undefined;
    const s = start ?? (before.package_start_at ? new Date(before.package_start_at) : null);
    const e = end ?? (before.package_end_at ? new Date(before.package_end_at) : null);
    if (s && e && e <= s) throw AppException.invalidPayload('package_end_at phải sau package_start_at', { violations: ['package_end_at <= package_start_at'] });
    await this.repo.update(device_id, { warn_threshold_pct: dto.warn_threshold_pct, package_start_at: start, package_end_at: end });
    await this.audit.record({ module: 'quota', action: 'QUOTA_UPDATE', resource_type: 'device', resource_id: device_id, enterprise_id: before.enterprise_id, actor: actorOf(ctx), old_values: { warn_threshold_pct: before.warn_threshold_pct, package_start_at: before.package_start_at, package_end_at: before.package_end_at }, new_values: { ...dto }, ...meta(ctx) });
    return this.get(device_id, ctx.actor);
  }

  /** Cấp sản lượng: + tổng, ghi `quota_grants`, tự mở khoá nếu đang khoá vì hết. */
  async grant(device_id: string, dto: GrantQuotaDto, ctx: Ctx): Promise<QuotaFullView> {
    assertSystemAdmin(ctx.actor, 'cấp được sản lượng');
    const before = await this.get(device_id, ctx.actor);
    if (before.device_status === 'EXCHANGED' || before.device_status === 'RETIRED') {
      throw AppException.conflict(ErrorCode.DEVICE_STATE_CONFLICT, 'Thiết bị đã kết thúc vòng đời', { current_status: before.device_status, attempted_action: 'GRANT' });
    }
    await this.repo.conn.transaction(async (tx) => {
      await this.repo.lockRow(device_id, tx);
      const after = await this.repo.addTotal(device_id, dto.amount, tx);
      await this.repo.insertGrant({ device_id, amount: dto.amount, total_after: after.quota_total, granted_by: ctx.actor.user_id, note: dto.note, request_id: ctx.request_id }, tx);
      await this.maybeUnlockAfterTopUp(after, tx);
    });
    await this.alerts.resolve(device_id, ['QUOTA_BELOW_20', 'QUOTA_BELOW_10', 'QUOTA_EXHAUSTED']);
    await this.audit.record({ module: 'quota', action: 'QUOTA_GRANT', resource_type: 'device', resource_id: device_id, enterprise_id: before.enterprise_id, actor: actorOf(ctx), old_values: { quota_total: before.quota_total }, new_values: { amount: dto.amount, note: dto.note ?? null }, ...meta(ctx) });
    return this.get(device_id, ctx.actor);
  }

  listGrants(device_id: string, query: { limit?: number; cursor?: string }, actor: AuthenticatedUser): Promise<CursorPage<QuotaGrantView>> {
    return this.get(device_id, actor).then(() => this.repo.listGrants(device_id, query));
  }

  async lock(device_id: string, dto: LockQuotaDto, ctx: Ctx): Promise<QuotaFullView> {
    const before = await this.get(device_id, ctx.actor);
    await this.transitionLock(device_id, before.device_status, 'LOCKED', 'MANUAL', ctx, dto.reason);
    return this.get(device_id, ctx.actor);
  }

  async unlock(device_id: string, ctx: Ctx): Promise<QuotaFullView> {
    const before = await this.get(device_id, ctx.actor);
    if (before.quota_remaining <= 0) throw AppException.unprocessable(ErrorCode.QUOTA_INSUFFICIENT, 'Sản lượng còn 0 — cấp thêm trước khi mở khoá', { remaining: 0, requested: 1 });
    if (before.package_end_at && new Date(before.package_end_at) < new Date()) {
      throw AppException.unprocessable(ErrorCode.QUOTA_INSUFFICIENT, 'Gói đã hết hạn — gia hạn thời gian gói trước khi mở khoá', { package_end_at: before.package_end_at });
    }
    await this.transitionLock(device_id, before.device_status, 'ACTIVE', null, ctx, 'Mở khoá');
    return this.get(device_id, ctx.actor);
  }

  /** Dùng chung cho lock/unlock tay và PUT /devices/{id}/status. */
  async transitionLock(device_id: string, current: string, to: 'LOCKED' | 'ACTIVE', reason: 'MANUAL' | 'QUOTA_EXHAUSTED' | 'PACKAGE_EXPIRED' | null, ctx: Ctx, note: string): Promise<void> {
    const from = to === 'LOCKED' ? 'ACTIVE' : 'LOCKED';
    if (current !== from) {
      throw AppException.conflict(ErrorCode.DEVICE_STATE_CONFLICT, to === 'LOCKED' ? 'Chỉ khoá được thiết bị đang hoạt động' : 'Thiết bị không ở trạng thái khoá', { current_status: current, attempted_action: to === 'LOCKED' ? 'LOCK' : 'UNLOCK' });
    }
    await this.repo.conn.transaction(async (tx) => {
      const row = await this.devices.transitionTx(device_id, from, { status: to }, tx);
      if (!row) throw AppException.conflict(ErrorCode.DEVICE_STATE_CONFLICT, 'Trạng thái thiết bị vừa thay đổi', { attempted_action: to });
      await this.repo.update(device_id, { is_locked: to === 'LOCKED', locked_reason: reason, locked_at: to === 'LOCKED' ? new Date() : null }, tx);
    });
    await this.audit.record({ module: 'quota', action: to === 'LOCKED' ? 'DEVICE_LOCK' : 'DEVICE_UNLOCK', resource_type: 'device', resource_id: device_id, actor: actorOf(ctx), old_values: { status: from }, new_values: { status: to, reason: note }, ...meta(ctx) });
  }

  /**
   * Phân bổ cha → chi nhánh: trừ TỔNG của máy cha, cộng TỔNG máy chi nhánh.
   * (Đặc tả chỉ có quota theo máy, nên "quỹ" của DN cha chính là sản lượng
   * trên máy của cha — xem "Còn phải chốt".)
   */
  async allocate(dto: AllocateQuotaDto, ctx: Ctx): Promise<QuotaAllocationView> {
    if (dto.from_enterprise_id === dto.to_enterprise_id) throw AppException.invalidPayload('from và to phải khác nhau');
    assertInScope('doanh nghiệp', dto.from_enterprise_id, dto.from_enterprise_id, ctx.actor);
    const db = this.repo.conn;
    const [to] = await db.select().from(enterprises).where(eq(enterprises.enterprise_id, dto.to_enterprise_id)).limit(1);
    if (!to || to.parent_id !== dto.from_enterprise_id) throw AppException.invalidPayload('to_enterprise_id phải là chi nhánh trực thuộc from_enterprise_id', { violations: ['to_enterprise_id không phải chi nhánh của from_enterprise_id'] });
    const [fromDev] = await db.select().from(devices).where(eq(devices.device_id, dto.from_device_id)).limit(1);
    const [toDev] = await db.select().from(devices).where(eq(devices.device_id, dto.device_id)).limit(1);
    if (!fromDev || fromDev.enterprise_id !== dto.from_enterprise_id) throw AppException.invalidPayload('from_device_id không thuộc doanh nghiệp cha', { violations: ['from_device_id'] });
    if (!toDev || toDev.enterprise_id !== dto.to_enterprise_id) throw AppException.invalidPayload('device_id không thuộc chi nhánh nhận', { violations: ['device_id'] });

    let allocation_id = '';
    await db.transaction(async (tx) => {
      // Khoá theo thứ tự id cố định để hai phân bổ chéo nhau không deadlock.
      const [a, b] = [dto.from_device_id, dto.device_id].sort();
      await this.repo.lockRow(a!, tx);
      await this.repo.lockRow(b!, tx);
      const from = await this.repo.lockRow(dto.from_device_id, tx);
      if (!from || from.quota_remaining < dto.amount) {
        throw AppException.unprocessable(ErrorCode.QUOTA_INSUFFICIENT, 'Máy cho không đủ sản lượng còn lại', { remaining: from?.quota_remaining ?? 0, requested: dto.amount });
      }
      await this.repo.addTotal(dto.from_device_id, -dto.amount, tx);
      const after = await this.repo.addTotal(dto.device_id, dto.amount, tx);
      const row = await this.repo.insertAllocation({ ...dto, allocated_by: ctx.actor.user_id, request_id: ctx.request_id }, tx);
      allocation_id = row.allocation_id;
      await this.maybeUnlockAfterTopUp(after, tx);
    });
    await this.alerts.resolve(dto.device_id, ['QUOTA_BELOW_20', 'QUOTA_BELOW_10', 'QUOTA_EXHAUSTED']);
    await this.checkThresholds(dto.from_device_id);
    await this.audit.record({ module: 'quota', action: 'QUOTA_ALLOCATE', resource_type: 'quota_allocation', resource_id: allocation_id, enterprise_id: dto.to_enterprise_id, actor: actorOf(ctx), new_values: { ...dto }, ...meta(ctx) });
    const page = await this.repo.listAllocations({ device_id: dto.device_id, limit: 1 }, null);
    return page.items[0]!;
  }

  listAllocations(query: ListAllocationsDto, actor: AuthenticatedUser): Promise<CursorPage<QuotaAllocationView>> {
    return this.repo.listAllocations(query, actor.scope);
  }

  /**
   * Thiết bị ghi lượt dùng. Idempotent theo `(device_id, client_ref)`: trùng →
   * trả lại bản cũ (kể cả bản rejected). Máy khoá / không đủ → vẫn ghi dòng
   * `rejected = true` rồi 422 — để biết máy đã cố dùng.
   */
  async recordUsage(dto: RecordUsageDto, request_id: string): Promise<{ usage: UsageLogView; replayed: boolean }> {
    const device = await this.devices.findById(dto.device_id);
    if (!device) throw AppException.notFound('thiết bị', dto.device_id);
    const amount = dto.amount ?? 1;
    const existing = await this.repo.findUsageByRef(dto.device_id, dto.client_ref);
    if (existing) return { usage: toUsageView(existing, device.serial_number), replayed: true };

    let result: { row: ReturnType<typeof toUsageView>; error?: AppException; remaining?: QuotaRow } | null = null;
    await this.repo.conn.transaction(async (tx) => {
      const q = await this.repo.lockRow(dto.device_id, tx);
      if (!q) throw AppException.notFound('thiết bị', dto.device_id);
      const [dev] = await tx.select({ status: devices.status }).from(devices).where(eq(devices.device_id, dto.device_id)).limit(1);
      const base = { device_id: dto.device_id, client_ref: dto.client_ref, amount, used_at: new Date(dto.used_at), meta: dto.meta ?? {}, request_id };
      await tx.update(devices).set({ last_seen_at: new Date() }).where(eq(devices.device_id, dto.device_id));

      let error: AppException | undefined;
      let rejected = false;
      if (dev?.status !== 'ACTIVE' || q.is_locked) {
        rejected = true;
        error = AppException.unprocessable(ErrorCode.DEVICE_LOCKED, 'Thiết bị đang bị khoá', { status: dev?.status, locked_reason: q.locked_reason });
      } else if (q.quota_remaining < amount) {
        rejected = true;
        error = AppException.unprocessable(ErrorCode.QUOTA_INSUFFICIENT, 'Sản lượng còn lại không đủ', { remaining: q.quota_remaining, requested: amount });
      } else if (q.package_end_at && q.package_end_at < new Date()) {
        rejected = true;
        error = AppException.unprocessable(ErrorCode.DEVICE_LOCKED, 'Gói đã hết hạn', { package_end_at: q.package_end_at.toISOString() });
      }

      if (rejected) {
        const inserted = await this.repo.insertUsage({ ...base, rejected: true, remaining_after: null }, tx);
        // Trùng client_ref chen ngang giữa hai bước → coi như replay.
        result = { row: toUsageView(inserted ?? (await this.repo.findUsageByRef(dto.device_id, dto.client_ref))!, device.serial_number), error };
        return;
      }
      const after = await this.repo.addUsed(dto.device_id, amount, tx);
      const inserted = await this.repo.insertUsage({ ...base, rejected: false, remaining_after: after.quota_remaining }, tx);
      if (!inserted) {
        // Bị chen: hoàn lại phép trừ bằng cách rollback toàn transaction.
        throw new ReplayMarker();
      }
      if (after.quota_remaining === 0) {
        await tx.update(devices).set({ status: 'LOCKED' }).where(eq(devices.device_id, dto.device_id));
        await this.repo.update(dto.device_id, { is_locked: true, locked_reason: 'QUOTA_EXHAUSTED', locked_at: new Date() }, tx);
      }
      result = { row: toUsageView(inserted, device.serial_number), remaining: after };
    }).catch(async (error: unknown) => {
      if (error instanceof ReplayMarker) {
        const again = await this.repo.findUsageByRef(dto.device_id, dto.client_ref);
        result = { row: toUsageView(again!, device.serial_number) };
        return;
      }
      throw error;
    });

    const r = result as { row: UsageLogView; error?: AppException; remaining?: QuotaRow } | null;
    if (!r) throw new Error('recordUsage không có kết quả');
    if (r.remaining) await this.checkThresholds(dto.device_id, r.remaining);
    if (r.error) {
      this.logger.warn('usage rejected', { request_id, device_id: dto.device_id, client_ref: dto.client_ref, error_code: r.error.code });
      throw r.error;
    }
    return { usage: r.row, replayed: false };
  }

  listUsage(query: ListUsageDto, actor: AuthenticatedUser): Promise<CursorPage<UsageLogView>> {
    return this.repo.listUsage(query, actor.scope);
  }

  /** Cảnh báo ngưỡng sản lượng. Dedupe theo mốc cấp gần nhất (tổng hiện tại). */
  async checkThresholds(device_id: string, q?: QuotaRow): Promise<void> {
    const quota = q ?? (await this.repo.findRow(device_id));
    if (!quota || quota.quota_total <= 0) return;
    const [dev] = await this.repo.conn.select({ enterprise_id: devices.enterprise_id, serial: devices.serial_number }).from(devices).where(eq(devices.device_id, device_id)).limit(1);
    if (!dev) return;
    const pct = (quota.quota_remaining / quota.quota_total) * 100;
    const dedupe = `total:${quota.quota_total}`;
    const payload = { remaining: quota.quota_remaining, total: quota.quota_total, remaining_pct: Math.round(pct * 10) / 10 };
    const fmt = `${quota.quota_remaining.toLocaleString('vi-VN')} / ${quota.quota_total.toLocaleString('vi-VN')}`;
    if (quota.quota_remaining === 0) {
      await this.alerts.emit({ device_id, enterprise_id: dev.enterprise_id, type: 'QUOTA_EXHAUSTED', severity: 'CRITICAL', message: `Máy ${dev.serial} đã hết sản lượng (${fmt})`, payload, dedupe_key: dedupe });
    } else if (pct < 10) {
      await this.alerts.emit({ device_id, enterprise_id: dev.enterprise_id, type: 'QUOTA_BELOW_10', severity: 'WARNING', message: `Máy ${dev.serial} còn ${payload.remaining_pct} % sản lượng (${fmt})`, payload, dedupe_key: dedupe });
    } else if (pct < Math.max(20, quota.warn_threshold_pct)) {
      await this.alerts.emit({ device_id, enterprise_id: dev.enterprise_id, type: 'QUOTA_BELOW_20', severity: 'INFO', message: `Máy ${dev.serial} còn ${payload.remaining_pct} % sản lượng (${fmt})`, payload, dedupe_key: dedupe });
    }
  }

  /** Đang khoá vì hết sản lượng mà vừa được cấp thêm → mở lại. */
  private async maybeUnlockAfterTopUp(after: QuotaRow, tx: Tx): Promise<void> {
    if (after.is_locked && after.locked_reason === 'QUOTA_EXHAUSTED' && after.quota_remaining > 0) {
      await this.repo.update(after.device_id, { is_locked: false, locked_reason: null, locked_at: null }, tx);
      await this.devices.transitionTx(after.device_id, 'LOCKED', { status: 'ACTIVE' }, tx);
    }
  }
}

class ReplayMarker extends Error {}
