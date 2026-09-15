import { nextStatus } from './device-state';

describe('máy trạng thái thiết bị', () => {
  it('gán chỉ từ IN_STOCK', () => {
    expect(nextStatus('IN_STOCK', 'ASSIGN')).toBe('ACTIVE');
    expect(nextStatus('ACTIVE', 'ASSIGN')).toBeNull();
    expect(nextStatus('LOCKED', 'ASSIGN')).toBeNull();
  });

  it('thu hồi từ cả ACTIVE lẫn LOCKED về kho', () => {
    expect(nextStatus('ACTIVE', 'UNASSIGN')).toBe('IN_STOCK');
    expect(nextStatus('LOCKED', 'UNASSIGN')).toBe('IN_STOCK');
    expect(nextStatus('IN_STOCK', 'UNASSIGN')).toBeNull();
  });

  it('khoá / mở khoá chỉ khi đang gán', () => {
    expect(nextStatus('ACTIVE', 'LOCK')).toBe('LOCKED');
    expect(nextStatus('LOCKED', 'UNLOCK')).toBe('ACTIVE');
    expect(nextStatus('IN_STOCK', 'LOCK')).toBeNull();
  });

  it('thanh lý chỉ từ kho, không thanh lý máy đang gán', () => {
    expect(nextStatus('IN_STOCK', 'RETIRE')).toBe('RETIRED');
    expect(nextStatus('ACTIVE', 'RETIRE')).toBeNull();
  });

  it('EXCHANGED và RETIRED là trạng thái cuối', () => {
    for (const s of ['EXCHANGED', 'RETIRED'] as const) {
      for (const a of ['ASSIGN', 'UNASSIGN', 'LOCK', 'UNLOCK', 'EXCHANGE', 'RETIRE'] as const) {
        expect(nextStatus(s, a)).toBeNull();
      }
    }
  });
});
