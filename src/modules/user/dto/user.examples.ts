import { EX } from '../../../common/swagger/example-values';
import type { UserView } from './user.dto';

export const EXAMPLE_ROLE_REF = { role_id: 'b81f30a2-5c47-4a19-8e63-1d90fa27c4bb', code: 'ENTERPRISE_USER', name: 'Nhân viên doanh nghiệp' };

export const EXAMPLE_USER: UserView = {
  user_id: EX.user_id,
  username: 'ketoan.dongdanh',
  email: 'kt@vpccdonganh.vn',
  full_name: 'Trần Thị B',
  phone: '+84912345678',
  enterprise_id: EX.enterprise_id,
  enterprise_name: EX.enterprise_name,
  roles: [EXAMPLE_ROLE_REF],
  status: 'ACTIVE',
  must_change_password: false,
  locked_until: null,
  last_login_at: EX.earlier,
  created_at: EX.earlier,
  updated_at: EX.now,
};

export const EXAMPLE_CREATE_USER = {
  username: 'ketoan.dongdanh',
  full_name: 'Trần Thị B',
  email: 'kt@vpccdonganh.vn',
  phone: '+84912345678',
  enterprise_id: EX.enterprise_id,
  role_ids: [EXAMPLE_ROLE_REF.role_id],
};

export const EXAMPLE_USER_PAGE = { items: [EXAMPLE_USER], next_cursor: null };
