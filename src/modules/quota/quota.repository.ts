import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { scopeCondition } from '../../common/auth/scope';
import { cursorOrder, cursorWhere, defined, likePattern, pageLimit, toPage } from '../../common/dto/cursor-page';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { DRIZZLE, type Db } from '../../db/drizzle.module';
import { device_quotas, devices, enterprises, quota_allocations, quota_grants, usage_logs, users } from '../../db/schema';
import type { DeviceQuotaView } from '../device/dto/device.dto';
import { toQuotaView } from '../device/device.repository';
import type { ListAllocationsDto, ListQuotasDto, ListUsageDto, QuotaAllocationView, QuotaGrantView, UsageLogView } from './dto/quota.dto';

export type QuotaRow = typeof device_quotas.$inferSelect;
export type UsageRow = typeof usage_logs.$inferSelect;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface QuotaFullView extends DeviceQuotaView {
  serial_number: string;
  device_name: string | null;
  device_status: string;
  enterprise_id: string | null;
  enterprise_name: string | null;
}

@Injectable()
export class QuotaRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  get conn(): Db {
    return this.db;
  }

  private base() {
    return this.db
      .select({ q: device_quotas, d: devices, enterprise_name: enterprises.name })
      .from(device_quotas)
      .innerJoin(devices, eq(device_quotas.device_id, devices.device_id))
      .leftJoin(enterprises, eq(devices.enterprise_id, enterprises.enterprise_id));
  }

  async list(query: ListQuotasDto, scope: string[] | null): Promise<CursorPage<QuotaFullView>> {
    const limit = pageLimit(query);
    const pct = sql`CASE WHEN ${device_quotas.quota_total} > 0 THEN ${device_quotas.quota_remaining} * 100.0 / ${device_quotas.quota_total} ELSE NULL END`;
    const conditions = defined([
      scopeCondition(devices.enterprise_id, scope),
      query.enterprise_id ? eq(devices.enterprise_id, query.enterprise_id) : undefined,
      query.is_locked !== undefined ? eq(device_quotas.is_locked, query.is_locked) : undefined,
      query.below_pct !== undefined ? sql`${pct} < ${query.below_pct}` : undefined,
      query.q ? or(ilike(devices.serial_number, likePattern(query.q)), ilike(devices.name, likePattern(query.q))) : undefined,
      cursorWhere(device_quotas.updated_at, device_quotas.device_id, query),
    ]);
    const rows = await this.base()
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(...cursorOrder(device_quotas.updated_at, device_quotas.device_id))
      .limit(limit + 1);
    return toPage(rows, limit, (r) => ({ ts: r.q.updated_at, id: r.q.device_id }), toFull);
  }

  async findFull(device_id: string): Promise<QuotaFullView | null> {
    const [row] = await this.base().where(eq(device_quotas.device_id, device_id)).limit(1);
    return row ? toFull(row) : null;
  }

  async findRow(device_id: string): Promise<QuotaRow | null> {
    const [row] = await this.db.select().from(device_quotas).where(eq(device_quotas.device_id, device_id)).limit(1);
    return row ?? null;
  }

  /** Khoá dòng `FOR UPDATE` trong transaction — hai lượt dùng song song không cùng trừ. */
  async lockRow(device_id: string, tx: Tx): Promise<QuotaRow | null> {
    const [row] = await tx.select().from(device_quotas).where(eq(device_quotas.device_id, device_id)).for('update').limit(1);
    return row ?? null;
  }

  async update(device_id: string, patch: Partial<typeof device_quotas.$inferInsert>, tx?: Tx): Promise<QuotaRow | null> {
    const [row] = await (tx ?? this.db).update(device_quotas).set(patch).where(eq(device_quotas.device_id, device_id)).returning();
    return row ?? null;
  }

  /** Cộng vào tổng (cấp, nhận phân bổ). `delta` âm = trừ tổng (cho phân bổ). */
  async addTotal(device_id: string, delta: number, tx: Tx): Promise<QuotaRow> {
    const [row] = await tx
      .update(device_quotas)
      .set({ quota_total: sql`${device_quotas.quota_total} + ${delta}`, quota_remaining: sql`${device_quotas.quota_remaining} + ${delta}` })
      .where(eq(device_quotas.device_id, device_id))
      .returning();
    if (!row) throw new Error(`device_quotas ${device_id} không tồn tại`);
    return row;
  }

  /** Trừ vào đã dùng (lượt dùng). */
  async addUsed(device_id: string, amount: number, tx: Tx): Promise<QuotaRow> {
    const [row] = await tx
      .update(device_quotas)
      .set({ quota_used: sql`${device_quotas.quota_used} + ${amount}`, quota_remaining: sql`${device_quotas.quota_remaining} - ${amount}` })
      .where(eq(device_quotas.device_id, device_id))
      .returning();
    if (!row) throw new Error(`device_quotas ${device_id} không tồn tại`);
    return row;
  }

  async insertGrant(input: typeof quota_grants.$inferInsert, tx: Tx) {
    const [row] = await tx.insert(quota_grants).values(input).returning();
    return row!;
  }

  async listGrants(device_id: string, query: { limit?: number; cursor?: string }): Promise<CursorPage<QuotaGrantView>> {
    const limit = pageLimit(query);
    const rows = await this.db
      .select({ g: quota_grants, by_name: users.full_name })
      .from(quota_grants)
      .leftJoin(users, eq(quota_grants.granted_by, users.user_id))
      .where(and(eq(quota_grants.device_id, device_id), cursorWhere(quota_grants.granted_at, quota_grants.grant_id, query)))
      .orderBy(...cursorOrder(quota_grants.granted_at, quota_grants.grant_id))
      .limit(limit + 1);
    return toPage(rows, limit, (r) => ({ ts: r.g.granted_at, id: r.g.grant_id }), (r) => ({
      grant_id: r.g.grant_id,
      device_id: r.g.device_id,
      amount: r.g.amount,
      total_after: r.g.total_after,
      granted_by: r.g.granted_by,
      granted_by_name: r.by_name,
      note: r.g.note,
      granted_at: r.g.granted_at.toISOString(),
    }));
  }

  async insertAllocation(input: typeof quota_allocations.$inferInsert, tx: Tx) {
    const [row] = await tx.insert(quota_allocations).values(input).returning();
    return row!;
  }

  async listAllocations(query: ListAllocationsDto, scope: string[] | null): Promise<CursorPage<QuotaAllocationView>> {
    const limit = pageLimit(query);
    const fromEnt = alias(enterprises, 'from_ent');
    const toEnt = alias(enterprises, 'to_ent');
    const fromDev = alias(devices, 'from_dev');
    const conditions = defined([
      scope !== null ? or(scopeCondition(quota_allocations.from_enterprise_id, scope), scopeCondition(quota_allocations.to_enterprise_id, scope)) : undefined,
      query.from_enterprise_id ? eq(quota_allocations.from_enterprise_id, query.from_enterprise_id) : undefined,
      query.to_enterprise_id ? eq(quota_allocations.to_enterprise_id, query.to_enterprise_id) : undefined,
      query.device_id ? or(eq(quota_allocations.device_id, query.device_id), eq(quota_allocations.from_device_id, query.device_id)) : undefined,
      query.from ? gte(quota_allocations.allocated_at, new Date(query.from)) : undefined,
      query.to ? lte(quota_allocations.allocated_at, new Date(query.to)) : undefined,
      cursorWhere(quota_allocations.allocated_at, quota_allocations.allocation_id, query),
    ]);
    const rows = await this.db
      .select({ a: quota_allocations, from_name: fromEnt.name, to_name: toEnt.name, serial: devices.serial_number, from_serial: fromDev.serial_number, by_name: users.full_name })
      .from(quota_allocations)
      .innerJoin(fromEnt, eq(quota_allocations.from_enterprise_id, fromEnt.enterprise_id))
      .innerJoin(toEnt, eq(quota_allocations.to_enterprise_id, toEnt.enterprise_id))
      .innerJoin(devices, eq(quota_allocations.device_id, devices.device_id))
      .innerJoin(fromDev, eq(quota_allocations.from_device_id, fromDev.device_id))
      .leftJoin(users, eq(quota_allocations.allocated_by, users.user_id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(...cursorOrder(quota_allocations.allocated_at, quota_allocations.allocation_id))
      .limit(limit + 1);
    return toPage(rows, limit, (r) => ({ ts: r.a.allocated_at, id: r.a.allocation_id }), (r) => ({
      allocation_id: r.a.allocation_id,
      from_enterprise_id: r.a.from_enterprise_id,
      from_enterprise_name: r.from_name,
      to_enterprise_id: r.a.to_enterprise_id,
      to_enterprise_name: r.to_name,
      from_device_id: r.a.from_device_id,
      from_serial_number: r.from_serial,
      device_id: r.a.device_id,
      serial_number: r.serial,
      amount: r.a.amount,
      allocated_by: r.a.allocated_by,
      allocated_by_name: r.by_name,
      note: r.a.note,
      allocated_at: r.a.allocated_at.toISOString(),
    }));
  }

  /** `ON CONFLICT DO NOTHING` theo (device_id, client_ref): trùng → trả null, caller đọc lại bản cũ. */
  async insertUsage(input: typeof usage_logs.$inferInsert, tx: Tx): Promise<UsageRow | null> {
    const [row] = await tx.insert(usage_logs).values(input).onConflictDoNothing().returning();
    return row ?? null;
  }

  async findUsageByRef(device_id: string, client_ref: string): Promise<UsageRow | null> {
    const [row] = await this.db.select().from(usage_logs).where(and(eq(usage_logs.device_id, device_id), eq(usage_logs.client_ref, client_ref))).limit(1);
    return row ?? null;
  }

  async listUsage(query: ListUsageDto, scope: string[] | null): Promise<CursorPage<UsageLogView>> {
    const limit = pageLimit(query);
    const conditions = defined([
      scopeCondition(devices.enterprise_id, scope),
      query.device_id ? eq(usage_logs.device_id, query.device_id) : undefined,
      query.enterprise_id ? eq(devices.enterprise_id, query.enterprise_id) : undefined,
      query.from ? gte(usage_logs.used_at, new Date(query.from)) : undefined,
      query.to ? lte(usage_logs.used_at, new Date(query.to)) : undefined,
      query.rejected !== undefined ? eq(usage_logs.rejected, query.rejected) : undefined,
      cursorWhere(usage_logs.used_at, usage_logs.usage_id, query),
    ]);
    const rows = await this.db
      .select({ u: usage_logs, serial: devices.serial_number })
      .from(usage_logs)
      .innerJoin(devices, eq(usage_logs.device_id, devices.device_id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(...cursorOrder(usage_logs.used_at, usage_logs.usage_id))
      .limit(limit + 1);
    return toPage(rows, limit, (r) => ({ ts: r.u.used_at, id: r.u.usage_id }), (r) => toUsageView(r.u, r.serial));
  }

  /** Số lượt / số máy có lịch sử — để quyết định có xoá cứng được không. */
  async hasHistory(device_id: string): Promise<boolean> {
    const [g] = await this.db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(quota_grants).where(eq(quota_grants.device_id, device_id));
    const [u] = await this.db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(usage_logs).where(eq(usage_logs.device_id, device_id));
    return (g?.n ?? 0) > 0 || (u?.n ?? 0) > 0;
  }
}

export function toUsageView(u: UsageRow, serial_number: string): UsageLogView {
  return {
    usage_id: u.usage_id,
    device_id: u.device_id,
    serial_number,
    client_ref: u.client_ref,
    amount: u.amount,
    used_at: u.used_at.toISOString(),
    received_at: u.received_at.toISOString(),
    rejected: u.rejected,
    remaining_after: u.remaining_after,
    meta: u.meta,
  };
}

function toFull(r: { q: QuotaRow; d: typeof devices.$inferSelect; enterprise_name: string | null }): QuotaFullView {
  return {
    ...toQuotaView(r.q),
    serial_number: r.d.serial_number,
    device_name: r.d.name,
    device_status: r.d.status,
    enterprise_id: r.d.enterprise_id,
    enterprise_name: r.enterprise_name,
  };
}
