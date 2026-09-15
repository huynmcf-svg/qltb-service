import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import { CursorPaginationDto } from '../../../common/dto/pagination.dto';

const toBool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

export class ListQuotasDto extends CursorPaginationDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() enterprise_id?: string;
  @ApiPropertyOptional({ type: Boolean }) @IsOptional() @Transform(toBool) @IsBoolean() is_locked?: boolean;
  /** Chỉ lấy máy có `remaining_pct` < N. */
  @ApiPropertyOptional({ minimum: 0, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) below_pct?: number;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class UpdateQuotaDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) warn_threshold_pct?: number;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) @IsOptional() @IsDateString() package_start_at?: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) @IsOptional() @IsDateString() package_end_at?: string;
}

export class GrantQuotaDto {
  @ApiProperty({ example: 5000, minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000_000) amount!: number;
  @ApiPropertyOptional({ example: 'Gói bổ sung Q4/2026' }) @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class LockQuotaDto {
  @ApiProperty({ example: 'Nợ phí gói tháng 9' }) @IsString() @Length(1, 500) reason!: string;
}

export class AllocateQuotaDto {
  @ApiProperty({ format: 'uuid', description: 'Doanh nghiệp cha (cho)' }) @IsUUID() from_enterprise_id!: string;
  @ApiProperty({ format: 'uuid', description: 'Chi nhánh (nhận)' }) @IsUUID() to_enterprise_id!: string;
  @ApiProperty({ format: 'uuid', description: 'Máy của DN cha bị trừ' }) @IsUUID() from_device_id!: string;
  @ApiProperty({ format: 'uuid', description: 'Máy của chi nhánh được cộng' }) @IsUUID() device_id!: string;
  @ApiProperty({ example: 1000, minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000_000) amount!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ListAllocationsDto extends CursorPaginationDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() from_enterprise_id?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() to_enterprise_id?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() device_id?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() to?: string;
}

/** Thiết bị gửi lên. Xác thực bằng header `X-Device-Key`, không JWT. */
export class RecordUsageDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() device_id!: string;
  /** Id do thiết bị sinh — khoá idempotent theo máy. */
  @ApiProperty({ example: 'dev-000123-20260915-0042' }) @IsString() @Length(1, 100) client_ref!: string;
  @ApiPropertyOptional({ default: 1, minimum: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) amount?: number;
  @ApiProperty({ format: 'date-time', description: 'Giờ thiết bị' }) @IsDateString() used_at!: string;
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() meta?: Record<string, unknown>;
}

export class ListUsageDto extends CursorPaginationDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() device_id?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() enterprise_id?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ type: Boolean }) @IsOptional() @Transform(toBool) @IsBoolean() rejected?: boolean;
}

export interface QuotaGrantView {
  grant_id: string;
  device_id: string;
  amount: number;
  total_after: number;
  granted_by: string | null;
  granted_by_name: string | null;
  note: string | null;
  granted_at: string;
}

export interface QuotaAllocationView {
  allocation_id: string;
  from_enterprise_id: string;
  from_enterprise_name: string;
  to_enterprise_id: string;
  to_enterprise_name: string;
  from_device_id: string;
  from_serial_number: string;
  device_id: string;
  serial_number: string;
  amount: number;
  allocated_by: string | null;
  allocated_by_name: string | null;
  note: string | null;
  allocated_at: string;
}

export interface UsageLogView {
  usage_id: string;
  device_id: string;
  serial_number: string;
  client_ref: string;
  amount: number;
  used_at: string;
  received_at: string;
  rejected: boolean;
  remaining_after: number | null;
  meta: Record<string, unknown>;
}
