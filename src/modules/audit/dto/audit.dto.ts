import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CursorPaginationDto } from '../../../common/dto/pagination.dto';

export class ListAuditLogsDto extends CursorPaginationDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() actor_user_id?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() enterprise_id?: string;
  @ApiPropertyOptional({ example: 'device' }) @IsOptional() @IsString() @MaxLength(50) module?: string;
  @ApiPropertyOptional({ example: 'DEVICE_ASSIGN' }) @IsOptional() @IsString() @MaxLength(50) action?: string;
  @ApiPropertyOptional({ example: 'device' }) @IsOptional() @IsString() @MaxLength(50) resource_type?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) resource_id?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() to?: string;
}

export interface AuditLogView {
  audit_id: string;
  enterprise_id: string | null;
  enterprise_name: string | null;
  actor_user_id: string | null;
  actor_username: string | null;
  module: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  request_id: string | null;
  ip: string | null;
  user_agent: string | null;
  occurred_at: string;
}
