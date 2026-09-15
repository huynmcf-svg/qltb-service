import { EX } from '../../../common/swagger/example-values';
import type { EnterpriseView } from './enterprise.dto';

export const EXAMPLE_CREATE_ENTERPRISE = {
  code: 'VPCC-DA',
  name: 'VPCC Đông Anh',
  tax_code: '0101234567',
  address: 'Thị trấn Đông Anh, Hà Nội',
  phone: '+842438820000',
  email: 'lienhe@vpccdonganh.vn',
  contact_name: 'Nguyễn Văn A',
  max_users: 10,
} as const;

export const EXAMPLE_ENTERPRISE: EnterpriseView = {
  enterprise_id: EX.enterprise_id,
  parent_id: null,
  parent_name: null,
  ...EXAMPLE_CREATE_ENTERPRISE,
  status: 'ACTIVE',
  user_count: 4,
  device_count: 12,
  branch_count: 2,
  created_at: EX.earlier,
  updated_at: EX.now,
};

export const EXAMPLE_BRANCH: EnterpriseView = {
  ...EXAMPLE_ENTERPRISE,
  enterprise_id: 'a1b2c3d4-0000-4000-8000-000000000002',
  parent_id: EX.enterprise_id,
  parent_name: EX.enterprise_name,
  code: 'VPCC-DA-KC',
  name: 'Chi nhánh Kim Chung',
  user_count: 2,
  device_count: 3,
  branch_count: 0,
};

export const EXAMPLE_ENTERPRISE_PAGE = { items: [EXAMPLE_ENTERPRISE, EXAMPLE_BRANCH], next_cursor: null };
