/**
 * Bảng mã lỗi của hợp đồng REST.
 *
 * Nguồn: docs/api-contracts.md mục "Mã lỗi". Web rẽ nhánh theo `code`, nên
 * thêm mã là đổi hợp đồng — sửa docs/api-contracts.md và `types/api.ts` bên
 * web trong cùng một đợt.
 */
export const ERROR_CODES = [
  /** 400 — body / query sai kiểu, thiếu field, có field lạ. */
  'INVALID_PAYLOAD',
  /** 401 — thiếu / sai token. */
  'AUTHENTICATION_FAILED',
  /** 403 — không đủ quyền. */
  'AUTHORIZATION_FAILED',
  /** 404 — không có bản ghi, hoặc không thuộc phạm vi người gọi. */
  'RESOURCE_NOT_FOUND',
  /** 409 — serial thiết bị đã tồn tại. */
  'DEVICE_SERIAL_CONFLICT',
  /** 409 — chuyển trạng thái thiết bị không hợp lệ. */
  'DEVICE_STATE_CONFLICT',
  /** 409 — mã doanh nghiệp đã tồn tại. */
  'ENTERPRISE_CODE_CONFLICT',
  /** 409 — tên đăng nhập đã tồn tại. */
  'USERNAME_CONFLICT',
  /** 409 — yêu cầu đổi trả không còn PENDING. */
  'EXCHANGE_STATE_CONFLICT',
  /** 409 — cùng Idempotency-Key, khác body. */
  'IDEMPOTENCY_KEY_CONFLICT',
  /** 422 — doanh nghiệp đã đủ max_users tài khoản. */
  'ENTERPRISE_USER_LIMIT',
  /** 422 — phân bổ / trừ vượt sản lượng còn lại. */
  'QUOTA_INSUFFICIENT',
  /** 422 — ghi lượt sử dụng vào máy đang LOCKED. */
  'DEVICE_LOCKED',
  /** 429 — vượt rate-limit. */
  'RATE_LIMITED',
  /** 500 — lỗi không lường. */
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorCode = Object.fromEntries(
  ERROR_CODES.map((code) => [code, code]),
) as { readonly [K in ErrorCode]: K };
