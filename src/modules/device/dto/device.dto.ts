import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { CursorPaginationDto } from '../../../common/dto/pagination.dto';
import { DEVICE_STATUSES, type DeviceStatus, type WarrantySource, type WarrantyStatus } from '../../../db/schema';

/**
 * DTO giữ `snake_case` như hợp đồng (docs/api-contracts.md mục 4).
 * `status` / `enterprise_id` KHÔNG nằm trong Create / Update — đổi trạng thái
 * đi qua assign / unassign / status, để máy trạng thái ở service là đường duy nhất.
 */
export class ListDevicesDto extends CursorPaginationDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  enterprise_id?: string;

  @ApiPropertyOptional({ example: 'SIGNPAD' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  device_type?: string;

  @ApiPropertyOptional({ enum: DEVICE_STATUSES })
  @IsOptional()
  @IsIn(DEVICE_STATUSES)
  status?: DeviceStatus;

  /** Lọc gần đúng theo nhà cung cấp. */
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplier_name?: string;

  /** Tìm theo `serial_number` / `name` / `model`, không phân biệt hoa thường. */
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class CreateDeviceDto {
  /** Serial từ nhà máy: chữ hoa, số, gạch ngang. Unique. */
  @ApiProperty({ example: 'QLTB-24-000123', pattern: '^[A-Z0-9-]{4,64}$' })
  @IsString()
  @Matches(/^[A-Z0-9-]{4,64}$/, { message: 'serial_number chỉ gồm chữ hoa, số, gạch ngang (4–64 ký tự)' })
  serial_number!: string;

  /** Mã loại thiết bị, UPPER_SNAKE_CASE. Danh mục chưa chốt — tạm tự do. */
  @ApiProperty({ example: 'SIGNPAD' })
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/, { message: 'device_type là UPPER_SNAKE_CASE' })
  device_type!: string;

  @ApiPropertyOptional({ example: 'SP-200' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @ApiPropertyOptional({ example: 'Máy ký số quầy 1' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiPropertyOptional({ example: '1.4.2' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  firmware_version?: string;

  /** Nhà cung cấp — nơi sản xuất / cấp máy. */
  @ApiPropertyOptional({ example: 'Công ty TNHH Thiết bị số Việt' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplier_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/** Sửa hồ sơ. Không đổi `serial_number` — định danh nhà máy. */
export class UpdateDeviceDto {
  @ApiPropertyOptional({ example: 'SP-200' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @ApiPropertyOptional({ example: 'Máy ký số quầy 1' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiPropertyOptional({ example: '1.5.0' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  firmware_version?: string;

  /** Nhà cung cấp — nơi sản xuất / cấp máy. */
  @ApiPropertyOptional({ example: 'Công ty TNHH Thiết bị số Việt' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplier_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/** Resource `Device` — khớp docs/api-contracts.md. */
export interface DeviceView {
  device_id: string;
  serial_number: string;
  device_type: string;
  model: string | null;
  name: string | null;
  firmware_version: string | null;
  /** Nhà cung cấp (nơi sản xuất / cấp máy). */
  supplier_name: string | null;
  /** Khách hàng — doanh nghiệp đã mua máy. */
  enterprise_id: string | null;
  enterprise_name: string | null;
  status: DeviceStatus;
  sold_at: string | null;
  assigned_at: string | null;
  last_seen_at: string | null;
  /** `last_seen_at` trong ngưỡng offline (24 h). */
  is_online: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeviceQuotaView {
  device_id: string;
  quota_total: number;
  quota_used: number;
  quota_remaining: number;
  remaining_pct: number | null;
  warn_threshold_pct: number;
  package_start_at: string | null;
  package_end_at: string | null;
  is_locked: boolean;
  locked_reason: string | null;
  locked_at: string | null;
  updated_at: string;
}

export interface WarrantyView {
  warranty_id: string;
  device_id: string;
  enterprise_id: string | null;
  start_date: string;
  end_date: string;
  status: WarrantyStatus;
  source: WarrantySource;
  days_remaining: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Chi tiết = Device + quota + bảo hành đang ACTIVE (hoặc null). */
export interface DeviceDetailView extends DeviceView {
  quota: DeviceQuotaView;
  warranty: WarrantyView | null;
}

export class AssignDeviceDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() enterprise_id!: string;
  /** Ngày bán, YYYY-MM-DD. Mặc định hôm nay. */
  @ApiPropertyOptional({ format: 'date', example: '2026-01-15' }) @IsOptional() @IsDateString({ strict: true }) sold_at?: string;
  /** Số tháng bảo hành từ `sold_at`. Mặc định 12. */
  @ApiPropertyOptional({ default: 12, minimum: 0, maximum: 120 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(120) warranty_months?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UnassignDeviceDto {
  @ApiProperty({ example: 'Hết hợp đồng' }) @IsString() @Length(1, 500) reason!: string;
}

export class ChangeDeviceStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'LOCKED', 'RETIRED'] }) @IsIn(['ACTIVE', 'LOCKED', 'RETIRED']) status!: 'ACTIVE' | 'LOCKED' | 'RETIRED';
  @ApiProperty({ example: 'Khoá theo yêu cầu kế toán' }) @IsString() @Length(1, 500) reason!: string;
}

export class UsageRangeDto extends CursorPaginationDto {
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() to?: string;
}

/** Kết quả `POST /devices/import`. `items` theo thứ tự dòng trong file. */
export interface DeviceImportResult {
  imported: number;
  in_stock: number;
  assigned: number;
  items: Array<{ row: number; device_id: string; serial_number: string; status: DeviceStatus }>;
}
