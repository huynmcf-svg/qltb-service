import { EX } from '../../../common/swagger/example-values';
import type { ExchangeView } from './exchange.dto';

export const EXAMPLE_EXCHANGE: ExchangeView = {
  exchange_id: 'd0e1f2a3-0000-4000-8000-000000000010',
  enterprise_id: EX.enterprise_id,
  enterprise_name: EX.enterprise_name,
  old_device_id: EX.device_id,
  old_serial_number: EX.serial_number,
  new_device_id: null,
  new_serial_number: null,
  reason: 'Màn hình cảm ứng liệt',
  status: 'PENDING',
  requested_by: EX.user_id,
  requested_by_name: 'Trần Thị B',
  requested_at: EX.now,
  approved_by: null,
  approved_by_name: null,
  approved_at: null,
  reject_reason: null,
  notes: null,
  created_at: EX.now,
  updated_at: EX.now,
};

export const EXAMPLE_EXCHANGE_APPROVED: ExchangeView = {
  ...EXAMPLE_EXCHANGE,
  new_device_id: 'f6a7b8c9-0000-4000-8000-000000000006',
  new_serial_number: 'QLTB-24-000200',
  status: 'APPROVED',
  approved_by: '11111111-0000-4000-8000-000000000001',
  approved_by_name: 'Quản trị hệ thống',
  approved_at: EX.now,
};
