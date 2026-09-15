/**
 * Biến môi trường cho test. Chạy trước mọi file test.
 *
 * `validateEnv` bắt buộc có chuỗi DB — test Swagger dựng AppModule nhưng không
 * mở kết nối (Pool của pg lazy), nên một URL giả là đủ.
 */
process.env.NODE_ENV = 'test';
process.env.DB_HOST ??= 'localhost';
process.env.DB_PORT ??= '5432';
process.env.DB_USER ??= 'qltb';
process.env.DB_PASS ??= 'test-only';
process.env.DB_NAME ??= 'qltb_test';

// Test tích hợp chỉ chạy khi được bật rõ ràng — xem jest.config.js.
if (process.env.RUN_DB_TESTS === '1') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config();
}
// Auth: secret cố định cho test, không phải giá trị của môi trường nào.
process.env.JWT_ACCESS_SECRET ??= 'test-only-secret-khong-dung-o-dau-khac-32+';
process.env.REFRESH_COOKIE_SECURE ??= 'false';
