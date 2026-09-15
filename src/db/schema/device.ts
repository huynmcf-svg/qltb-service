import { date, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { enterprises, users } from './system';

/**
 * Cụm thiết bị: thiết bị · bảo hành · đổi trả.
 * Nguồn: docs/api-contracts.md mục 4, 5, 8. CHECK enum ở migration viết tay.
 */

export const DEVICE_STATUSES = ['IN_STOCK', 'ACTIVE', 'LOCKED', 'EXCHANGED', 'RETIRED'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const WARRANTY_STATUSES = ['ACTIVE', 'EXPIRED', 'TRANSFERRED', 'VOID'] as const;
export type WarrantyStatus = (typeof WARRANTY_STATUSES)[number];

export const WARRANTY_SOURCES = ['SALE', 'EXCHANGE', 'EXTENSION'] as const;
export type WarrantySource = (typeof WARRANTY_SOURCES)[number];

export const EXCHANGE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ExchangeStatus = (typeof EXCHANGE_STATUSES)[number];

/**
 * Thiết bị. `enterprise_id = NULL` = chưa gán, còn trong kho.
 * `status` là máy trạng thái (docs/project-overview.md) — mọi thay đổi đi qua
 * `modules/device/device-state.ts`. `last_seen_at` cập nhật khi máy gửi
 * usage log; "offline" suy từ đây, không phải một status.
 */
export const devices = pgTable(
  'devices',
  {
    device_id: uuid('device_id').primaryKey().defaultRandom(),
    /** Định danh từ nhà máy — unique. 23505 → DEVICE_SERIAL_CONFLICT. */
    serial_number: text('serial_number').notNull(),
    device_type: text('device_type').notNull(),
    model: text('model'),
    name: text('name'),
    firmware_version: text('firmware_version'),
    enterprise_id: uuid('enterprise_id').references(() => enterprises.enterprise_id),
    status: text('status').$type<DeviceStatus>().notNull().default('IN_STOCK'),
    /** Ngày bán — ghi lúc assign, mốc kích hoạt bảo hành. */
    sold_at: date('sold_at'),
    assigned_at: timestamp('assigned_at', { withTimezone: true }),
    last_seen_at: timestamp('last_seen_at', { withTimezone: true }),
    /**
     * Khoá API của thiết bị (sha256), cấp lúc assign, hiện MỘT LẦN. Thiết bị gửi
     * `X-Device-Key` khi POST /usage-logs. NULL = chưa cấp / đã thu hồi.
     */
    api_key_hash: text('api_key_hash'),
    notes: text('notes'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('devices_serial_number_key').on(t.serial_number),
    index('devices_enterprise_idx').on(t.enterprise_id),
    index('devices_status_created_idx').on(t.status, t.created_at),
    index('devices_type_idx').on(t.device_type),
    index('devices_last_seen_idx').on(t.last_seen_at),
  ],
);

/**
 * Bảo hành — một máy nhiều lượt (bán lần đầu, gia hạn, chuyển từ máy đổi trả).
 * Chỉ MỘT lượt `ACTIVE` mỗi máy tại một thời điểm — partial unique index ở migration.
 */
export const warranties = pgTable(
  'warranties',
  {
    warranty_id: uuid('warranty_id').primaryKey().defaultRandom(),
    device_id: uuid('device_id')
      .notNull()
      .references(() => devices.device_id),
    /** Chụp lúc tạo — máy thu hồi rồi vẫn biết bảo hành này của DN nào. */
    enterprise_id: uuid('enterprise_id').references(() => enterprises.enterprise_id),
    start_date: date('start_date').notNull(),
    end_date: date('end_date').notNull(),
    status: text('status').$type<WarrantyStatus>().notNull().default('ACTIVE'),
    source: text('source').$type<WarrantySource>().notNull().default('SALE'),
    /** Khi source = EXCHANGE: bảo hành gốc đã chuyển sang. */
    transferred_from_id: uuid('transferred_from_id'),
    notes: text('notes'),
    created_by: uuid('created_by'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('warranties_device_idx').on(t.device_id, t.created_at),
    index('warranties_status_end_idx').on(t.status, t.end_date),
    index('warranties_enterprise_idx').on(t.enterprise_id),
  ],
);

/**
 * Yêu cầu đổi trả máy. `new_device_id` NULL cho tới khi duyệt.
 * Chỉ một yêu cầu PENDING mỗi máy cũ — partial unique index ở migration.
 */
export const device_exchanges = pgTable(
  'device_exchanges',
  {
    exchange_id: uuid('exchange_id').primaryKey().defaultRandom(),
    enterprise_id: uuid('enterprise_id')
      .notNull()
      .references(() => enterprises.enterprise_id),
    old_device_id: uuid('old_device_id')
      .notNull()
      .references(() => devices.device_id),
    new_device_id: uuid('new_device_id').references(() => devices.device_id),
    reason: text('reason').notNull(),
    status: text('status').$type<ExchangeStatus>().notNull().default('PENDING'),
    requested_by: uuid('requested_by')
      .notNull()
      .references(() => users.user_id),
    requested_at: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    approved_by: uuid('approved_by').references(() => users.user_id),
    approved_at: timestamp('approved_at', { withTimezone: true }),
    reject_reason: text('reject_reason'),
    notes: text('notes'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('device_exchanges_enterprise_status_idx').on(t.enterprise_id, t.status),
    index('device_exchanges_old_device_idx').on(t.old_device_id),
    index('device_exchanges_requested_idx').on(t.requested_at),
  ],
);
