import { nextStatus } from './device-state';

describe('máy trạng thái thiết bị', () => {
  it('cấp phát chỉ từ IN_STOCK', () => {
    expect(nextStatus('IN_STOCK', 'ASSIGN')).toBe('IN_USE');
    expect(nextStatus('IN_USE', 'ASSIGN')).toBeNull();
    expect(nextStatus('UNDER_MAINTENANCE', 'ASSIGN')).toBeNull();
  });

  it('không thanh lý thẳng thiết bị đang IN_USE', () => {
    expect(nextStatus('IN_USE', 'DISPOSE')).toBeNull();
    expect(nextStatus('IN_STOCK', 'DISPOSE')).toBe('DISPOSED');
    expect(nextStatus('UNDER_MAINTENANCE', 'DISPOSE')).toBe('DISPOSED');
  });

  it('DISPOSED là trạng thái cuối', () => {
    for (const action of ['ASSIGN', 'RETURN', 'MAINTENANCE_START', 'MAINTENANCE_END', 'DISPOSE'] as const) {
      expect(nextStatus('DISPOSED', action)).toBeNull();
    }
  });

  it('bảo trì xong về kho, không về tay người giữ cũ', () => {
    expect(nextStatus('IN_USE', 'MAINTENANCE_START')).toBe('UNDER_MAINTENANCE');
    expect(nextStatus('UNDER_MAINTENANCE', 'MAINTENANCE_END')).toBe('IN_STOCK');
  });
});
