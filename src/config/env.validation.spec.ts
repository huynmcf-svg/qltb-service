import { validateEnv } from './env.validation';
import { resolveDatabaseUrl } from './configuration';

describe('validateEnv', () => {
  it('ném lỗi khi thiếu cấu hình DB', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('nhận bộ DB_* rời', () => {
    expect(() =>
      validateEnv({ DB_HOST: 'localhost', DB_USER: 'qltb', DB_NAME: 'qltb' }),
    ).not.toThrow();
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
