import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/**
 * Cụm hệ thống: doanh nghiệp · người dùng · vai trò · quyền · audit.
 *
 * Nguồn: docs/spec/qltb-spec.md mục "Các quan hệ" và docs/api-contracts.md
 * mục 1–3, 11. Ràng buộc KHÔNG khai được bằng Drizzle — viết tay ở migration
 * `0001_constraints_and_guards.sql`: CHECK enum, trigger append-only cho
 * `audit_logs`, trigger `updated_at`.
 */

export const ENTERPRISE_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type EnterpriseStatus = (typeof ENTERPRISE_STATUSES)[number];

export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * Doanh nghiệp. `parent_id` tự tham chiếu: doanh nghiệp cha – chi nhánh con,
 * tối đa 2 cấp (service kiểm, DB không ép được độ sâu bằng constraint thường).
 * `max_users`: mỗi doanh nghiệp được miễn phí 10 tài khoản (đặc tả).
 */
export const enterprises = pgTable(
  'enterprises',
  {
    enterprise_id: uuid('enterprise_id').primaryKey().defaultRandom(),
    parent_id: uuid('parent_id').references((): AnyPgColumn => enterprises.enterprise_id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    tax_code: text('tax_code'),
    address: text('address'),
    phone: text('phone'),
    email: text('email'),
    contact_name: text('contact_name'),
    status: text('status').$type<EnterpriseStatus>().notNull().default('ACTIVE'),
    max_users: integer('max_users').notNull().default(10),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('enterprises_code_key').on(t.code),
    index('enterprises_parent_idx').on(t.parent_id),
    index('enterprises_status_idx').on(t.status),
  ],
);

/**
 * Người dùng. `enterprise_id = NULL` là quản trị viên hệ thống.
 * Vai trò gán qua `users_roles` (N-N), không có cột role ở đây.
 * `deleted_at`: DELETE /users là soft delete — audit log vẫn trỏ được về người.
 */
export const users = pgTable(
  'users',
  {
    user_id: uuid('user_id').primaryKey().defaultRandom(),
    enterprise_id: uuid('enterprise_id').references(() => enterprises.enterprise_id),
    username: text('username').notNull(),
    email: text('email'),
    full_name: text('full_name').notNull(),
    phone: text('phone'),
    /** argon2id. Không bao giờ trả ra API. */
    password_hash: text('password_hash').notNull(),
    status: text('status').$type<UserStatus>().notNull().default('ACTIVE'),
    must_change_password: boolean('must_change_password').notNull().default(false),
    failed_login_count: integer('failed_login_count').notNull().default(0),
    locked_until: timestamp('locked_until', { withTimezone: true }),
    /** Quên mật khẩu: chỉ lưu HASH của token, có hạn. */
    password_reset_token_hash: text('password_reset_token_hash'),
    password_reset_expires_at: timestamp('password_reset_expires_at', { withTimezone: true }),
    last_login_at: timestamp('last_login_at', { withTimezone: true }),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
    created_by: uuid('created_by'),
    updated_by: uuid('updated_by'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_username_key').on(t.username),
    index('users_enterprise_idx').on(t.enterprise_id),
    index('users_status_idx').on(t.status),
  ],
);

/** Vai trò. `is_system = true` (SYSTEM_ADMIN…) không sửa / xoá được qua API. */
export const roles = pgTable(
  'roles',
  {
    role_id: uuid('role_id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    is_system: boolean('is_system').notNull().default(false),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('roles_code_key').on(t.code)],
);

/**
 * Quyền — danh mục cố định, seed từ `modules/permission/permission.catalog.ts`.
 * `group` = nhóm chức năng (auth · user · enterprise · device · quota…).
 */
export const permissions = pgTable(
  'permissions',
  {
    permission_id: uuid('permission_id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    group: text('group').notNull(),
    description: text('description'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('permissions_code_key').on(t.code), index('permissions_group_idx').on(t.group)],
);

export const users_roles = pgTable(
  'users_roles',
  {
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.user_id),
    role_id: uuid('role_id')
      .notNull()
      .references(() => roles.role_id),
    assigned_by: uuid('assigned_by'),
    assigned_at: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.user_id, t.role_id] }), index('users_roles_role_idx').on(t.role_id)],
);

export const roles_permissions = pgTable(
  'roles_permissions',
  {
    role_id: uuid('role_id')
      .notNull()
      .references(() => roles.role_id),
    permission_id: uuid('permission_id')
      .notNull()
      .references(() => permissions.permission_id),
  },
  (t) => [primaryKey({ columns: [t.role_id, t.permission_id] })],
);

/**
 * Nhật ký kiểm toán — APPEND-ONLY, trigger chặn UPDATE/DELETE.
 * `old_values` / `new_values` theo đặc tả. `actor_*` LUÔN lấy từ token.
 * `enterprise_id` = doanh nghiệp BỊ TÁC ĐỘNG, để người dùng DN chỉ xem được của mình.
 */
export const audit_logs = pgTable(
  'audit_logs',
  {
    audit_id: uuid('audit_id').primaryKey().defaultRandom(),
    enterprise_id: uuid('enterprise_id'),
    /** NULL khi không có người: login thất bại, job hệ thống. */
    actor_user_id: uuid('actor_user_id'),
    actor_username: text('actor_username'),
    /** Nhóm chức năng: device · quota · user · enterprise · exchange… */
    module: text('module').notNull(),
    /** DEVICE_ASSIGN, QUOTA_GRANT, USER_DISABLE… — UPPER_SNAKE_CASE. */
    action: text('action').notNull(),
    resource_type: text('resource_type').notNull(),
    resource_id: text('resource_id'),
    old_values: jsonb('old_values').$type<Record<string, unknown>>(),
    new_values: jsonb('new_values').$type<Record<string, unknown>>(),
    request_id: text('request_id'),
    ip: text('ip'),
    user_agent: text('user_agent'),
    occurred_at: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_enterprise_occurred_idx').on(t.enterprise_id, t.occurred_at),
    index('audit_logs_actor_idx').on(t.actor_user_id),
    index('audit_logs_module_action_idx').on(t.module, t.action),
    index('audit_logs_resource_idx').on(t.resource_type, t.resource_id),
  ],
);

/**
 * Một dòng cho MỖI refresh token đã phát, không phải một dòng mỗi phiên.
 *
 * Refresh token xoay sau mỗi lần dùng, và yêu cầu là phát hiện dùng lại thẻ
 * cũ. Nếu chỉ giữ một dòng rồi ghi đè hash thì thẻ cũ tra không ra. `session_id`
 * gom các thẻ cùng một phiên thành một họ; phát hiện dùng lại thì huỷ cả họ.
 *
 * Chỉ lưu HASH (sha256). Plaintext không lưu, không log, không trả qua API.
 */
export const user_sessions = pgTable(
  'user_sessions',
  {
    session_token_id: uuid('session_token_id').primaryKey().defaultRandom(),
    /** Định danh họ token — giữ nguyên qua mọi lần xoay. */
    session_id: uuid('session_id').notNull(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.user_id),
    refresh_token_hash: text('refresh_token_hash').notNull(),
    issued_at: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Đã dùng để xoay. Dùng lần thứ hai là dấu hiệu bị đánh cắp. */
    used_at: timestamp('used_at', { withTimezone: true }),
    revoked_at: timestamp('revoked_at', { withTimezone: true }),
    /** LOGOUT | ROTATED | REUSE_DETECTED | USER_DISABLED | PASSWORD_CHANGED */
    revoked_reason: text('revoked_reason'),
    replaced_by: uuid('replaced_by'),
    ip: text('ip'),
    user_agent: text('user_agent'),
  },
  (t) => [
    uniqueIndex('user_sessions_refresh_hash_key').on(t.refresh_token_hash),
    index('user_sessions_session_idx').on(t.session_id),
    index('user_sessions_user_idx').on(t.user_id),
  ],
);

/**
 * Lưu kết quả của POST có side effect theo `Idempotency-Key`.
 * Cùng key + cùng body → trả lại kết quả cũ. Cùng key + khác body → 409.
 * Unique trên (actor_user_id, idempotency_key): key của người này không đụng người kia.
 */
export const idempotency_keys = pgTable(
  'idempotency_keys',
  {
    idempotency_id: uuid('idempotency_id').primaryKey().defaultRandom(),
    idempotency_key: text('idempotency_key').notNull(),
    actor_user_id: uuid('actor_user_id').notNull(),
    endpoint: text('endpoint').notNull(),
    request_hash: text('request_hash').notNull(),
    response_status: integer('response_status').notNull(),
    response_body: jsonb('response_body').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('idempotency_keys_actor_key').on(t.actor_user_id, t.idempotency_key)],
);
