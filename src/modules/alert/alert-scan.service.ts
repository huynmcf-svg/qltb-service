import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import { AppLogger } from '../../common/logger/app-logger.service';
import { device_quotas, devices, warranties } from '../../db/schema';
import { DeviceRepository } from '../device/device.repository';
import { QuotaRepository } from '../quota/quota.repository';
import { QuotaService } from '../quota/quota.service';
import { WarrantyRepository } from '../warranty/warranty.repository';
import { AlertEmitter } from './alert-emitter.service';

export interface ScanResult {
  warranties_expired: number;
  warranty_alerts: number;
  quota_alerts_checked: number;
  packages_locked: number;
  offline_alerts: number;
  online_resolved: number;
  duration_ms: number;
}

/**
 * Job quét cảnh báo — chạy mỗi 15 phút, và gọi tay được qua `POST /alerts/scan`.
 * Mọi bước idempotent: chạy lại không phát trùng (dedupe_key), không khoá hai lần.
 */
@Injectable()
export class AlertScanService {
  private running = false;

  constructor(
    private readonly emitter: AlertEmitter,
    private readonly warranties: WarrantyRepository,
    private readonly quotas: QuotaRepository,
    private readonly quotaService: QuotaService,
    private readonly devices: DeviceRepository,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async scheduled(): Promise<void> {
    if (this.running) return; // lần trước chưa xong thì bỏ lượt này
    try {
      const result = await this.scan();
      this.logger.info('alert scan finished', { ...result });
    } catch (error) {
      this.logger.error('alert scan failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  async scan(): Promise<ScanResult> {
    this.running = true;
    const started = Date.now();
    try {
      const db = this.quotas.conn;
      const result: ScanResult = { warranties_expired: 0, warranty_alerts: 0, quota_alerts_checked: 0, packages_locked: 0, offline_alerts: 0, online_resolved: 0, duration_ms: 0 };

      // ── 1. Bảo hành: quá hạn → EXPIRED + cảnh báo; còn 30/15/7 ngày → cảnh báo
      const expired = await this.warranties.expireOverdue();
      result.warranties_expired = expired.length;
      for (const w of expired) {
        const dev = await this.devices.findRaw(w.device_id);
        if (await this.emitter.emit({ device_id: w.device_id, enterprise_id: w.enterprise_id, type: 'WARRANTY_EXPIRED', severity: 'WARNING', message: `Máy ${dev?.serial_number ?? w.device_id} đã hết bảo hành ngày ${w.end_date}`, payload: { end_date: w.end_date }, dedupe_key: w.end_date })) result.warranty_alerts++;
      }
      const active = await db
        .select({ w: warranties, serial: devices.serial_number, days: sql<number>`(${warranties.end_date} - current_date)`.mapWith(Number) })
        .from(warranties)
        .innerJoin(devices, eq(warranties.device_id, devices.device_id))
        .where(and(eq(warranties.status, 'ACTIVE'), lte(warranties.end_date, sql`current_date + 30`)));
      for (const { w, serial, days } of active) {
        const type = days <= 7 ? 'WARRANTY_7D' : days <= 15 ? 'WARRANTY_15D' : 'WARRANTY_30D';
        const severity = days <= 7 ? 'WARNING' : 'INFO';
        if (await this.emitter.emit({ device_id: w.device_id, enterprise_id: w.enterprise_id, type, severity, message: `Máy ${serial} còn ${days} ngày bảo hành (hết ${w.end_date})`, payload: { end_date: w.end_date, days_remaining: days }, dedupe_key: w.end_date })) result.warranty_alerts++;
      }

      // ── 2. Sản lượng: ngưỡng (dedupe theo tổng) — quét máy đang gán
      const quotaRows = await db
        .select({ q: device_quotas })
        .from(device_quotas)
        .innerJoin(devices, eq(device_quotas.device_id, devices.device_id))
        .where(and(sql`${devices.status} IN ('ACTIVE','LOCKED')`, gt(device_quotas.quota_total, 0)));
      for (const { q } of quotaRows) {
        await this.quotaService.checkThresholds(q.device_id, q);
        result.quota_alerts_checked++;
      }

      // ── 3. Hết thời gian gói → khoá PACKAGE_EXPIRED
      const expiredPackages = await db
        .select({ device_id: device_quotas.device_id })
        .from(device_quotas)
        .innerJoin(devices, eq(device_quotas.device_id, devices.device_id))
        .where(and(eq(devices.status, 'ACTIVE'), eq(device_quotas.is_locked, false), lte(device_quotas.package_end_at, new Date())));
      for (const { device_id } of expiredPackages) {
        await db.transaction(async (tx) => {
          const row = await this.devices.transitionTx(device_id, 'ACTIVE', { status: 'LOCKED' }, tx);
          if (row) await this.quotas.update(device_id, { is_locked: true, locked_reason: 'PACKAGE_EXPIRED', locked_at: new Date() }, tx);
        });
        result.packages_locked++;
      }

      // ── 4. Offline: quá ngưỡng kể từ last_seen_at → cảnh báo; online lại → đóng
      const hours = this.config.get<number>('deviceOfflineAfterHours') ?? 24;
      const threshold = new Date(Date.now() - hours * 3_600_000);
      const stale = await this.devices.findStale(threshold);
      for (const d of stale) {
        if (await this.emitter.emit({ device_id: d.device_id, enterprise_id: d.enterprise_id, type: 'DEVICE_OFFLINE', severity: 'WARNING', message: `Máy ${d.serial_number} mất kết nối từ ${d.last_seen_at?.toISOString()}`, payload: { last_seen_at: d.last_seen_at?.toISOString(), threshold_hours: hours }, dedupe_key: d.last_seen_at?.toISOString() ?? 'never' })) result.offline_alerts++;
      }
      const online = await db
        .select({ device_id: devices.device_id })
        .from(devices)
        .where(and(gt(devices.last_seen_at, threshold), sql`exists (select 1 from alerts a where a.device_id = ${devices.device_id} and a.type = 'DEVICE_OFFLINE' and a.resolved_at is null)`));
      for (const { device_id } of online) result.online_resolved += await this.emitter.resolve(device_id, ['DEVICE_OFFLINE']);
      void isNull;

      result.duration_ms = Date.now() - started;
      return result;
    } finally {
      this.running = false;
    }
  }
}
