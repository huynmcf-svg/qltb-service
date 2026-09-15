import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { CursorPaginationDto } from '../../../common/dto/pagination.dto';
import { DEVICE_STATUSES, type DeviceStatus } from '../../../db/schema';

/**
 * DTO giữ `snake_case` như hợp đồng. `status` / `holder_*` KHÔNG nằm trong
 * Create / Update — đổi trạng thái đi qua action riêng, để máy trạng thái ở
 * service là đường duy nhất.
 */
export class ListDevicesDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: DEVICE_STATUSES })
  @IsOptional()
  @IsIn(DEVICE_STATUSES)
  status?: DeviceStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  category_id?: string;

  /** Tìm theo `code` / `name` / `serial_number`, không phân biệt hoa thường. */
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class CreateDeviceDto {
  /** Mã quản lý: chữ hoa, số, gạch ngang. Unique. */
  @ApiProperty({ example: 'LT-0001', pattern: '^[A-Z0-9-]{2,32}$' })
  @IsString()
  @Matches(/^[A-Z0-9-]{2,32}$/, { message: 'code chỉ gồm chữ hoa, số, gạch ngang (2–32 ký tự)' })
  code!: string;

  @ApiProperty({ example: 'Laptop Dell Latitude 5540' })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  category_id!: string;

  @ApiPropertyOptional({ example: 'Dell' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @ApiPropertyOptional({ example: 'Latitude 5540' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @ApiPropertyOptional({ example: '5CG3210XYZ' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  serial_number?: string;

  /** Ngày, dạng YYYY-MM-DD. */
  @ApiPropertyOptional({ example: '2026-01-15', format: 'date' })
  @IsOptional()
  @IsDateString({ strict: true })
  purchased_at?: string;

  @ApiPropertyOptional({ example: '2029-01-15', format: 'date' })
  @IsOptional()
  @IsDateString({ strict: true })
  warranty_until?: string;

  /** VND, số nguyên không âm. */
  @ApiPropertyOptional({ example: 25000000, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  purchase_price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/** Sửa hồ sơ. Không đổi được `code` — mã đã in tem dán lên máy. */
export class UpdateDeviceDto {
  @ApiPropertyOptional({ example: 'Laptop Dell Latitude 5540' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  serial_number?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString({ strict: true })
  purchased_at?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString({ strict: true })
  warranty_until?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  purchase_price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/** Hình dạng resource `Device` trả ra API — khớp docs/api-contracts.md. */
export interface DeviceView {
  device_id: string;
  code: string;
  name: string;
  category_id: string;
  category_name: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  status: DeviceStatus;
  holder_name: string | null;
  holder_unit: string | null;
  purchased_at: string | null;
  warranty_until: string | null;
  purchase_price: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
