import { decodeCursor, encodeCursor } from './pagination.dto';

describe('cursor', () => {
  it('encode rồi decode ra đúng payload', () => {
    const payload = { ts: '2026-09-15T06:30:00.000Z', id: 'abc' };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it('chấp nhận khoá sắp xếp không phải ngày (danh sách sắp theo tên)', () => {
    const payload = { ts: 'Laptop Dell', id: 'abc' };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it('trả null cho cursor rác', () => {
    expect(decodeCursor('khong-phai-base64-json')).toBeNull();
    expect(decodeCursor(Buffer.from('{"ts":""}').toString('base64url'))).toBeNull();
  });
});
