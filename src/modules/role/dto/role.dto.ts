import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ example: 'BRANCH_MANAGER', pattern: '^[A-Z][A-Z0-9_]{1,49}$' })
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,49}$/, { message: 'code là UPPER_SNAKE_CASE' })
  code!: string;

  @ApiProperty({ example: 'Trưởng chi nhánh' }) @IsString() @Length(1, 200) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;

  @ApiProperty({ type: [String], example: ['device.read', 'quota.read'] })
  @IsArray() @ArrayUnique() @IsString({ each: true })
  permission_codes!: string[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class SetRolePermissionsDto {
  @ApiProperty({ type: [String], description: 'THAY THẾ toàn bộ', example: ['device.read', 'quota.read'] })
  @IsArray() @ArrayUnique() @IsString({ each: true })
  permission_codes!: string[];
}

export interface PermissionView {
  code: string;
  name: string;
  group: string;
}

export interface RoleView {
  role_id: string;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  permissions: string[];
  user_count: number;
  created_at: string;
  updated_at: string;
}
