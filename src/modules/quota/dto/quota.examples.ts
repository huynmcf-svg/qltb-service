import { EX } from '../../../common/swagger/example-values';
import { EXAMPLE_DEVICE_DETAIL } from '../../device/dto/device.examples';
import type { QuotaAllocationView, QuotaGrantView, UsageLogView } from './quota.dto';
import type { QuotaFullView } from '../quota.repository';

export const EXAMPLE_QUOTA_FULL: QuotaFullView = {
  ...EXAMPLE_DEVICE_DETAIL.quota,
  serial_number: EX.serial_number,
  device_name: 'Máy ký số quầy 1',
  device_status: 'ACTIVE',
  enterprise_id: EX.enterprise_id,
  enterprise_name: EX.enterprise_name,
};

export const EXAMPLE_QUOTA_PAGE = { items: [EXAMPLE_QUOTA_FULL], next_cursor: null };

export const EXAMPLE_GRANT: QuotaGrantView = {
  grant_id: 'd4e5f6a7-0000-4000-8000-000000000004',
  device_id: EX.device_id,
  amount: 5000,
  total_after: 15000,
  granted_by: EX.user_id,
  granted_by_name: 'Quản trị hệ thống',
  note: 'Gói bổ sung Q4/2026',
  granted_at: EX.now,
};

export const EXAMPLE_ALLOCATION: QuotaAllocationView = {
  allocation_id: 'e5f6a7b8-0000-4000-8000-000000000005',
  from_enterprise_id: EX.enterprise_id,
  from_enterprise_name: EX.enterprise_name,
  to_enterprise_id: 'a1b2c3d4-0000-4000-8000-000000000002',
  to_enterprise_name: 'Chi nhánh Kim Chung',
  from_device_id: EX.device_id,
  from_serial_number: EX.serial_number,
  device_id: 'f6a7b8c9-0000-4000-8000-000000000006',
  serial_number: 'QLTB-24-000200',
  amount: 1000,
  allocated_by: EX.user_id,
  allocated_by_name: 'Trần Thị B',
  note: null,
  allocated_at: EX.now,
};

export const EXAMPLE_USAGE: UsageLogView = {
  usage_id: 'a7b8c9d0-0000-4000-8000-000000000007',
  device_id: EX.device_id,
  serial_number: EX.serial_number,
  client_ref: 'dev-000123-20260915-0042',
  amount: 1,
  used_at: '2026-09-15T06:20:00.000Z',
  received_at: '2026-09-15T06:20:03.000Z',
  rejected: false,
  remaining_after: 1749,
  meta: {},
};

export const EXAMPLE_USAGE_PAGE = { items: [EXAMPLE_USAGE], next_cursor: EX.cursor };
