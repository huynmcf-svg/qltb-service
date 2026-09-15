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
  const invalid: string[] = [];

  if (!resolveDatabaseUrl(raw as NodeJS.ProcessEnv)) {
    missing.push('DATABASE_URL (hoặc bộ DB_HOST / DB_USER / DB_NAME)');
  }

  // Không có mặc định là có chủ đích: thà service không khởi động được còn
  // hơn chạy bằng một secret ai cũng đoán ra.
  const secret = String(raw.JWT_ACCESS_SECRET ?? '');
  if (!secret.trim()) missing.push('JWT_ACCESS_SECRET');
  else if (secret.length < 32) invalid.push('JWT_ACCESS_SECRET phải dài ít nhất 32 ký tự');

  const sameSite = String(raw.REFRESH_COOKIE_SAMESITE ?? 'lax');
  if (!['lax', 'strict', 'none'].includes(sameSite)) {
    invalid.push('REFRESH_COOKIE_SAMESITE chỉ nhận lax | strict | none');
  }
  // SameSite=None mà không Secure thì trình duyệt bỏ cookie — chỉ lộ trên trình duyệt thật.
  if (sameSite === 'none' && String(raw.REFRESH_COOKIE_SECURE ?? 'true') === 'false') {
    invalid.push('REFRESH_COOKIE_SAMESITE=none bắt buộc REFRESH_COOKIE_SECURE=true');
  }

  if (missing.length || invalid.length) {
    const lines = [
      missing.length ? `Thiếu biến môi trường: ${missing.join(', ')}` : '',
      ...invalid,
      'Xem .env.example.',
    ].filter(Boolean);
    throw new Error(lines.join('\n'));
  }

  return raw;
}
