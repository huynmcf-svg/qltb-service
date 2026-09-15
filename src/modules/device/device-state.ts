import type { DeviceStatus } from '../../db/schema';

/**
 * Máy trạng thái thiết bị — MỘT chỗ duy nhất (docs/project-overview.md).
 *
 *   IN_STOCK ──ASSIGN──▶ ACTIVE ──LOCK──▶ LOCKED
 *      ▲                   │ ▲              │
 *      │ UNASSIGN          │ └────UNLOCK────┘
 *      └───────────────────┴────────────────┘   (UNASSIGN từ cả ACTIVE lẫn LOCKED)
 *   ACTIVE / LOCKED ──EXCHANGE──▶ EXCHANGED (terminal, máy cũ trong đổi trả)
 *   IN_STOCK ──RETIRE──▶ RETIRED (terminal)
 *
 * Tách ra file thuần để test không cần Nest lẫn DB. Bộ trạng thái này đặc tả
 * chưa chốt — xem "Còn phải chốt" trong api-contracts.md.
 */
export const DEVICE_ACTIONS = ['ASSIGN', 'UNASSIGN', 'LOCK', 'UNLOCK', 'EXCHANGE', 'RETIRE'] as const;
export type DeviceAction = (typeof DEVICE_ACTIONS)[number];

const TRANSITIONS: Record<DeviceAction, Partial<Record<DeviceStatus, DeviceStatus>>> = {
  ASSIGN: { IN_STOCK: 'ACTIVE' },
  UNASSIGN: { ACTIVE: 'IN_STOCK', LOCKED: 'IN_STOCK' },
  LOCK: { ACTIVE: 'LOCKED' },
  UNLOCK: { LOCKED: 'ACTIVE' },
  EXCHANGE: { ACTIVE: 'EXCHANGED', LOCKED: 'EXCHANGED' },
  RETIRE: { IN_STOCK: 'RETIRED' },
};

/** Trạng thái đích nếu hợp lệ, `null` nếu không. */
export function nextStatus(current: DeviceStatus, action: DeviceAction): DeviceStatus | null {
  return TRANSITIONS[action][current] ?? null;
}

/** Lý do dễ hiểu cho web hiện khi bị từ chối. */
export function transitionHint(current: DeviceStatus, action: DeviceAction): string {
  if (current === 'EXCHANGED' || current === 'RETIRED') return 'Thiết bị đã kết thúc vòng đời, không thao tác được nữa';
  if (action === 'ASSIGN') return 'Chỉ gán được thiết bị đang trong kho';
  if (action === 'UNASSIGN') return 'Thiết bị chưa được gán cho doanh nghiệp nào';
  if (action === 'LOCK') return 'Chỉ khoá được thiết bị đang hoạt động';
  if (action === 'UNLOCK') return 'Thiết bị không ở trạng thái khoá';
  if (action === 'RETIRE') return 'Chỉ thanh lý được thiết bị đang trong kho — thu hồi trước';
  return `Không thể ${action} khi thiết bị đang ${current}`;
}
