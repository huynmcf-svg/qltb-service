/**
 * Giá trị dùng chung cho mọi ví dụ trên Swagger.
 *
 * Dùng chung một bộ id có chủ đích: người đọc tài liệu lần theo được cùng một
 * thiết bị qua `POST /devices` → `GET /devices/{id}` → `GET /devices/{id}/warranties`,
 * thay vì mỗi trang một uuid ngẫu nhiên khác nhau.
 *
 * Đây là dữ liệu GIẢ để minh hoạ. Đừng đưa giá trị thật của bất kỳ môi trường nào.
 */
export const EX = {
  device_id: '3f2b7c14-9d8e-4a55-b0c1-6e2f8a9d3b47',
  serial_number: 'QLTB-24-000123',
  enterprise_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  enterprise_name: 'VPCC Đông Anh',
  user_id: '0e53c527-5e5b-4666-890e-9c31afb9f1af',
  warranty_id: 'c5ffa5a2-4626-494a-b498-96d0d5d8298e',
  /** Cursor là chuỗi MỜ — web không được tự sinh hay tự đọc. */
  cursor: 'eyJ0cyI6IjIwMjYtMDktMTVUMDY6MzA6MDAuMDAwWiIsImlkIjoiM2YyYjdjMTQifQ',
  /** RFC 3339, UTC — như mọi timestamp khác của hệ thống. */
  now: '2026-09-15T06:30:00.000Z',
  earlier: '2026-09-15T02:48:10.000Z',
} as const;
