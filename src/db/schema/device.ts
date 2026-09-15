import { date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * Cụm bảng thiết bị.
 *
 * Nguồn: docs/api-contracts.md mục "Thiết bị" và docs/project-overview.md
 * (máy trạng thái). Gồm `device_categories` · `devices` · `device_history`.
 *
 * Ràng buộc KHÔNG khai được bằng Drizzle — viết tay ở migration:
 *   - CHECK trên `devices.status` và `device_history.action`
 *   - trigger chặn UPDATE / DELETE trên `device_history` (append-only)
 * Sau mỗi lần `drizzle-kit generate`, kiểm tra migration mới không drop chúng.
 */

export const DEVICE_STATUSES = ['IN_STOCK', 'IN_USE', 'UNDER_MAINTENANCE', 'DISPOSED'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const DEVICE_HISTORY_ACTIONS = [
  'REGISTER',
  'ASSIGN',
  'RETURN',
  'TRANSFER',
  'MAINTENANCE_START',
  'MAINTENANCE_END',
  'DISPOSE',
] as const;
export type DeviceHistoryAction = (typeof DEVICE_HISTORY_ACTIONS)[number];

/** Loại thiết bị: laptop, màn hình, máy in... Danh mục dùng chung. */
export const device_categories = pgTable(
  'device_categories',
  {
    category_id: uuid('category_id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('device_categories_code_key').on(t.code)],
);

/**
 * Hồ sơ thiết bị — một dòng mỗi thiết bị.
 *
 * `status` và `holder_*` là PROJECTION từ `device_history`: mọi thay đổi đi
 * qua service, ghi lịch sử rồi mới cập nhật cột này. Sửa thẳng cột mà không ghi
 * lịch sử là làm sai lệch kiểm kê về sau.
 */
export const devices = pgTable(
  'devices',
  {
    device_id: uuid('device_id').primaryKey().defaultRandom(),
    /** Mã quản lý do đơn vị đặt, ví dụ LT-0001. Unique — bắt lỗi 23505 → DEVICE_CODE_CONFLICT. */
    code: text('code').notNull(),
    name: text('name').notNull(),
    category_id: uuid('category_id')
      .notNull()
      .references(() => device_categories.category_id),
    brand: text('brand'),
    model: text('model'),
    serial_number: text('serial_number'),
    /** IN_STOCK | IN_USE | UNDER_MAINTENANCE | DISPOSED — CHECK ở migration. */
    status: text('status').$type<DeviceStatus>().notNull().default('IN_STOCK'),
    /** Người / đơn vị đang giữ. NULL khi IN_STOCK hoặc DISPOSED. */
    holder_name: text('holder_name'),
    holder_unit: text('holder_unit'),
    purchased_at: date('purchased_at'),
    warranty_until: date('warranty_until'),
    /** VND, số nguyên. */
    purchase_price: integer('purchase_price'),
    notes: text('notes'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('devices_code_key').on(t.code),
    index('devices_status_created_idx').on(t.status, t.created_at),
    index('devices_category_idx').on(t.category_id),
  ],
);

/**
 * Lịch sử thiết bị — APPEND-ONLY, trigger chặn UPDATE/DELETE ở tầng DB.
 *
 * Mỗi lần cấp, thu hồi, luân chuyển, bảo trì, thanh lý là một dòng mới.
 * `from_status` / `to_status` ghi lại chuyển trạng thái để kiểm kê ngược được.
 * `actor` sẽ lấy từ token khi có auth — không bao giờ từ body.
 */
export const device_history = pgTable(
  'device_history',
  {
    history_id: uuid('history_id').primaryKey().defaultRandom(),
    device_id: uuid('device_id')
      .notNull()
      .references(() => devices.device_id),
    /** REGISTER | ASSIGN | RETURN | TRANSFER | MAINTENANCE_START | MAINTENANCE_END | DISPOSE */
    action: text('action').$type<DeviceHistoryAction>().notNull(),
    from_status: text('from_status').$type<DeviceStatus>(),
    to_status: text('to_status').$type<DeviceStatus>().notNull(),
    holder_name: text('holder_name'),
    holder_unit: text('holder_unit'),
    /** Chi tiết theo action: lý do hỏng, chi phí sửa, biên bản... */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    reason: text('reason'),
    actor_user_id: uuid('actor_user_id'),
    actor_name: text('actor_name'),
    request_id: text('request_id'),
    occurred_at: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('device_history_device_occurred_idx').on(t.device_id, t.occurred_at)],
);
