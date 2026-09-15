import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { CursorPaginationDto } from '../../../common/dto/pagination.dto';
import { EXCHANGE_STATUSES, type ExchangeStatus } from '../../../db/schema';

export class ListExchangesDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: EXCHANGE_STATUSES }) @IsOptional() @IsIn(EXCHANGE_STATUSES) status?: ExchangeStatus;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() enterprise_id?: string;
}

export class CreateExchangeDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() old_device_id!: string;
  @ApiProperty({ example: 'Màn hình cảm ứng liệt' }) @IsString() @Length(1, 1000) reason!: string;
}

export class UpdateExchangeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 1000) reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class ApproveExchangeDto {
  @ApiProperty({ format: 'uuid', description: 'Máy mới, phải đang IN_STOCK' }) @IsUUID() new_device_id!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class RejectExchangeDto {
  @ApiProperty({ example: 'Lỗi do người dùng, không thuộc diện đổi trả' }) @IsString() @Length(1, 1000) reject_reason!: string;
}

export interface ExchangeView {
  exchange_id: string;
  enterprise_id: string;
  enterprise_name: string;
  old_device_id: string;
  old_serial_number: string;
  new_device_id: string | null;
  new_serial_number: string | null;
  reason: string;
  status: ExchangeStatus;
  requested_by: string;
  requested_by_name: string | null;
  requested_at: string;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  reject_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
