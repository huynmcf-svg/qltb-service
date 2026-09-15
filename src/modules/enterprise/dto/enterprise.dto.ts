import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { CursorPaginationDto } from '../../../common/dto/pagination.dto';
import { ENTERPRISE_STATUSES, type EnterpriseStatus } from '../../../db/schema';

export class ListEnterprisesDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: ENTERPRISE_STATUSES })
  @IsOptional()
  @IsIn(ENTERPRISE_STATUSES)
  status?: EnterpriseStatus;

  /** `null` (chuỗi "null") = chỉ doanh nghiệp gốc; uuid = chi nhánh của DN đó. */
  @ApiPropertyOptional({ description: '`null` = chỉ doanh nghiệp gốc; uuid = chi nhánh của DN đó' })
  @IsOptional()
  @IsString()
  @MaxLength(36)
  parent_id?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class CreateEnterpriseDto {
  @ApiProperty({ example: 'VPCC-DA', pattern: '^[A-Z0-9-]{2,32}$' })
  @IsString()
  @Matches(/^[A-Z0-9-]{2,32}$/, { message: 'code chỉ gồm chữ hoa, số, gạch ngang (2–32 ký tự)' })
  code!: string;

  @ApiProperty({ example: 'VPCC Đông Anh' })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Doanh nghiệp cha. Tối đa 2 cấp.' })
  @IsOptional()
  @IsUUID()
  parent_id?: string;

  @ApiPropertyOptional({ example: '0101234567' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  tax_code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ example: '+84243xxxxxxx' })
  @IsOptional()
  @Matches(/^\+?[0-9]{8,15}$/, { message: 'phone chỉ gồm số, 8–15 ký tự' })
  phone?: string;

  @ApiPropertyOptional({ example: 'lienhe@vpcc.vn' })
  @IsOptional()
  @IsEmail({}, { message: 'email không hợp lệ' })
  @MaxLength(200)
  email?: string;

  @ApiPropertyOptional({ example: 'Nguyễn Văn A' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contact_name?: string;

  @ApiPropertyOptional({ default: 10, minimum: 0, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  max_users?: number;
}

/** Không đổi `code`, `parent_id`. */
export class UpdateEnterpriseDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) tax_code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\+?[0-9]{8,15}$/, { message: 'phone chỉ gồm số, 8–15 ký tự' }) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail({}, { message: 'email không hợp lệ' }) @MaxLength(200) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) contact_name?: string;
  @ApiPropertyOptional({ minimum: 0, maximum: 1000 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) max_users?: number;
}

export class ChangeEnterpriseStatusDto {
  @ApiProperty({ enum: ENTERPRISE_STATUSES })
  @IsIn(ENTERPRISE_STATUSES)
  status!: EnterpriseStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export interface EnterpriseView {
  enterprise_id: string;
  parent_id: string | null;
  parent_name: string | null;
  code: string;
  name: string;
  tax_code: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  contact_name: string | null;
  status: EnterpriseStatus;
  max_users: number;
  user_count: number;
  device_count: number;
  branch_count: number;
  created_at: string;
  updated_at: string;
}
