/**
 * Cấu hình đọc từ biến môi trường. KHÔNG chứa giá trị nhạy cảm mặc định —
 * secret chỉ nằm ở .env (local) và secret của môi trường triển khai.
 */
export interface AppConfig {
  port: number;
  nodeEnv: string;
  database: { url: string; poolMax: number; connectTimeoutMs: number };
  corsOrigins: string[];
  swagger: { enabled: boolean };
}

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Chấp nhận cả `DATABASE_URL` lẫn bộ `DB_HOST` / `DB_PORT` / `DB_USER` /
 * `DB_PASS` / `DB_NAME`. `DATABASE_URL` thắng nếu có cả hai.
 *
 * Mật khẩu phải `encodeURIComponent` — ký tự đặc biệt không escape sẽ làm URL
 * parse ra sai host.
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const { DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME } = env;
  if (!DB_HOST || !DB_USER || !DB_NAME) return '';
  const auth = `${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASS ?? '')}`;
  return `postgresql://${auth}@${DB_HOST}:${DB_PORT ?? '5432'}/${DB_NAME}`;
}

/**
 * `SWAGGER_ENABLED` thắng nếu khai; không khai thì bật ở mọi môi trường TRỪ
 * production.
 */
export function resolveSwaggerEnabled(env: NodeJS.ProcessEnv): boolean {
  if (env.SWAGGER_ENABLED !== undefined) return env.SWAGGER_ENABLED === 'true';
  return env.NODE_ENV !== 'production';
}

/**
 * Vercel chạy Nest như một Function: nhiều instance, mỗi cái một Pool.
 * Mặc định 1 kết nối — Neon free hết `max_connections` rất nhanh nếu giữ 5.
 */
export function resolvePoolMax(env: NodeJS.ProcessEnv = process.env): number {
  return int(env.DATABASE_POOL_MAX, env.VERCEL ? 1 : 5);
}

export const configuration = (): AppConfig => ({
  port: int(process.env.PORT, 3400),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  database: {
    url: resolveDatabaseUrl(),
    poolMax: resolvePoolMax(),
    connectTimeoutMs: int(process.env.DATABASE_CONNECT_TIMEOUT_MS, 10_000),
  },
  corsOrigins: (process.env.CORS_ORIGINS ?? '*')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  swagger: {
    enabled: resolveSwaggerEnabled(process.env),
  },
});
