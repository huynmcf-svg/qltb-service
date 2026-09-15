import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';
import { and, count, eq, gte, isNull, lte, sql, sum } from 'drizzle-orm';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { assertSystemAdmin, scopeCondition } from '../../common/auth/scope';
import { defined } from '../../common/dto/cursor-page';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ApiAuthErrors, ApiEnvelopeResponse, ApiValidationError } from '../../common/swagger/api-envelope';
import { EX } from '../../common/swagger/example-values';
import { DRIZZLE, type Db } from '../../db/drizzle.module';
import { alerts, device_quotas, devices, enterprises, notifications, usage_logs, warranties } from '../../db/schema';
import { OFFLINE_AFTER_MS } from '../device/device.repository';
import { EXAMPLE_QUOTA_FULL } from '../quota/dto/quota.examples';
import { QuotaRepository } from '../quota/quota.repository';
import { EXAMPLE_WARRANTY_FULL } from '../warranty/dto/warranty.examples';
import { WarrantyRepository } from '../warranty/warranty.repository';

export class UsageChartDto {
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ enum: ['day', 'week', 'month'], default: 'day' }) @IsOptional() @IsIn(['day', 'week', 'month']) granularity?: 'day' | 'week' | 'month';
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() enterprise_id?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() device_id?: string;
}

const EXAMPLE_ADMIN = {
  enterprise_count: 24,
  device_count: 310,
  devices_by_status: { IN_STOCK: 40, ACTIVE: 250, LOCKED: 12, EXCHANGED: 5, RETIRED: 3 },
  quota_used_total: 1_284_500,
  devices_quota_low: 18,
  devices_warranty_expiring: 7,
  devices_offline: 4,
  open_alerts: 29,
};
const EXAMPLE_BUSINESS = {
  device_count: 12,
  devices: [{ device_id: EX.device_id, serial_number: EX.serial_number, name: 'Máy ký số quầy 1', status: 'ACTIVE', quota_total: 10000, quota_remaining: 1750, remaining_pct: 17.5, is_online: true, is_locked: false }],
  quota_used_total: 82_500,
  quota_remaining_total: 17_500,
  unread_notifications: 3,
};

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly quotas: QuotaRepository,
    private readonly warranties: WarrantyRepository,
  ) {}

  @Get('admin')
  @RequirePermissions('dashboard.admin')
  @ApiOperation({ summary: 'Tổng quan cho quản trị viên', description: 'Chỉ admin hệ thống. Tính lúc gọi; web cache 60 giây. `devices_quota_low` = máy đang gán còn dưới ngưỡng cảnh báo; `devices_warranty_expiring` = bảo hành ACTIVE còn ≤ 30 ngày; `devices_offline` = máy đang gán quá 24 h không gửi lượt.' })
  @ApiEnvelopeResponse({ description: 'Số liệu tổng quan.', example: EXAMPLE_ADMIN })
  @ApiAuthErrors()
  async admin(@CurrentUser() actor: AuthenticatedUser) {
    assertSystemAdmin(actor, 'xem được dashboard quản trị');
    const [[ent], byStatus, [used], [low], [expiring], [offline], [open]] = await Promise.all([
      this.db.select({ n: count() }).from(enterprises),
      this.db.select({ status: devices.status, n: count() }).from(devices).groupBy(devices.status),
      this.db.select({ n: sum(device_quotas.quota_used) }).from(device_quotas),
      this.db.select({ n: count() }).from(device_quotas).innerJoin(devices, eq(device_quotas.device_id, devices.device_id))
        .where(and(sql`${devices.status} IN ('ACTIVE','LOCKED')`, sql`${device_quotas.quota_total} > 0 AND ${device_quotas.quota_remaining} * 100.0 / ${device_quotas.quota_total} < ${device_quotas.warn_threshold_pct}`)),
      this.db.select({ n: count() }).from(warranties).where(and(eq(warranties.status, 'ACTIVE'), lte(warranties.end_date, sql`current_date + 30`))),
      this.db.select({ n: count() }).from(devices).where(and(sql`${devices.status} IN ('ACTIVE','LOCKED')`, lte(devices.last_seen_at, new Date(Date.now() - OFFLINE_AFTER_MS)))),
      this.db.select({ n: count() }).from(alerts).where(isNull(alerts.resolved_at)),
    ]);
    const devices_by_status = Object.fromEntries(['IN_STOCK', 'ACTIVE', 'LOCKED', 'EXCHANGED', 'RETIRED'].map((s) => [s, Number(byStatus.find((b) => b.status === s)?.n ?? 0)]));
    return {
      enterprise_count: Number(ent?.n ?? 0),
      device_count: Object.values(devices_by_status).reduce((a, b) => a + b, 0),
      devices_by_status,
      quota_used_total: Number(used?.n ?? 0),
      devices_quota_low: Number(low?.n ?? 0),
      devices_warranty_expiring: Number(expiring?.n ?? 0),
      devices_offline: Number(offline?.n ?? 0),
      open_alerts: Number(open?.n ?? 0),
    };
  }

  @Get('business')
  @RequirePermissions('dashboard.business')
  @ApiOperation({ summary: 'Tổng quan cho doanh nghiệp', description: 'Theo phạm vi người gọi (DN + chi nhánh). Admin hệ thống gọi thì thấy toàn bộ máy đang gán. Liệt kê từng máy với sản lượng còn lại và kết nối — tối đa 200 máy.' })
  @ApiEnvelopeResponse({ description: 'Số liệu.', example: EXAMPLE_BUSINESS })
  @ApiAuthErrors()
  async business(@CurrentUser() actor: AuthenticatedUser) {
    const rows = await this.db
      .select({ d: devices, q: device_quotas })
      .from(devices)
      .innerJoin(device_quotas, eq(devices.device_id, device_quotas.device_id))
      .where(and(...defined([scopeCondition(devices.enterprise_id, actor.scope), sql`${devices.status} IN ('ACTIVE','LOCKED')`])))
      .orderBy(devices.serial_number)
      .limit(200);
    const [unread] = await this.db.select({ n: count() }).from(notifications).where(and(eq(notifications.user_id, actor.user_id), isNull(notifications.read_at)));
    const now = Date.now();
    return {
      device_count: rows.length,
      devices: rows.map(({ d, q }) => ({
        device_id: d.device_id,
        serial_number: d.serial_number,
        name: d.name,
        status: d.status,
        quota_total: q.quota_total,
        quota_remaining: q.quota_remaining,
        remaining_pct: q.quota_total > 0 ? Math.round((q.quota_remaining / q.quota_total) * 1000) / 10 : null,
        is_online: d.last_seen_at ? now - d.last_seen_at.getTime() < OFFLINE_AFTER_MS : false,
        is_locked: q.is_locked,
      })),
      quota_used_total: rows.reduce((a, r) => a + r.q.quota_used, 0),
      quota_remaining_total: rows.reduce((a, r) => a + r.q.quota_remaining, 0),
      unread_notifications: Number(unread?.n ?? 0),
    };
  }

  @Get('usage-chart')
  @RequirePermissions('dashboard.business')
  @ApiOperation({ summary: 'Biểu đồ sản lượng sử dụng theo thời gian', description: 'Gom lượt dùng (không tính `rejected`) theo `granularity` (day / week / month), trong `from`–`to` (mặc định 30 ngày gần nhất). Lọc `enterprise_id`, `device_id`. `bucket` là ngày đầu kỳ, UTC.' })
  @ApiEnvelopeResponse({ description: 'Các điểm.', example: { points: [{ bucket: '2026-09-14', amount: 118 }, { bucket: '2026-09-15', amount: 132 }] } })
  @ApiValidationError() @ApiAuthErrors()
  async usageChart(@Query() query: UsageChartDto, @CurrentUser() actor: AuthenticatedUser) {
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 86_400_000);
    const to = query.to ? new Date(query.to) : new Date();
    const unit = query.granularity ?? 'day';
    // `unit` đã qua IsIn(day|week|month) nên nội suy thẳng (sql.raw) — nếu để tham số,
    // SELECT và GROUP BY thành hai placeholder $1/$2 và Postgres coi là hai biểu thức khác nhau.
    const bucket = sql<string>`to_char(date_trunc(${sql.raw(`'${unit}'`)}, ${usage_logs.used_at} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;
    const rows = await this.db
      .select({ bucket, amount: sum(usage_logs.amount) })
      .from(usage_logs)
      .innerJoin(devices, eq(usage_logs.device_id, devices.device_id))
      .where(and(...defined([
        scopeCondition(devices.enterprise_id, actor.scope),
        eq(usage_logs.rejected, false),
        gte(usage_logs.used_at, from),
        lte(usage_logs.used_at, to),
        query.enterprise_id ? eq(devices.enterprise_id, query.enterprise_id) : undefined,
        query.device_id ? eq(usage_logs.device_id, query.device_id) : undefined,
      ])))
      .groupBy(bucket)
      .orderBy(bucket);
    return { points: rows.map((r) => ({ bucket: r.bucket, amount: Number(r.amount ?? 0) })) };
  }

  @Get('expiring-devices')
  @RequirePermissions('dashboard.business')
  @ApiOperation({ summary: 'Thiết bị sắp hết sản lượng hoặc sắp hết bảo hành', description: '`quota_low`: máy đang gán còn dưới 20 % (tối đa 50). `warranty_expiring`: bảo hành ACTIVE còn ≤ 30 ngày (tối đa 50, sắp hết trước).' })
  @ApiEnvelopeResponse({ description: 'Hai danh sách.', example: { quota_low: [EXAMPLE_QUOTA_FULL], warranty_expiring: [EXAMPLE_WARRANTY_FULL] } })
  @ApiAuthErrors()
  async expiring(@CurrentUser() actor: AuthenticatedUser) {
    const [quota, warranty] = await Promise.all([
      this.quotas.list({ below_pct: 20, limit: 50 }, actor.scope),
      this.warranties.list({ expiring_within_days: 30, limit: 50 }, actor.scope),
    ]);
    return { quota_low: quota.items.filter((q) => q.device_status === 'ACTIVE' || q.device_status === 'LOCKED'), warranty_expiring: warranty.items };
  }
}
