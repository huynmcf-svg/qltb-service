import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, lte, or, sql } from 'drizzle-orm';
import { scopeCondition } from '../../common/auth/scope';
import { cursorOrderAsc, cursorWhereAsc, defined, likePattern, pageLimit, toPageAsc } from '../../common/dto/cursor-page';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { DRIZZLE, type Db } from '../../db/drizzle.module';
import { devices, enterprises, warranties, type WarrantyStatus } from '../../db/schema';
import type { WarrantyView } from '../device/dto/device.dto';
import type { ListWarrantiesDto } from './dto/warranty.dto';

export type WarrantyRow = typeof warranties.$inferSelect;
type Insert = typeof warranties.$inferInsert;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface WarrantyFullView extends WarrantyView {
  serial_number: string;
  enterprise_name: string | null;
}

@Injectable()
export class WarrantyRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  private base() {
    return this.db
      .select({ w: warranties, serial_number: devices.serial_number, enterprise_name: enterprises.name })
      .from(warranties)
      .innerJoin(devices, eq(warranties.device_id, devices.device_id))
      .leftJoin(enterprises, eq(warranties.enterprise_id, enterprises.enterprise_id));
  }

  /** Sắp theo `end_date` TĂNG dần — sắp hết hạn lên đầu. */
  async list(query: ListWarrantiesDto, scope: string[] | null): Promise<CursorPage<WarrantyFullView>> {
    const limit = pageLimit(query);
    const within = query.expiring_within_days !== undefined ? sql`current_date + ${query.expiring_within_days}::int` : undefined;
    const conditions = defined([
      scopeCondition(warranties.enterprise_id, scope),
      query.status ? eq(warranties.status, query.status) : undefined,
      query.enterprise_id ? eq(warranties.enterprise_id, query.enterprise_id) : undefined,
      query.device_id ? eq(warranties.device_id, query.device_id) : undefined,
      within ? and(eq(warranties.status, 'ACTIVE'), lte(warranties.end_date, within)) : undefined,
      query.q ? or(ilike(devices.serial_number, likePattern(query.q)), ilike(devices.name, likePattern(query.q))) : undefined,
      cursorWhereAsc(warranties.end_date, warranties.warranty_id, query, (ts) => ts),
    ]);
    const rows = await this.base()
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(...cursorOrderAsc(warranties.end_date, warranties.warranty_id))
      .limit(limit + 1);
    return toPageAsc(rows, limit, (r) => ({ ts: r.w.end_date, id: r.w.warranty_id }), (r) => toFullView(r));
  }

  async findById(warranty_id: string): Promise<WarrantyFullView | null> {
    const [row] = await this.base().where(eq(warranties.warranty_id, warranty_id)).limit(1);
    return row ? toFullView(row) : null;
  }

  async historyOfDevice(device_id: string): Promise<WarrantyFullView[]> {
    const rows = await this.base().where(eq(warranties.device_id, device_id)).orderBy(desc(warranties.created_at));
    return rows.map(toFullView);
  }

  async activeOf(device_id: string, tx?: Tx): Promise<WarrantyRow | null> {
    const [row] = await (tx ?? this.db).select().from(warranties).where(and(eq(warranties.device_id, device_id), eq(warranties.status, 'ACTIVE'))).limit(1);
    return row ?? null;
  }

  async create(input: Insert, tx?: Tx): Promise<WarrantyRow> {
    const [row] = await (tx ?? this.db).insert(warranties).values(input).returning();
    if (!row) throw new Error('insert warranties không trả về dòng nào');
    return row;
  }

  async update(warranty_id: string, patch: Partial<Insert>, tx?: Tx): Promise<WarrantyRow | null> {
    const [row] = await (tx ?? this.db).update(warranties).set(patch).where(eq(warranties.warranty_id, warranty_id)).returning();
    return row ?? null;
  }

  async setStatusOfActive(device_id: string, status: WarrantyStatus, tx?: Tx): Promise<WarrantyRow | null> {
    const [row] = await (tx ?? this.db)
      .update(warranties)
      .set({ status })
      .where(and(eq(warranties.device_id, device_id), eq(warranties.status, 'ACTIVE')))
      .returning();
    return row ?? null;
  }

  /** Job: ACTIVE quá hạn → EXPIRED. Trả các dòng vừa đổi để phát cảnh báo. */
  async expireOverdue(): Promise<WarrantyRow[]> {
    return this.db
      .update(warranties)
      .set({ status: 'EXPIRED' })
      .where(and(eq(warranties.status, 'ACTIVE'), sql`${warranties.end_date} < current_date`))
      .returning();
  }
}

export function toWarrantyView(row: WarrantyRow, now = new Date()): WarrantyView {
  const end = new Date(`${row.end_date}T00:00:00Z`);
  return {
    warranty_id: row.warranty_id,
    device_id: row.device_id,
    enterprise_id: row.enterprise_id,
    start_date: row.start_date,
    end_date: row.end_date,
    status: row.status,
    source: row.source,
    days_remaining: Math.ceil((end.getTime() - now.getTime()) / 86_400_000),
    notes: row.notes,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function toFullView(r: { w: WarrantyRow; serial_number: string; enterprise_name: string | null }): WarrantyFullView {
  return { ...toWarrantyView(r.w), serial_number: r.serial_number, enterprise_name: r.enterprise_name };
}
