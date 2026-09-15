import { EX } from '../../../common/swagger/example-values';
import type { SessionUser } from '../auth.service';

/** Cùng MỘT tài khoản xuyên suốt: admin hệ thống (enterprise_id = null). */
export const EXAMPLE_SESSION_USER: SessionUser = {
  user_id: EX.user_id,
  username: 'admin',
  full_name: 'Quản trị hệ thống',
  email: null,
  phone: null,
  enterprise_id: null,
  enterprise_name: null,
  roles: ['SYSTEM_ADMIN'],
  permissions: ['device.read', 'device.create', 'device.update', 'device.assign', 'quota.grant', '…'],
  must_change_password: false,
};

export const EXAMPLE_LOGIN_RESPONSE = {
  access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwZTUzYzUyNy...',
  expires_in: 900,
  user: EXAMPLE_SESSION_USER,
};

export const EXAMPLE_LOGIN_REQUEST = { username: 'admin', password: 'Admin@2026' };
export const EXAMPLE_CHANGE_PASSWORD = { current_password: 'Admin@2026', new_password: 'MatKhauMoi#2026' };
export const EXAMPLE_UPDATE_PROFILE = { full_name: 'Nguyễn Văn A', email: 'a@vpcc.vn', phone: '+84912345678' };
