import type { DeviceHistoryAction, DeviceStatus } from '../../db/schema';

/**
 * Máy trạng thái thiết bị — MỘT chỗ duy nhất (docs/project-overview.md).
 *
 *   IN_STOCK ──ASSIGN──▶ IN_USE ──RETURN──▶ IN_STOCK
 *      │                   │
 *      │ MAINTENANCE_START │ MAINTENANCE_START
 *      ▼                   ▼
 *   UNDER_MAINTENANCE ──MAINTENANCE_END──▶ IN_STOCK
 *      │
 *      │ DISPOSE
 *      ▼
 *   DISPOSED (terminal)
 *
 * IN_USE không DISPOSE thẳng được — phải RETURN trước, để hồ sơ ghi rõ ai đang
 * giữ lúc thanh lý. Tách ra file thuần để test không cần Nest lẫn DB.
 */
const TRANSITIONS: Record<DeviceHistoryAction, Partial<Record<DeviceStatus, DeviceStatus>>> = {
  REGISTER: {},
  ASSIGN: { IN_STOCK: 'IN_USE' },
  RETURN: { IN_USE: 'IN_STOCK' },
  TRANSFER: { IN_USE: 'IN_USE' },
  MAINTENANCE_START: { IN_STOCK: 'UNDER_MAINTENANCE', IN_USE: 'UNDER_MAINTENANCE' },
  MAINTENANCE_END: { UNDER_MAINTENANCE: 'IN_STOCK' },
  DISPOSE: { IN_STOCK: 'DISPOSED', UNDER_MAINTENANCE: 'DISPOSED' },
};

/** Trạng thái đích nếu hợp lệ, `null` nếu không. */
export function nextStatus(current: DeviceStatus, action: DeviceHistoryAction): DeviceStatus | null {
  return TRANSITIONS[action][current] ?? null;
}

/** Lý do dễ hiểu cho web hiện khi bị từ chối. */
export function transitionHint(current: DeviceStatus, action: DeviceHistoryAction): string {
  if (current === 'DISPOSED') return 'Thiết bị đã thanh lý, không thao tác được nữa';
  if (action === 'DISPOSE' && current === 'IN_USE') return 'Thu hồi thiết bị trước khi thanh lý';
  if (action === 'ASSIGN' && current !== 'IN_STOCK') return 'Chỉ cấp phát được thiết bị đang trong kho';
  if (action === 'RETURN' && current !== 'IN_USE') return 'Thiết bị không ở trạng thái đang sử dụng';
  return `Không thể ${action} khi thiết bị đang ${current}`;
}
