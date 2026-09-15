import { resolveDatabaseUrl } from './configuration';

/**
 * Kiểm biến môi trường lúc khởi động, fail-fast.
 *
 * Nest gọi hàm này trước khi dựng bất kỳ provider nào. Thiếu cấu hình thì
 * process chết ngay với thông báo rõ ràng — tốt hơn nhiều so với lên tới lúc
 * request đầu tiên mới phát hiện không có chuỗi kết nối DB.
 */
export function validateEnv(raw: Record<string, unknown>): Record<string, unknown> {
  const missing: string[] = [];

  if (!resolveDatabaseUrl(raw as NodeJS.ProcessEnv)) {
    missing.push('DATABASE_URL (hoặc bộ DB_HOST / DB_USER / DB_NAME)');
  }

  if (missing.length) {
    throw new Error(`Thiếu biến môi trường: ${missing.join(', ')}\nXem .env.example.`);
  }

  return raw;
}
