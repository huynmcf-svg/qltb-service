import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser, NoEnvelope, RequirePermissions } from '../../common/decorators';
import { AppException } from '../../common/errors/app.exception';
import { ApiAuthErrors, ApiValidationError } from '../../common/swagger/api-envelope';
import { EnterpriseRepository } from '../enterprise/enterprise.repository';
import { DeviceRepository } from '../device/device.repository';
import { ListDevicesDto } from '../device/dto/device.dto';
import { QuotaRepository } from '../quota/quota.repository';
import { ListEnterprisesDto } from '../enterprise/dto/enterprise.dto';

class ReportFormatDto {
  @ApiPropertyOptional({ enum: ['xlsx'], default: 'xlsx', description: 'PDF chưa hỗ trợ — cần font tiếng Việt nhúng, chốt sau' })
  @IsOptional() @IsIn(['xlsx', 'pdf']) format?: 'xlsx' | 'pdf';
}
class DevicesReportDto extends ListDevicesDto {
  @ApiPropertyOptional({ enum: ['xlsx'], default: 'xlsx' }) @IsOptional() @IsIn(['xlsx', 'pdf']) format?: 'xlsx' | 'pdf';
}
class EnterprisesReportDto extends ListEnterprisesDto {
  @ApiPropertyOptional({ enum: ['xlsx'], default: 'xlsx' }) @IsOptional() @IsIn(['xlsx', 'pdf']) format?: 'xlsx' | 'pdf';
}
class QuotaReportDto extends ReportFormatDto {
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() enterprise_id?: string;
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ok = (description: string) => ApiResponse({ status: 200, description, content: { [XLSX]: { example: '(file .xlsx)' } } });

/**
 * Báo cáo trả FILE, không envelope (`@NoEnvelope`). Hiện chỉ `xlsx`; `pdf`
 * → 400 cho tới khi chốt font tiếng Việt. Tối đa 5.000 dòng mỗi báo cáo.
 */
@ApiTags('reports')
@ApiBearerAuth()
@NoEnvelope()
@Controller('reports')
export class ReportController {
  constructor(
    private readonly devices: DeviceRepository,
    private readonly enterprises: EnterpriseRepository,
    private readonly quotas: QuotaRepository,
  ) {}

  @Get('devices')
  @RequirePermissions('report.export')
  @ApiProduces(XLSX)
  @ApiOperation({ summary: 'Xuất danh sách thiết bị', description: 'Bộ lọc như `GET /devices`. Trả file `.xlsx` (`Content-Disposition: attachment`), **không envelope**. Tối đa 5.000 dòng; theo phạm vi người gọi.' })
  @ok('File xlsx.') @ApiValidationError() @ApiAuthErrors()
  async devicesReport(@Query() query: DevicesReportDto, @CurrentUser() actor: AuthenticatedUser, @Res() res: Response) {
    assertXlsx(query.format);
    const rows = await collect((cursor) => this.devices.list({ ...query, cursor, limit: 200 }, actor.scope));
    await send(res, 'thiet-bi', 'Thiết bị', [
      ['Serial', 'serial_number', 20], ['Loại', 'device_type', 12], ['Model', 'model', 14], ['Tên', 'name', 24], ['Doanh nghiệp', 'enterprise_name', 28],
      ['Trạng thái', 'status', 14], ['Ngày bán', 'sold_at', 12], ['Lần cuối thấy', 'last_seen_at', 22], ['Firmware', 'firmware_version', 10], ['Ghi chú', 'notes', 30],
    ], rows);
  }

  @Get('quota')
  @RequirePermissions('report.export')
  @ApiProduces(XLSX)
  @ApiOperation({ summary: 'Báo cáo sản lượng', description: 'Ba sheet: **Sản lượng** (từng máy: tổng / đã dùng / còn lại), **Lượt cấp** và **Lượt dùng** trong `from`–`to` (mặc định 30 ngày). Lọc `enterprise_id`. Trả `.xlsx`, không envelope.' })
  @ok('File xlsx.') @ApiValidationError() @ApiAuthErrors()
  async quotaReport(@Query() query: QuotaReportDto, @CurrentUser() actor: AuthenticatedUser, @Res() res: Response) {
    assertXlsx(query.format);
    const from = query.from ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
    const to = query.to ?? new Date().toISOString();
    const quotas = await collect((cursor) => this.quotas.list({ enterprise_id: query.enterprise_id, cursor, limit: 200 }, actor.scope));
    const usage = await collect((cursor) => this.quotas.listUsage({ enterprise_id: query.enterprise_id, from, to, cursor, limit: 200 }, actor.scope));
    const grants = (await Promise.all(quotas.slice(0, 500).map((q) => this.quotas.listGrants(q.device_id, { limit: 200 }).then((p) => p.items.map((g) => ({ ...g, serial_number: q.serial_number })))))).flat()
      .filter((g) => g.granted_at >= from && g.granted_at <= to);

    const wb = new ExcelJS.Workbook();
    addSheet(wb, 'Sản lượng', [
      ['Serial', 'serial_number', 20], ['Máy', 'device_name', 24], ['Doanh nghiệp', 'enterprise_name', 28], ['Trạng thái', 'device_status', 12],
      ['Tổng', 'quota_total', 12], ['Đã dùng', 'quota_used', 12], ['Còn lại', 'quota_remaining', 12], ['Còn %', 'remaining_pct', 8],
      ['Khoá', 'is_locked', 8], ['Lý do khoá', 'locked_reason', 18], ['Hết gói', 'package_end_at', 22],
    ], quotas);
    addSheet(wb, 'Lượt cấp', [['Serial', 'serial_number', 20], ['Số lượng', 'amount', 12], ['Tổng sau cấp', 'total_after', 14], ['Người cấp', 'granted_by_name', 24], ['Ghi chú', 'note', 30], ['Thời điểm', 'granted_at', 22]], grants);
    addSheet(wb, 'Lượt dùng', [['Serial', 'serial_number', 20], ['client_ref', 'client_ref', 30], ['Số lượng', 'amount', 10], ['Giờ máy', 'used_at', 22], ['Giờ server', 'received_at', 22], ['Bị từ chối', 'rejected', 10], ['Còn lại sau', 'remaining_after', 12]], usage);
    await finish(res, wb, 'san-luong');
  }

  @Get('enterprises')
  @RequirePermissions('report.export')
  @ApiProduces(XLSX)
  @ApiOperation({ summary: 'Xuất danh sách doanh nghiệp', description: 'Bộ lọc như `GET /enterprises`. Trả `.xlsx`, không envelope.' })
  @ok('File xlsx.') @ApiValidationError() @ApiAuthErrors()
  async enterprisesReport(@Query() query: EnterprisesReportDto, @CurrentUser() actor: AuthenticatedUser, @Res() res: Response) {
    assertXlsx(query.format);
    const rows = await collect((cursor) => this.enterprises.list({ ...query, cursor, limit: 200 }, actor.scope));
    await send(res, 'doanh-nghiep', 'Doanh nghiệp', [
      ['Mã', 'code', 14], ['Tên', 'name', 30], ['Thuộc', 'parent_name', 24], ['Mã số thuế', 'tax_code', 14], ['Địa chỉ', 'address', 36], ['Điện thoại', 'phone', 14], ['Email', 'email', 24],
      ['Liên hệ', 'contact_name', 20], ['Trạng thái', 'status', 12], ['Tài khoản', 'user_count', 10], ['Hạn mức TK', 'max_users', 10], ['Thiết bị', 'device_count', 10], ['Chi nhánh', 'branch_count', 10],
    ], rows);
  }
}

function assertXlsx(format?: string): void {
  if (format && format !== 'xlsx') throw AppException.invalidPayload('Hiện chỉ hỗ trợ format=xlsx (PDF chốt sau)', { violations: ['format'] });
}

/** Gom mọi trang cursor, trần 5.000 dòng. */
async function collect<T>(page: (cursor?: string) => Promise<{ items: T[]; next_cursor: string | null }>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const p = await page(cursor);
    out.push(...p.items);
    cursor = p.next_cursor ?? undefined;
  } while (cursor && out.length < 5000);
  return out.slice(0, 5000);
}

type Col = [header: string, key: string, width: number];

function addSheet(wb: ExcelJS.Workbook, name: string, cols: Col[], rows: object[]): void {
  const ws = wb.addWorksheet(name);
  ws.columns = cols.map(([header, key, width]) => ({ header, key, width }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const row of rows) ws.addRow(Object.fromEntries(cols.map(([, key]) => [key, fmt((row as Record<string, unknown>)[key])])));
}

function fmt(v: unknown): unknown {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Có' : 'Không';
  return v;
}

async function send(res: Response, file: string, sheet: string, cols: Col[], rows: object[]): Promise<void> {
  const wb = new ExcelJS.Workbook();
  addSheet(wb, sheet, cols, rows);
  await finish(res, wb, file);
}

async function finish(res: Response, wb: ExcelJS.Workbook, file: string): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', XLSX);
  res.setHeader('Content-Disposition', `attachment; filename="${file}-${stamp}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}
