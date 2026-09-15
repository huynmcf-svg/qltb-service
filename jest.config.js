/**
 * Hai nhóm test:
 *
 *   - `*.spec.ts` — unit, chạy được ở mọi nơi, không cần DB. CI luôn chạy nhóm này.
 *   - `*.e2e-spec.ts` — tích hợp, CẦN PostgreSQL. Tự bỏ qua khi không có
 *     `RUN_DB_TESTS=1`, để `npm test` trên máy chưa có DB không đỏ vì lý do
 *     không liên quan tới code.
 *
 * Chạy đủ cả hai:  npm run test:db
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  testTimeout: 30_000,
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
};
