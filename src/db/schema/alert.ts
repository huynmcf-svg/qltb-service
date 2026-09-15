import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { devices } from './device';
import { enterprises, users } from './system';

/**
 * Cụm cảnh báo · thông báo. Nguồn: docs/api-contracts.md mục 7.
 * Một alert → nhiều notification (mỗi người nhận một dòng).
 */

export const ALERT_TYPES = [
  'QUOTA_BELOW_20',
  'QUOTA_BELOW_10',
  'QUOTA_EXHAUSTED',
  'WARRANTY_30D',
  'WARRANTY_15D',
  'WARRANTY_7D',
  'WARRANTY_EXPIRED',
  'DEVICE_OFFLINE',
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

/**
 * `dedupe_key` + unique (device_id, type, dedupe_key): job quét chạy mỗi giờ
 * không được phát lại cùng một cảnh báo. Với bảo hành, key = end_date; với
 * quota, key = mốc gói (package_start_at) hoặc mốc cấp gần nhất.
 */
export const alerts = pgTable(
  'alerts',
  {
    alert_id: uuid('alert_id').primaryKey().defaultRandom(),
    device_id: uuid('device_id')
      .notNull()
      .references(() => devices.device_id),
    enterprise_id: uuid('enterprise_id').references(() => enterprises.enterprise_id),
    type: text('type').$type<AlertType>().notNull(),
    severity: text('severity').$type<AlertSeverity>().notNull(),
    message: text('message').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    dedupe_key: text('dedupe_key').notNull(),
    occurred_at: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    resolved_at: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('alerts_device_type_dedupe_key').on(t.device_id, t.type, t.dedupe_key),
    index('alerts_enterprise_occurred_idx').on(t.enterprise_id, t.occurred_at),
    index('alerts_type_severity_idx').on(t.type, t.severity),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    notification_id: uuid('notification_id').primaryKey().defaultRandom(),
    alert_id: uuid('alert_id')
      .notNull()
      .references(() => alerts.alert_id),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.user_id),
    title: text('title').notNull(),
    body: text('body').notNull(),
    read_at: timestamp('read_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user_created_idx').on(t.user_id, t.created_at),
    index('notifications_user_unread_idx').on(t.user_id, t.read_at),
    uniqueIndex('notifications_alert_user_key').on(t.alert_id, t.user_id),
  ],
);
