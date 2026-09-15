import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { CursorPaginationDto } from '../../../common/dto/pagination.dto';
import { WARRANTY_SOURCES, WARRANTY_STATUSES, type WarrantySource, type WarrantyStatus } from '../../../db/schema';

export class ListWarrantiesDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: WARRANTY_STATUSES }) @IsOptional() @IsIn(WARRANTY_STATUSES) status?: WarrantyStatus;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() enterprise_id?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() device_id?: string;
  /** Chỉ lấy còn ≤ N ngày (kể cả đã quá hạn nhưng chưa đánh EXPIRED). */
  @ApiPropertyOptional({ minimum: 0, maximum: 3650 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3650) expiring_within_days?: number;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class ExpiringWarrantiesDto {
  @ApiPropertyOptional({ default: 30, enum: [30, 15, 7] }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) days?: number;
}

export class CreateWarrantyDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() device_id!: string;
  @ApiProperty({ format: 'date', example: '2026-01-15' }) @IsDateString({ strict: true }) start_date!: string;
  @ApiProperty({ format: 'date', example: '2027-01-15' }) @IsDateString({ strict: true }) end_date!: string;
  @ApiPropertyOptional({ enum: WARRANTY_SOURCES, default: 'SALE' }) @IsOptional() @IsIn(WARRANTY_SOURCES) source?: WarrantySource;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class UpdateWarrantyDto {
  @ApiPropertyOptional({ format: 'date', example: '2027-07-15', description: 'Gia hạn — chỉ dời về sau' }) @IsOptional() @IsDateString({ strict: true }) end_date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
