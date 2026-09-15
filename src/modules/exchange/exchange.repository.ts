import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { scopeCondition } from '../../common/auth/scope';
import { cursorOrder, cursorWhere, defined, pageLimit, toPage } from '../../common/dto/cursor-page';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { DRIZZLE, type Db } from '../../db/drizzle.module';
import { device_exchanges, devices, enterprises, users } from '../../db/schema';
import type { ExchangeView, ListExchangesDto } from './dto/exchange.dto';

export type ExchangeRow = typeof device_exchanges.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

@Injectable()
export class ExchangeRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  get conn(): Db {
    return this.db;
  }

  private base() {
    const oldDev = alias(devices, 'old_dev');
    const newDev = alias(devices, 'new_dev');
    const requester = alias(users, 'requester');
    const approver = alias(users, 'approver');
    return this.db
      .select({ x: device_exchanges, enterprise_name: enterprises.name, old_serial: oldDev.serial_number, new_serial: newDev.serial_number, requester_name: requester.full_name, approver_name: approver.full_name })
      .from(device_exchanges)
      .innerJoin(enterprises, eq(device_exchanges.enterprise_id, enterprises.enterprise_id))
      .innerJoin(oldDev, eq(device_exchanges.old_device_id, oldDev.device_id))
      .leftJoin(newDev, eq(device_exchanges.new_device_id, newDev.device_id))
      .leftJoin(requester, eq(device_exchanges.requested_by, requester.user_id))
      .leftJoin(approver, eq(device_exchanges.approved_by, approver.user_id));
  }

  async list(query: ListExchangesDto, scope: string[] | null): Promise<CursorPage<ExchangeView>> {
    const limit = pageLimit(query);
    const conditions = defined([
      scopeCondition(device_exchanges.enterprise_id, scope),
      query.status ? eq(device_exchanges.status, query.status) : undefined,
      query.enterprise_id ? eq(device_exchanges.enterprise_id, query.enterprise_id) : undefined,
      cursorWhere(device_exchanges.requested_at, device_exchanges.exchange_id, query),
    ]);
    const rows = await this.base()
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(...cursorOrder(device_exchanges.requested_at, device_exchanges.exchange_id))
      .limit(limit + 1);
    return toPage(rows, limit, (r) => ({ ts: r.x.requested_at, id: r.x.exchange_id }), toView);
  }

  async findById(exchange_id: string): Promise<ExchangeView | null> {
    const [row] = await this.base().where(eq(device_exchanges.exchange_id, exchange_id)).limit(1);
    return row ? toView(row) : null;
  }

  async create(input: typeof device_exchanges.$inferInsert): Promise<ExchangeRow> {
    const [row] = await this.db.insert(device_exchanges).values(input).returning();
    if (!row) throw new Error('insert device_exchanges không trả về dòng nào');
    return row;
  }

  /** Cập nhật có điều kiện status hiện tại — hai người duyệt cùng lúc chỉ một thắng. */
  async updateIfStatus(exchange_id: string, from: 'PENDING', patch: Partial<typeof device_exchanges.$inferInsert>, tx?: Tx): Promise<ExchangeRow | null> {
    const [row] = await (tx ?? this.db)
      .update(device_exchanges)
      .set(patch)
      .where(and(eq(device_exchanges.exchange_id, exchange_id), eq(device_exchanges.status, from)))
      .returning();
    return row ?? null;
  }

  async deleteIfPending(exchange_id: string): Promise<boolean> {
    const rows = await this.db.delete(device_exchanges).where(and(eq(device_exchanges.exchange_id, exchange_id), eq(device_exchanges.status, 'PENDING'))).returning({ id: device_exchanges.exchange_id });
    return rows.length > 0;
  }
}

function toView(r: { x: ExchangeRow; enterprise_name: string; old_serial: string; new_serial: string | null; requester_name: string | null; approver_name: string | null }): ExchangeView {
  return {
    exchange_id: r.x.exchange_id,
    enterprise_id: r.x.enterprise_id,
    enterprise_name: r.enterprise_name,
    old_device_id: r.x.old_device_id,
    old_serial_number: r.old_serial,
    new_device_id: r.x.new_device_id,
    new_serial_number: r.new_serial,
    reason: r.x.reason,
    status: r.x.status,
    requested_by: r.x.requested_by,
    requested_by_name: r.requester_name,
    requested_at: r.x.requested_at.toISOString(),
    approved_by: r.x.approved_by,
    approved_by_name: r.approver_name,
    approved_at: r.x.approved_at?.toISOString() ?? null,
    reject_reason: r.x.reject_reason,
    notes: r.x.notes,
    created_at: r.x.created_at.toISOString(),
    updated_at: r.x.updated_at.toISOString(),
  };
}
