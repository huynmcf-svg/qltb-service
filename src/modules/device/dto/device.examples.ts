import { EX } from '../../../common/swagger/example-values';
import type { DeviceView } from './device.dto';

/**
 * Ví dụ Swagger của module device. Cùng MỘT thiết bị xuyên suốt các endpoint
 * để người đọc lần theo được.
 */
export const EXAMPLE_CREATE_DEVICE = {
  code: 'LT-0001',
  name: 'Laptop Dell Latitude 5540',
  category_id: EX.category_id,
  brand: 'Dell',
  model: 'Latitude 5540',
  serial_number: '5CG3210XYZ',
  purchased_at: '2026-01-15',
  warranty_until: '2029-01-15',
  purchase_price: 25_000_000,
} as const;

export const EXAMPLE_DEVICE: DeviceView = {
  device_id: EX.device_id,
  ...EXAMPLE_CREATE_DEVICE,
  category_name: 'Laptop',
  status: 'IN_STOCK',
  holder_name: null,
  holder_unit: null,
  notes: null,
  created_at: EX.earlier,
  updated_at: EX.now,
};

export const EXAMPLE_UPDATE_DEVICE = {
  notes: 'Đã thay pin tháng 8/2026',
} as const;

export const EXAMPLE_DEVICE_PAGE = {
  items: [EXAMPLE_DEVICE],
  next_cursor: EX.cursor,
};
