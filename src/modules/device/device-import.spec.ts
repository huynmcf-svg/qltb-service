import ExcelJS from 'exceljs';
import { buildImportTemplate, IMPORT_SHEET, ImportFileError, parseImportFile, toYmd } from './device-import';

/** Lấy file mẫu, điền `rows` vào sheet nhập liệu, trả buffer như người dùng đẩy lên. */
async function fileWith(rows: unknown[][]): Promise<Buffer> {
  const wb = buildImportTemplate();
  const ws = wb.getWorksheet(IMPORT_SHEET)!;
  rows.forEach((values, i) => {
    values.forEach((v, j) => {
      ws.getCell(i + 2, j + 1).value = v as ExcelJS.CellValue;
    });
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('nhập thiết bị từ Excel', () => {
  it('file mẫu đọc lại được và không có dòng dữ liệu', async () => {
    const { rows, errors } = await parseImportFile(await fileWith([]));
    expect(rows).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('đọc dòng hợp lệ, nhận loại theo tên, serial viết hoa, ngày Excel', async () => {
    const { rows, errors } = await parseImportFile(
      await fileWith([
        ['qltb-24-000123', 'Máy ký số', 'SP-200', 'Quầy 1', '1.4.2', 'Công ty A', 'DN001', new Date(Date.UTC(2026, 0, 15)), 24, 'ghi chú'],
        [],
        ['QLTB-24-000124', 'PRINTER'],
      ]),
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { row: 2, serial_number: 'QLTB-24-000123', device_type: 'SIGNPAD', model: 'SP-200', name: 'Quầy 1', firmware_version: '1.4.2', supplier_name: 'Công ty A', customer_code: 'DN001', sold_at: '2026-01-15', warranty_months: 24, notes: 'ghi chú' },
      { row: 4, serial_number: 'QLTB-24-000124', device_type: 'PRINTER' },
    ]);
  });

  it('báo lỗi theo dòng và cột', async () => {
    const { errors } = await parseImportFile(
      await fileWith([
        ['AB', 'XYZ'],
        ['QLTB-1', 'SIGNPAD', '', '', '', '', '', '2026-13-01'],
        ['QLTB-2', 'SIGNPAD', '', '', '', '', 'DN001', '', 999],
      ]),
    );
    expect(errors).toEqual([
      { row: 2, column: 'Serial', message: expect.any(String) },
      { row: 2, column: 'Loại thiết bị', message: expect.stringContaining('XYZ') },
      { row: 3, column: 'Ngày bán', message: expect.any(String) },
      { row: 4, column: 'Số tháng bảo hành', message: expect.any(String) },
    ]);
  });

  it('thiếu cột bắt buộc là lỗi cả file', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet(IMPORT_SHEET).addRow(['Model', 'Tên gợi nhớ']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(parseImportFile(buf)).rejects.toBeInstanceOf(ImportFileError);
  });

  it('file không phải xlsx là lỗi cả file', async () => {
    await expect(parseImportFile(Buffer.from('serial,type\n'))).rejects.toBeInstanceOf(ImportFileError);
  });

  it('toYmd nhận ISO và dd/mm/yyyy, từ chối ngày không có thật', () => {
    expect(toYmd('2026-02-28')).toBe('2026-02-28');
    expect(toYmd('5/3/2026')).toBe('2026-03-05');
    expect(toYmd('2026-02-30')).toBeNull();
    expect(toYmd('hôm qua')).toBeNull();
    expect(toYmd(46037)).toBe('2026-01-15');
  });
});
