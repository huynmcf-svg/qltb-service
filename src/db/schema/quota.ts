import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { devices } from './device';
import { enterprises, users } from './system';

/**
 * Cụm sản lượng (quota). Nguồn: docs/api-contracts.md mục 6.
 *
 * `device_quotas` là PROJECTION; `quota_grants` / `quota_allocations` /
 * `usage_logs` là lịch sử append-only (trigger ở migration). Bất biến:
 *   quota_remaining = quota_total − quota_used ≥ 0   (CHECK ở migration)
 * Mọi thay đổi sản lượng: một transaction ghi lịch sử + cập nhật projection.
 */

const amount = (name: string) => bigint(name, { mode: 'number' });

/** Một dòng mỗi thiết bị, tạo cùng lúc với thiết bị (rỗng). */
export const device_quotas = pgTable(
  'device_quotas',
  {
    device_id: uuid('device_id')
      .primaryKey()
      .references(() => devices.device_id),
    quota_total: amount('quota_total').notNull().default(0),
    quota_used: amount('quota_used').notNull().default(0),
    quota_remaining: amount('quota_remaining').notNull().default(0),
    /** Phần trăm còn lại bắt đầu cảnh báo (mặc định 20). */
    warn_threshold_pct: integer('warn_threshold_pct').notNull().default(20),
    package_start_at: timestamp('package_start_at', { withTimezone: true }),
    package_end_at: timestamp('package_end_at', { withTimezone: true }),
    is_locked: boolean('is_locked').notNull().default(false),
    /** QUOTA_EXHAUSTED | PACKAGE_EXPIRED | MANUAL */
    locked_reason: text('locked_reason'),
    locked_at: timestamp('locked_at', { withTimezone: true }),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('device_quotas_locked_idx').on(t.is_locked), index('device_quotas_package_end_idx').on(t.package_end_at)],
);

/** Lịch sử LƯỢT CẤP — cộng dồn vào quota_total. Append-only. */
export const quota_grants = pgTable(
  'quota_grants',
  {
    grant_id: uuid('grant_id').primaryKey().defaultRandom(),
    device_id: uuid('device_id')
      .notNull()
      .references(() => devices.device_id),
    amount: amount('amount').notNull(),
    /** Số dư sau cấp — để đối chiếu projection về sau. */
    total_after: amount('total_after').notNull(),
    granted_by: uuid('granted_by').references(() => users.user_id),
    note: text('note'),
    /** Khoá idempotent của POST /quotas/{id}/grants. */
    idempotency_key: text('idempotency_key'),
    request_id: text('request_id'),
    granted_at: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('quota_grants_device_granted_idx').on(t.device_id, t.granted_at),
    uniqueIndex('quota_grants_idempotency_key').on(t.idempotency_key),
  ],
);

/** Phân bổ sản lượng cha → chi nhánh, cho một máy. Append-only. */
export const quota_allocations = pgTable(
  'quota_allocations',
  {
    allocation_id: uuid('allocation_id').primaryKey().defaultRandom(),
    from_enterprise_id: uuid('from_enterprise_id')
      .notNull()
      .references(() => enterprises.enterprise_id),
    to_enterprise_id: uuid('to_enterprise_id')
      .notNull()
      .references(() => enterprises.enterprise_id),
    /** Máy NHẬN (thuộc chi nhánh `to_enterprise_id`). */
    device_id: uuid('device_id')
      .notNull()
      .references(() => devices.device_id),
    /** Máy CHO (thuộc `from_enterprise_id`) — sản lượng chuyển từ máy này sang. */
    from_device_id: uuid('from_device_id')
      .notNull()
      .references(() => devices.device_id),
    amount: amount('amount').notNull(),
    allocated_by: uuid('allocated_by').references(() => users.user_id),
    note: text('note'),
    idempotency_key: text('idempotency_key'),
    request_id: text('request_id'),
    allocated_at: timestamp('allocated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('quota_allocations_from_idx').on(t.from_enterprise_id, t.allocated_at),
    index('quota_allocations_to_idx').on(t.to_enterprise_id, t.allocated_at),
    index('quota_allocations_device_idx').on(t.device_id, t.allocated_at),
    uniqueIndex('quota_allocations_idempotency_key').on(t.idempotency_key),
  ],
);

/**
 * Lượt sử dụng do thiết bị gửi — trừ dần quota_remaining. Append-only.
 *
 * `client_ref` do thiết bị sinh, unique theo máy: lượt gửi bù sau khi mất
 * mạng không bị trừ hai lần. `used_at` (giờ máy) ≠ `received_at` (giờ server)
 * — hai cột riêng, cả hai NOT NULL. `rejected = true` khi vượt còn lại hoặc
 * máy đang khoá: vẫn ghi để biết máy đã cố dùng.
 */
export const usage_logs = pgTable(
  'usage_logs',
  {
    usage_id: uuid('usage_id').primaryKey().defaultRandom(),
    device_id: uuid('device_id')
      .notNull()
      .references(() => devices.device_id),
    client_ref: text('client_ref').notNull(),
    amount: amount('amount').notNull().default(1),
    used_at: timestamp('used_at', { withTimezone: true }).notNull(),
    received_at: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    rejected: boolean('rejected').notNull().default(false),
    /** Số dư sau lượt này (null nếu rejected). */
    remaining_after: amount('remaining_after'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    request_id: text('request_id'),
  },
  (t) => [
    uniqueIndex('usage_logs_device_client_ref_key').on(t.device_id, t.client_ref),
    index('usage_logs_device_used_idx').on(t.device_id, t.used_at),
    index('usage_logs_used_idx').on(t.used_at),
  ],
);
