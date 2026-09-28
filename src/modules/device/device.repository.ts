import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, lt, or } from 'drizzle-orm';
import {
  DEFAULT_PAGE_LIMIT,
  decodeCursor,
  encodeCursor,
  type CursorPage,
} from '../../common/dto/pagination.dto';
import { DRIZZLE, type Db } from '../../db/drizzle.module';
import { device_quotas, devices, enterprises, warranties, type DeviceStatus } from '../../db/schema';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
import type { DeviceDetailView, DeviceQuotaView, DeviceView, ListDevicesDto, WarrantyView } from './dto/device.dto';

type DeviceRow = typeof devices.$inferSelect;
type DeviceInsert = typeof devices.$inferInsert;
type QuotaRow = typeof device_quotas.$inferSelect;
type WarrantyRow = typeof warranties.$inferSelect;
type WarrantyInsert = typeof warranties.$inferInsert;

/** Quá ngưỡng này kể từ `last_seen_at` thì coi là offline. Chưa chốt — 24 h. */
export const OFFLINE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Truy vấn Drizzle cho thiết bị. Không có nghiệp vụ ở đây — kiểm tra chuyển
 * trạng thái, map lỗi sang mã hợp đồng là việc của service.
 */
@Injectable()
export class DeviceRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * Danh sách, cursor theo `(created_at DESC, device_id DESC)`.
   * Lấy `limit + 1` dòng để biết còn trang sau mà không cần COUNT.
   */
  async list(query: ListDevicesDto, scope: string[] | null): Promise<CursorPage<DeviceView>> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const conditions = [
      // Phạm vi từ token đi TRƯỚC bộ lọc của client: `?enterprise_id=` chỉ thu hẹp thêm.
      scope !== null ? inArray(devices.enterprise_id, scope.length ? scope : ['00000000-0000-0000-0000-000000000000']) : undefined,
      query.enterprise_id ? eq(devices.enterprise_id, query.enterprise_id) : undefined,
      query.device_type ? eq(devices.device_type, query.device_type) : undefined,
      query.status ? eq(devices.status, query.status) : undefined,
      query.supplier_name ? ilike(devices.supplier_name, `%${escapeLike(query.supplier_name)}%`) : undefined,
      query.q
        ? or(
            ilike(devices.serial_number, `%${escapeLike(query.q)}%`),
            ilike(devices.name, `%${escapeLike(query.q)}%`),
            ilike(devices.model, `%${escapeLike(query.q)}%`),
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
      .select({ device: devices, enterprise_name: enterprises.name })
      .from(devices)
      .leftJoin(enterprises, eq(devices.enterprise_id, enterprises.enterprise_id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(devices.created_at), desc(devices.device_id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      items: page.map((r) => toView(r.device, r.enterprise_name)),
      next_cursor:
        hasMore && last
          ? encodeCursor({ ts: last.device.created_at.toISOString(), id: last.device.device_id })
          : null,
    };
  }

  async findById(device_id: string): Promise<DeviceView | null> {
    const rows = await this.db
      .select({ device: devices, enterprise_name: enterprises.name })
      .from(devices)
      .leftJoin(enterprises, eq(devices.enterprise_id, enterprises.enterprise_id))
      .where(eq(devices.device_id, device_id))
      .limit(1);
    const row = rows[0];
    return row ? toView(row.device, row.enterprise_name) : null;
  }

  /** Chi tiết: máy + quota + bảo hành ACTIVE (partial unique nên tối đa một). */
  async findDetailById(device_id: string): Promise<DeviceDetailView | null> {
    const device = await this.findById(device_id);
    if (!device) return null;

    const [quota] = await this.db.select().from(device_quotas).where(eq(device_quotas.device_id, device_id)).limit(1);
    const [warranty] = await this.db
      .select()
      .from(warranties)
      .where(and(eq(warranties.device_id, device_id), eq(warranties.status, 'ACTIVE')))
      .limit(1);

    return {
      ...device,
      quota: quota ? toQuotaView(quota) : emptyQuota(device_id, device.updated_at),
      warranty: warranty ? toWarrantyView(warranty) : null,
    };
  }

  /**
   * Nhập máy + tạo dòng `device_quotas` rỗng trong MỘT transaction. Lỗi unique
   * (23505) để lọt lên cho service map sang DEVICE_SERIAL_CONFLICT.
   */
  async create(input: DeviceInsert): Promise<DeviceRow> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(devices).values(input).returning();
      if (!row) throw new Error('insert devices không trả về dòng nào');
      await tx.insert(device_quotas).values({ device_id: row.device_id });
      return row;
    });
  }

  /** Serial đã có trong hệ thống, trong số `serials` truyền vào. */
  async existingSerials(serials: string[]): Promise<string[]> {
    if (!serials.length) return [];
    const rows = await this.db.select({ serial_number: devices.serial_number }).from(devices).where(inArray(devices.serial_number, serials));
    return rows.map((r) => r.serial_number);
  }

  /**
   * Nhập hàng loạt trong MỘT transaction: máy + dòng quota rỗng + bảo hành
   * (nếu có). Một dòng hỏng là rollback cả lô. Lỗi 23505 để lọt lên service.
   */
  async createMany(items: Array<{ device: DeviceInsert; warranty?: Omit<WarrantyInsert, 'device_id'> }>): Promise<DeviceRow[]> {
    return this.db.transaction(async (tx) => {
      const out: DeviceRow[] = [];
      // Chia lô để không vượt giới hạn tham số của Postgres (65 535).
      for (let i = 0; i < items.length; i += 200) {
        const chunk = items.slice(i, i + 200);
        const rows = await tx.insert(devices).values(chunk.map((c) => c.device)).returning();
        const bySerial = new Map(rows.map((r) => [r.serial_number, r]));
        await tx.insert(device_quotas).values(rows.map((r) => ({ device_id: r.device_id })));
        const ws = chunk.flatMap((c) => {
          const row = bySerial.get(c.device.serial_number);
          return c.warranty && row ? [{ ...c.warranty, device_id: row.device_id }] : [];
        });
        if (ws.length) await tx.insert(warranties).values(ws);
        out.push(...chunk.map((c) => bySerial.get(c.device.serial_number)!));
      }
      return out;
    });
  }

  async update(device_id: string, patch: Partial<DeviceInsert>): Promise<DeviceRow | null> {
    const [row] = await this.db.update(devices).set(patch).where(eq(devices.device_id, device_id)).returning();
    return row ?? null;
  }

  /**
   * Chuyển trạng thái có kiểm `from` ở WHERE để hai request song song không
   * cùng thắng. Trả `null` nếu trạng thái hiện tại không còn là `from`.
   * Ghi lịch sử / bảo hành / quota kèm theo là việc của service, trong cùng
   * transaction — dùng `tx` truyền vào khi làm tới assign / unassign.
   */
  async transition(
    device_id: string,
    from: DeviceStatus,
    patch: Partial<DeviceInsert> & { status: DeviceStatus },
  ): Promise<DeviceRow | null> {
    return this.transitionTx(device_id, from, patch, this.db);
  }

  async transitionTx(device_id: string, from: DeviceStatus, patch: Partial<DeviceInsert> & { status: DeviceStatus }, tx: Tx | Db): Promise<DeviceRow | null> {
    const [row] = await tx
      .update(devices)
      .set(patch)
      .where(and(eq(devices.device_id, device_id), eq(devices.status, from)))
      .returning();
    return row ?? null;
  }

  get conn(): Db {
    return this.db;
  }

  async findRaw(device_id: string): Promise<DeviceRow | null> {
    const [row] = await this.db.select().from(devices).where(eq(devices.device_id, device_id)).limit(1);
    return row ?? null;
  }

  async findByApiKeyHash(hash: string): Promise<DeviceRow | null> {
    const [row] = await this.db.select().from(devices).where(eq(devices.api_key_hash, hash)).limit(1);
    return row ?? null;
  }

  /** Xoá cứng máy + dòng quota. Lỗi FK (còn lịch sử) để lọt lên service. */
  async hardDelete(device_id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(device_quotas).where(eq(device_quotas.device_id, device_id));
      await tx.delete(devices).where(eq(devices.device_id, device_id));
    });
  }

  /** Job offline: máy đang gán, có last_seen_at, quá ngưỡng. */
  async findStale(threshold: Date): Promise<DeviceRow[]> {
    return this.db
      .select()
      .from(devices)
      .where(and(inArray(devices.status, ['ACTIVE', 'LOCKED']), lt(devices.last_seen_at, threshold)));
  }
}

/** Escape ký tự đặc biệt của LIKE, để người dùng gõ `%` không thành wildcard. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function toView(row: DeviceRow, enterprise_name: string | null, now = Date.now()): DeviceView {
  return {
    device_id: row.device_id,
    serial_number: row.serial_number,
    device_type: row.device_type,
    model: row.model,
    name: row.name,
    firmware_version: row.firmware_version,
    supplier_name: row.supplier_name,
    enterprise_id: row.enterprise_id,
    enterprise_name,
    status: row.status,
    sold_at: row.sold_at,
    assigned_at: row.assigned_at?.toISOString() ?? null,
    last_seen_at: row.last_seen_at?.toISOString() ?? null,
    is_online: row.last_seen_at ? now - row.last_seen_at.getTime() < OFFLINE_AFTER_MS : false,
    notes: row.notes,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export function toQuotaView(row: QuotaRow): DeviceQuotaView {
  return {
    device_id: row.device_id,
    quota_total: row.quota_total,
    quota_used: row.quota_used,
    quota_remaining: row.quota_remaining,
    remaining_pct: row.quota_total > 0 ? Math.round((row.quota_remaining / row.quota_total) * 1000) / 10 : null,
    warn_threshold_pct: row.warn_threshold_pct,
    package_start_at: row.package_start_at?.toISOString() ?? null,
    package_end_at: row.package_end_at?.toISOString() ?? null,
    is_locked: row.is_locked,
    locked_reason: row.locked_reason,
    locked_at: row.locked_at?.toISOString() ?? null,
    updated_at: row.updated_at.toISOString(),
  };
}

function emptyQuota(device_id: string, updated_at: string): DeviceQuotaView {
  return {
    device_id,
    quota_total: 0,
    quota_used: 0,
    quota_remaining: 0,
    remaining_pct: null,
    warn_threshold_pct: 20,
    package_start_at: null,
    package_end_at: null,
    is_locked: false,
    locked_reason: null,
    locked_at: null,
    updated_at,
  };
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
