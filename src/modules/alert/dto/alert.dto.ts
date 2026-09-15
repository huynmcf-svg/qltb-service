import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';
import { CursorPaginationDto } from '../../../common/dto/pagination.dto';
import { ALERT_SEVERITIES, type AlertSeverity, type AlertType } from '../../../db/schema';

const toBool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

export const ALERT_GROUPS = ['QUOTA', 'WARRANTY', 'DEVICE'] as const;
export type AlertGroup = (typeof ALERT_GROUPS)[number];

export class ListAlertsDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: ALERT_GROUPS }) @IsOptional() @IsIn(ALERT_GROUPS) group?: AlertGroup;
  @ApiPropertyOptional({ enum: ALERT_SEVERITIES }) @IsOptional() @IsIn(ALERT_SEVERITIES) severity?: AlertSeverity;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() enterprise_id?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() device_id?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ type: Boolean }) @IsOptional() @Transform(toBool) @IsBoolean() resolved?: boolean;
}

export class ListNotificationsDto extends CursorPaginationDto {
  @ApiPropertyOptional({ type: Boolean }) @IsOptional() @Transform(toBool) @IsBoolean() unread?: boolean;
}

export interface AlertView {
  alert_id: string;
  device_id: string;
  serial_number: string;
  enterprise_id: string | null;
  enterprise_name: string | null;
  type: AlertType;
  group: AlertGroup;
  severity: AlertSeverity;
  message: string;
  payload: Record<string, unknown>;
  occurred_at: string;
  resolved_at: string | null;
}

export interface NotificationView {
  notification_id: string;
  alert_id: string;
  title: string;
  body: string;
  alert: { type: AlertType; severity: AlertSeverity; device_id: string; serial_number: string };
  read_at: string | null;
  created_at: string;
}

export function groupOf(type: AlertType): AlertGroup {
  if (type.startsWith('QUOTA')) return 'QUOTA';
  if (type.startsWith('WARRANTY')) return 'WARRANTY';
  return 'DEVICE';
}
