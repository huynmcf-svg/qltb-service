import { validateEnv } from './env.validation';
import { resolveDatabaseUrl, resolvePoolMax } from './configuration';

describe('validateEnv', () => {
  it('ném lỗi khi thiếu cấu hình DB', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  const db = { DB_HOST: 'localhost', DB_USER: 'qltb', DB_NAME: 'qltb' };
  const secret = 'x'.repeat(32);

  it('nhận bộ DB_* rời + JWT secret đủ dài', () => {
    expect(() => validateEnv({ ...db, JWT_ACCESS_SECRET: secret })).not.toThrow();
  });

  it('chặn JWT secret ngắn', () => {
    expect(() => validateEnv({ ...db, JWT_ACCESS_SECRET: 'ngan' })).toThrow(/32 ký tự/);
  });

  it('SameSite=none bắt buộc Secure', () => {
    expect(() =>
      validateEnv({ ...db, JWT_ACCESS_SECRET: secret, REFRESH_COOKIE_SAMESITE: 'none', REFRESH_COOKIE_SECURE: 'false' }),
    ).toThrow(/Secure/i);
  });
});

describe('resolveDatabaseUrl', () => {
  it('DATABASE_URL thắng bộ DB_*', () => {
    expect(
      resolveDatabaseUrl({ DATABASE_URL: 'postgresql://a:b@c:1/d', DB_HOST: 'x' } as NodeJS.ProcessEnv),
    ).toBe('postgresql://a:b@c:1/d');
  });

  it('escape mật khẩu có ký tự đặc biệt', () => {
    expect(
      resolveDatabaseUrl({
        DB_HOST: 'localhost',
        DB_USER: 'qltb',
        DB_PASS: 'p@ss!',
        DB_NAME: 'qltb',
      } as NodeJS.ProcessEnv),
    ).toBe('postgresql://qltb:p%40ss!@localhost:5432/qltb');
  });
});

describe('resolvePoolMax', () => {
  it('local mặc định 5, Vercel mặc định 1, DATABASE_POOL_MAX thắng', () => {
    expect(resolvePoolMax({})).toBe(5);
    expect(resolvePoolMax({ VERCEL: '1' })).toBe(1);
    expect(resolvePoolMax({ VERCEL: '1', DATABASE_POOL_MAX: '3' })).toBe(3);
  });
});
