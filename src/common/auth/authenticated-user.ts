import type { Permission } from '../../modules/permission/permission.catalog';

/**
 * Danh tính của người gọi, dựng từ ACCESS TOKEN + nạp lại từ DB mỗi request —
 * không bao giờ từ body. Mọi bản ghi audit lấy actor từ đây.
 */
export interface AuthenticatedUser {
  user_id: string;
  username: string;
  full_name: string;
  /** NULL = quản trị hệ thống, thấy toàn bộ. */
  enterprise_id: string | null;
  enterprise_name: string | null;
  roles: string[];
  permissions: Permission[];
  /**
   * Phạm vi dữ liệu: doanh nghiệp mình + chi nhánh con. `null` = toàn hệ thống.
   * Repository lọc theo mảng này, không bao giờ theo query string.
   */
  scope: string[] | null;
  must_change_password: boolean;
  session_id: string;
}

/** Payload JWT. Chỉ mang định danh — quyền nạp lại từ DB, không tin token. */
export interface AccessTokenPayload {
  sub: string;
  username: string;
  session_id: string;
  iat?: number;
  exp?: number;
  iss?: string;
}
