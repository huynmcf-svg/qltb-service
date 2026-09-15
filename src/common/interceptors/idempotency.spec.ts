import { hashBody } from './idempotency.interceptor';

describe('hashBody', () => {
  it('không phụ thuộc thứ tự field', () => {
    expect(hashBody({ a: 1, b: { c: [1, 2] } })).toBe(hashBody({ b: { c: [1, 2] }, a: 1 }));
  });
  it('khác giá trị là khác hash', () => {
    expect(hashBody({ amount: 100 })).not.toBe(hashBody({ amount: 101 }));
  });
});
