import { EX } from '../../../common/swagger/example-values';
import type { RoleView } from './role.dto';

export const EXAMPLE_ROLE: RoleView = {
  role_id: 'b81f30a2-5c47-4a19-8e63-1d90fa27c4bb',
  code: 'ENTERPRISE_USER',
  name: 'Nhân viên doanh nghiệp',
  description: 'Xem thiết bị, sản lượng, thông báo của doanh nghiệp mình.',
  is_system: true,
  permissions: ['device.read', 'warranty.read', 'quota.read', 'usage.read', 'alert.read', 'exchange.read', 'dashboard.business'],
  user_count: 12,
  created_at: EX.earlier,
  updated_at: EX.earlier,
};

export const EXAMPLE_CUSTOM_ROLE: RoleView = {
  ...EXAMPLE_ROLE,
  role_id: 'c2d3e4f5-0000-4000-8000-000000000003',
  code: 'BRANCH_MANAGER',
  name: 'Trưởng chi nhánh',
  description: 'Xem và tạo yêu cầu đổi trả cho chi nhánh.',
  is_system: false,
  permissions: ['device.read', 'quota.read', 'exchange.read', 'exchange.request'],
  user_count: 0,
};

export const EXAMPLE_PERMISSIONS = {
  items: [
    { code: 'device.read', name: 'Xem thiết bị', group: 'device' },
    { code: 'device.assign', name: 'Gán / thu hồi thiết bị', group: 'device' },
    { code: 'quota.grant', name: 'Cấp sản lượng', group: 'quota' },
  ],
};
