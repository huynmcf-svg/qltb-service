import { EX } from '../../../common/swagger/example-values';
import type { DeviceDetailView, DeviceView } from './device.dto';

/**
 * Ví dụ Swagger của module device. Cùng MỘT thiết bị xuyên suốt các endpoint
 * để người đọc lần theo được.
 */
export const EXAMPLE_CREATE_DEVICE = {
  serial_number: EX.serial_number,
  device_type: 'SIGNPAD',
  model: 'SP-200',
  name: 'Máy ký số quầy 1',
  firmware_version: '1.4.2',
  supplier_name: 'Công ty TNHH Thiết bị số Việt',
} as const;

/** Vừa nhập kho — chưa gán, quota rỗng. */
export const EXAMPLE_DEVICE: DeviceView = {
  device_id: EX.device_id,
  ...EXAMPLE_CREATE_DEVICE,
  enterprise_id: null,
  enterprise_name: null,
  status: 'IN_STOCK',
  sold_at: null,
  assigned_at: null,
  last_seen_at: null,
  is_online: false,
  notes: null,
  created_at: EX.earlier,
  updated_at: EX.now,
};

/** Cùng máy đó sau khi đã gán cho doanh nghiệp và đang chạy. */
export const EXAMPLE_DEVICE_ACTIVE: DeviceView = {
  ...EXAMPLE_DEVICE,
  enterprise_id: EX.enterprise_id,
  enterprise_name: EX.enterprise_name,
  status: 'ACTIVE',
  sold_at: '2026-01-15',
  assigned_at: '2026-01-15T03:00:00.000Z',
  last_seen_at: EX.now,
  is_online: true,
};

export const EXAMPLE_DEVICE_DETAIL: DeviceDetailView = {
  ...EXAMPLE_DEVICE_ACTIVE,
  quota: {
    device_id: EX.device_id,
    quota_total: 10_000,
    quota_used: 8_250,
    quota_remaining: 1_750,
    remaining_pct: 17.5,
    warn_threshold_pct: 20,
    package_start_at: '2026-01-15T00:00:00.000Z',
    package_end_at: '2027-01-15T00:00:00.000Z',
    is_locked: false,
    locked_reason: null,
    locked_at: null,
    updated_at: EX.now,
  },
  warranty: {
    warranty_id: EX.warranty_id,
    device_id: EX.device_id,
    enterprise_id: EX.enterprise_id,
    start_date: '2026-01-15',
    end_date: '2027-01-15',
    status: 'ACTIVE',
    source: 'SALE',
    days_remaining: 122,
    notes: null,
    created_at: EX.earlier,
    updated_at: EX.earlier,
  },
};

export const EXAMPLE_UPDATE_DEVICE = {
  firmware_version: '1.5.0',
  notes: 'Đã cập nhật firmware tháng 9/2026',
} as const;

export const EXAMPLE_DEVICE_PAGE = {
  items: [EXAMPLE_DEVICE_ACTIVE, EXAMPLE_DEVICE],
  next_cursor: EX.cursor,
};

export const EXAMPLE_DEVICE_IMPORT = {
  imported: 2,
  in_stock: 1,
  assigned: 1,
  items: [
    { row: 2, device_id: EX.device_id, serial_number: EX.serial_number, status: 'IN_STOCK' },
    { row: 3, device_id: '7c1e2f4a-9b3d-4e6f-8a1b-2c3d4e5f6a7b', serial_number: 'QLTB-24-000124', status: 'ACTIVE' },
  ],
};
