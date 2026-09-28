import ExcelJS from 'exceljs';
import { DEVICE_TYPES } from './device-type.catalog';

/**
 * File Excel nhập thiết bị hàng loạt: dựng file mẫu và đọc file người dùng
 * đẩy lên. Chỉ parse + kiểm từng ô ở đây (không đụng DB) — trùng serial trong
 * hệ thống, mã khách hàng có tồn tại hay không là việc của service.
 */

export const IMPORT_SHEET = 'Thiết bị';
/** Trần số dòng một lần nhập — quá thì chia file. */
export const IMPORT_MAX_ROWS = 1000;
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const DEFAULT_WARRANTY_MONTHS = 12;

type ColumnKey =
  | 'serial_number'
  | 'device_type'
  | 'model'
  | 'name'
  | 'firmware_version'
  | 'supplier_name'
  | 'customer_code'
  | 'sold_at'
  | 'warranty_months'
  | 'notes';

interface ColumnSpec {
  key: ColumnKey;
  header: string;
  required: boolean;
  width: number;
  hint: string;
}

/** Thứ tự cột của file mẫu. Khi đọc, cột được nhận theo TIÊU ĐỀ, không theo vị trí. */
export const IMPORT_COLUMNS: ColumnSpec[] = [
  { key: 'serial_number', header: 'Serial', required: true, width: 20, hint: 'Bắt buộc. Chữ hoa, số, gạch ngang, 4–64 ký tự. Không trùng máy đã có.' },
  { key: 'device_type', header: 'Loại thiết bị', required: true, width: 16, hint: 'Bắt buộc. Mã hoặc tên loại ở sheet "Loại thiết bị" (vd. SIGNPAD hoặc Máy ký số).' },
  { key: 'model', header: 'Model', required: false, width: 14, hint: 'Tối đa 100 ký tự.' },
  { key: 'name', header: 'Tên gợi nhớ', required: false, width: 24, hint: 'Tối đa 200 ký tự.' },
  { key: 'firmware_version', header: 'Firmware', required: false, width: 12, hint: 'Tối đa 50 ký tự.' },
  { key: 'supplier_name', header: 'Nhà cung cấp', required: false, width: 30, hint: 'Nơi sản xuất / cấp máy. Tối đa 200 ký tự.' },
  { key: 'customer_code', header: 'Mã khách hàng', required: false, width: 16, hint: 'Mã doanh nghiệp đã mua máy. Bỏ trống = máy còn trong kho.' },
  { key: 'sold_at', header: 'Ngày bán', required: false, width: 14, hint: 'Chỉ dùng khi có mã khách hàng. Định dạng YYYY-MM-DD hoặc ô ngày của Excel. Mặc định hôm nay.' },
  { key: 'warranty_months', header: 'Số tháng bảo hành', required: false, width: 18, hint: 'Chỉ dùng khi có mã khách hàng. Số nguyên 0–120, mặc định 12, 0 = không tạo bảo hành.' },
  { key: 'notes', header: 'Ghi chú', required: false, width: 30, hint: 'Tối đa 2000 ký tự.' },
];

export interface ImportRow {
  /** Số dòng trong Excel (tính cả dòng tiêu đề) — để báo lỗi đúng chỗ người dùng nhìn. */
  row: number;
  serial_number: string;
  device_type: string;
  model?: string;
  name?: string;
  firmware_version?: string;
  supplier_name?: string;
  customer_code?: string;
  sold_at?: string;
  warranty_months?: number;
  notes?: string;
}

export interface ImportError {
  row: number;
  column: string | null;
  message: string;
}

/** File mẫu: sheet nhập liệu (chỉ tiêu đề) + hướng dẫn + danh mục loại thiết bị. */
export function buildImportTemplate(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();

  const ws = wb.addWorksheet(IMPORT_SHEET);
  ws.columns = IMPORT_COLUMNS.map((c) => ({ header: c.required ? `${c.header} (*)` : c.header, key: c.key, width: c.width }));
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.eachCell((cell, col) => {
    const spec = IMPORT_COLUMNS[col - 1];
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: spec?.required ? 'FFFCE4D6' : 'FFE7EEF7' } };
    if (spec) cell.note = spec.hint;
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  // Ô Serial / Ngày bán để kiểu chữ, Excel khỏi tự đổi "0012" thành 12 hay đổi ngày theo locale.
  for (const key of ['serial_number', 'sold_at'] as const) ws.getColumn(key).numFmt = '@';

  const types = wb.addWorksheet('Loại thiết bị');
  types.columns = [{ header: 'Mã', key: 'code', width: 14 }, { header: 'Tên', key: 'name', width: 24 }];
  types.getRow(1).font = { bold: true };
  for (const t of DEVICE_TYPES) types.addRow(t);

  const typeList = `'Loại thiết bị'!$A$2:$A$${DEVICE_TYPES.length + 1}`;
  const typeCol = IMPORT_COLUMNS.findIndex((c) => c.key === 'device_type') + 1;
  for (let r = 2; r <= IMPORT_MAX_ROWS + 1; r++) {
    ws.getCell(r, typeCol).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [typeList],
      showErrorMessage: false,
    };
  }

  const guide = wb.addWorksheet('Hướng dẫn');
  guide.columns = [{ header: 'Cột', key: 'header', width: 20 }, { header: 'Bắt buộc', key: 'required', width: 10 }, { header: 'Cách điền', key: 'hint', width: 90 }];
  guide.getRow(1).font = { bold: true };
  for (const c of IMPORT_COLUMNS) guide.addRow({ header: c.header, required: c.required ? 'Có' : '', hint: c.hint });
  guide.addRow({});
  guide.addRow({ header: 'Lưu ý', hint: `Điền dữ liệu ở sheet "${IMPORT_SHEET}", từ dòng 2. Tối đa ${IMPORT_MAX_ROWS} dòng mỗi file. Không đổi tên dòng tiêu đề.` });
  guide.addRow({ hint: 'Nếu có bất kỳ dòng nào sai, hệ thống KHÔNG lưu dòng nào và trả danh sách lỗi theo số dòng — sửa rồi đẩy lại cả file.' });
  guide.addRow({ hint: 'Máy có mã khách hàng được gán luôn cho khách đó (tạo bảo hành). API key của máy cấp sau ở trang chi tiết thiết bị.' });
  guide.addRow({});
  guide.addRow({ header: 'Ví dụ', hint: 'QLTB-24-000123 | SIGNPAD | SP-200 | Máy ký số quầy 1 | 1.4.2 | Công ty TNHH Thiết bị số Việt | DN001 | 2026-01-15 | 12 |' });

  return wb;
}

/**
 * Đọc file người dùng đẩy lên. Trả các dòng hợp lệ về mặt định dạng và lỗi
 * theo từng ô. Dòng trống hoàn toàn bị bỏ qua. Ném `ImportFileError` khi file
 * không phải xlsx hoặc thiếu cột bắt buộc — lỗi cả file, không phải lỗi dòng.
 */
export async function parseImportFile(buffer: Buffer): Promise<{ rows: ImportRow[]; errors: ImportError[] }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ImportFileError('Không đọc được file — hãy dùng file .xlsx tải từ mẫu');
  }
  const ws = wb.getWorksheet(IMPORT_SHEET) ?? wb.worksheets[0];
  if (!ws) throw new ImportFileError('File không có sheet nào');

  const colOf = new Map<ColumnKey, number>();
  ws.getRow(1).eachCell((cell, col) => {
    const title = normalizeHeader(cellText(cell.value));
    const spec = IMPORT_COLUMNS.find((c) => normalizeHeader(c.header) === title);
    if (spec && !colOf.has(spec.key)) colOf.set(spec.key, col);
  });
  const missing = IMPORT_COLUMNS.filter((c) => c.required && !colOf.has(c.key)).map((c) => c.header);
  if (missing.length) throw new ImportFileError(`Thiếu cột bắt buộc: ${missing.join(', ')}. Hãy dùng đúng file mẫu`, { missing_columns: missing });

  const rows: ImportRow[] = [];
  const errors: ImportError[] = [];
  let dataRows = 0;
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const raw = new Map<ColumnKey, unknown>();
    for (const [key, col] of colOf) raw.set(key, row.getCell(col).value);
    const text = (key: ColumnKey) => cellText(raw.get(key));
    if (IMPORT_COLUMNS.every((c) => text(c.key) === '')) continue;
    if (++dataRows > IMPORT_MAX_ROWS) throw new ImportFileError(`File vượt quá ${IMPORT_MAX_ROWS} dòng — chia thành nhiều file`, { max_rows: IMPORT_MAX_ROWS });

    const fail = (key: ColumnKey, message: string) => errors.push({ row: r, column: header(key), message });
    const out: ImportRow = { row: r, serial_number: '', device_type: '' };

    const serial = text('serial_number').toUpperCase();
    if (!serial) fail('serial_number', 'Bắt buộc');
    else if (!/^[A-Z0-9-]{4,64}$/.test(serial)) fail('serial_number', 'Chỉ gồm chữ hoa, số, gạch ngang (4–64 ký tự)');
    out.serial_number = serial;

    const typeText = text('device_type');
    const type = DEVICE_TYPES.find((t) => t.code === typeText.toUpperCase() || t.name.toLowerCase() === typeText.toLowerCase());
    if (!typeText) fail('device_type', 'Bắt buộc');
    else if (!type) fail('device_type', `Không có loại "${typeText}" — xem sheet "Loại thiết bị"`);
    out.device_type = type?.code ?? typeText;

    const limits: Array<[ColumnKey & keyof ImportRow, number]> = [['model', 100], ['name', 200], ['firmware_version', 50], ['supplier_name', 200], ['notes', 2000], ['customer_code', 50]];
    for (const [key, max] of limits) {
      const v = text(key);
      if (!v) continue;
      if (v.length > max) fail(key, `Tối đa ${max} ký tự`);
      (out as unknown as Record<string, string>)[key] = v;
    }

    const soldRaw = raw.get('sold_at');
    if (text('sold_at')) {
      const sold = toYmd(soldRaw);
      if (!sold) fail('sold_at', 'Ngày không hợp lệ — dùng YYYY-MM-DD');
      else out.sold_at = sold;
    }

    const monthsText = text('warranty_months');
    if (monthsText) {
      const n = Number(monthsText);
      if (!Number.isInteger(n) || n < 0 || n > 120) fail('warranty_months', 'Số nguyên từ 0 đến 120');
      else out.warranty_months = n;
    }

    if (!out.customer_code && (out.sold_at || out.warranty_months !== undefined)) {
      fail('customer_code', 'Có ngày bán / số tháng bảo hành thì phải có mã khách hàng');
    }

    rows.push(out);
  }
  return { rows, errors };
}

/** Lỗi cả file (sai định dạng, thiếu cột, quá nhiều dòng) — khác lỗi từng dòng. */
export class ImportFileError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

function header(key: ColumnKey): string {
  return IMPORT_COLUMNS.find((c) => c.key === key)?.header ?? key;
}

/** "Serial (*)" / " serial " → "serial". */
function normalizeHeader(v: string): string {
  return v.replace(/\(\*\)/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Giá trị ô ExcelJS (chuỗi, số, ngày, rich text, công thức, link) → chuỗi đã trim. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { richText?: Array<{ text: string }>; result?: unknown; text?: unknown; error?: string };
    if (Array.isArray(o.richText)) return o.richText.map((p) => p.text).join('').trim();
    if ('result' in o) return cellText(o.result);
    if ('text' in o) return cellText(o.text);
    return '';
  }
  return String(v).trim();
}

/**
 * Ô ngày của Excel (Date, UTC), số serial ngày của Excel (ô ngày dán vào cột
 * định dạng chữ), hoặc chuỗi YYYY-MM-DD / DD/MM/YYYY → YYYY-MM-DD, sai → null.
 */
export function toYmd(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || v < 1 || v > 2_958_465) return null;
    return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);
  }
  const s = cellText(v);
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const vn = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (vn) [d, m, y] = [Number(vn[1]), Number(vn[2]), Number(vn[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}
