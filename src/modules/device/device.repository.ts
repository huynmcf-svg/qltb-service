import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, lt, or, sql } from 'drizzle-orm';
import {
  DEFAULT_PAGE_LIMIT,
  decodeCursor,
  encodeCursor,
  type CursorPage,
} from '../../common/dto/pagination.dto';
import { DRIZZLE, type Db } from '../../db/drizzle.module';
import { device_categories, device_history, devices, type DeviceStatus } from '../../db/schema';
import type { DeviceView, ListDevicesDto } from './dto/device.dto';

type DeviceRow = typeof devices.$inferSelect;
type DeviceInsert = typeof devices.$inferInsert;
type HistoryInsert = typeof device_history.$inferInsert;

/**
 * Truy vấn Drizzle cho cụm thiết bị. Không có nghiệp vụ ở đây — kiểm tra
 * chuyển trạng thái, map lỗi sang mã hợp đồng là việc của service.
 */
@Injectable()
export class DeviceRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * Danh sách, cursor theo `(created_at DESC, device_id DESC)`.
   *
   * Lấy `limit + 1` dòng để biết còn trang sau hay không mà không cần COUNT.
   */
  async list(query: ListDevicesDto): Promise<CursorPage<DeviceView>> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const conditions = [
      query.status ? eq(devices.status, query.status) : undefined,
      query.category_id ? eq(devices.category_id, query.category_id) : undefined,
      query.q
        ? or(
            ilike(devices.code, `%${escapeLike(query.q)}%`),
            ilike(devices.name, `%${escapeLike(query.q)}%`),
            ilike(devices.serial_number, `%${escapeLike(query.q)}%`),
          )
        : undefined,
      cursor
        ? or(
            lt(devices.created_at, new Date(cursor.ts)),
            and(eq(devices.created_at, new Date(cursor.ts)), lt(devices.device_id, cursor.id)),
          )
        : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);

    const rows = await this.db
      .select({ device: devices, category_name: device_categories.name })
      .from(devices)
      .innerJoin(device_categories, eq(devices.category_id, device_categories.category_id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(devices.created_at), desc(devices.device_id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      items: page.map((r) => toView(r.device, r.category_name)),
      next_cursor:
        hasMore && last
          ? encodeCursor({ ts: last.device.created_at.toISOString(), id: last.device.device_id })
          : null,
    };
  }

  async findById(device_id: string): Promise<DeviceView | null> {
    const rows = await this.db
      .select({ device: devices, category_name: device_categories.name })
      .from(devices)
      .innerJoin(device_categories, eq(devices.category_id, device_categories.category_id))
      .where(eq(devices.device_id, device_id))
      .limit(1);
    const row = rows[0];
    return row ? toView(row.device, row.category_name) : null;
  }

  async categoryExists(category_id: string): Promise<boolean> {
    const rows = await this.db
      .select({ one: sql<number>`1` })
      .from(device_categories)
      .where(eq(device_categories.category_id, category_id))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Tạo thiết bị + dòng lịch sử REGISTER trong MỘT transaction. Lỗi unique
   * (23505) để lọt lên cho service map sang DEVICE_CODE_CONFLICT.
   */
  async create(input: DeviceInsert, history: Omit<HistoryInsert, 'device_id'>): Promise<DeviceRow> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(devices).values(input).returning();
      if (!row) throw new Error('insert devices không trả về dòng nào');
      await tx.insert(device_history).values({ ...history, device_id: row.device_id });
      return row;
    });
  }

  async update(device_id: string, patch: Partial<DeviceInsert>): Promise<DeviceRow | null> {
    const [row] = await this.db
      .update(devices)
      .set(patch)
      .where(eq(devices.device_id, device_id))
      .returning();
    return row ?? null;
  }

  /**
   * Chuyển trạng thái + ghi lịch sử trong MỘT transaction, có kiểm
   * `from_status` ở WHERE để hai request song song không cùng thắng.
   * Trả `null` nếu trạng thái hiện tại không còn là `from` — service coi đó là
   * xung đột.
   */
  async transition(
    device_id: string,
    from: DeviceStatus,
    patch: Partial<DeviceInsert> & { status: DeviceStatus },
    history: Omit<HistoryInsert, 'device_id' | 'from_status' | 'to_status'>,
  ): Promise<DeviceRow | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(devices)
        .set(patch)
        .where(and(eq(devices.device_id, device_id), eq(devices.status, from)))
        .returning();
      if (!row) return null;
      await tx.insert(device_history).values({
        ...history,
        device_id,
        from_status: from,
        to_status: patch.status,
      });
      return row;
    });
  }
}

/** Escape ký tự đặc biệt của LIKE, để người dùng gõ `%` không thành wildcard. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function toView(row: DeviceRow, category_name: string): DeviceView {
  return {
    device_id: row.device_id,
    code: row.code,
    name: row.name,
    category_id: row.category_id,
    category_name,
    brand: row.brand,
    model: row.model,
    serial_number: row.serial_number,
    status: row.status,
    holder_name: row.holder_name,
    holder_unit: row.holder_unit,
    purchased_at: row.purchased_at,
    warranty_until: row.warranty_until,
    purchase_price: row.purchase_price,
    notes: row.notes,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
