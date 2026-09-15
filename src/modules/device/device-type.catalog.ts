/**
 * Danh mục loại thiết bị — đặc tả chưa chốt, tạm cố định trong code và
 * phát ra qua `GET /devices/types` để web dựng select. Thêm loại = thêm dòng.
 */
export const DEVICE_TYPES = [
  { code: 'SIGNPAD', name: 'Máy ký số' },
  { code: 'PRINTER', name: 'Máy in' },
  { code: 'SCANNER', name: 'Máy quét' },
  { code: 'TABLET', name: 'Máy tính bảng' },
  { code: 'KIOSK', name: 'Kiosk' },
  { code: 'OTHER', name: 'Khác' },
] as const;
export type DeviceTypeCode = (typeof DEVICE_TYPES)[number]['code'];
