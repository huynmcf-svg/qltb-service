import { redact } from './app-logger.service';

describe('redact', () => {
  it('che khoá nhạy cảm ở mọi độ sâu', () => {
    expect(
      redact({ username: 'a', password: 'x', nested: { Authorization: 'Bearer y', ok: 1 } }),
    ).toEqual({ username: 'a', password: '[redacted]', nested: { Authorization: '[redacted]', ok: 1 } });
  });

  it('giữ nguyên giá trị nguyên thuỷ', () => {
    expect(redact('text')).toBe('text');
    expect(redact(null)).toBeNull();
  });
});
