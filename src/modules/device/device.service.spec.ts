import { addMonths } from './device.service';

describe('addMonths', () => {
  it('cộng đúng tháng', () => {
    expect(addMonths('2026-01-15', 12)).toBe('2027-01-15');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
  });
  it('kẹp ngày cuối tháng', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });
});
