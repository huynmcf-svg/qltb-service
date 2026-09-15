import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { CursorPaginationDto } from '../../../common/dto/pagination.dto';
import { USER_STATUSES, type UserStatus } from '../../../db/schema';
import { PASSWORD_MIN_LENGTH } from '../../auth/password.service';

export class ListUsersDto extends CursorPaginationDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() enterprise_id?: string;
  @ApiPropertyOptional({ example: 'ENTERPRISE_ADMIN' }) @IsOptional() @IsString() @MaxLength(50) role_code?: string;
  @ApiPropertyOptional({ enum: USER_STATUSES }) @IsOptional() @IsIn(USER_STATUSES) status?: UserStatus;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class CreateUserDto {
  @ApiProperty({ example: 'ketoan.dongdanh', pattern: '^[a-z0-9._-]{3,50}$' })
  @IsString()
  @Matches(/^[a-z0-9._-]{3,50}$/, { message: 'username chỉ gồm chữ thường, số, dấu chấm, gạch (3–50 ký tự)' })
  username!: string;

  @ApiProperty({ example: 'Trần Thị B' }) @IsString() @Length(1, 200) full_name!: string;
  @ApiPropertyOptional({ example: 'kt@vpcc.vn' }) @IsOptional() @IsEmail({}, { message: 'email không hợp lệ' }) @MaxLength(200) email?: string;
  @ApiPropertyOptional({ example: '+84912345678' }) @IsOptional() @Matches(/^\+?[0-9]{8,15}$/, { message: 'phone chỉ gồm số, 8–15 ký tự' }) phone?: string;

  /** Bỏ trống = quản trị hệ thống (chỉ admin hệ thống mới tạo được loại này). */
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) @IsOptional() @IsUUID() enterprise_id?: string;

  @ApiProperty({ type: [String], format: 'uuid' }) @IsArray() @ArrayMinSize(1) @IsUUID('4', { each: true }) role_ids!: string[];

  /** Bỏ trống thì server sinh và trả MỘT LẦN ở `temporary_password`. */
  @ApiPropertyOptional({ minLength: PASSWORD_MIN_LENGTH }) @IsOptional() @IsString() @MinLength(PASSWORD_MIN_LENGTH) @MaxLength(200) password?: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) full_name?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail({}, { message: 'email không hợp lệ' }) @MaxLength(200) email?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\+?[0-9]{8,15}$/, { message: 'phone chỉ gồm số, 8–15 ký tự' }) phone?: string;
}

export class DisableUserDto {
  @ApiProperty({ description: '`true` = khoá, `false` = mở lại' }) @IsBoolean() disabled!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class AssignRolesDto {
  @ApiProperty({ type: [String], format: 'uuid', description: 'THAY THẾ toàn bộ vai trò hiện có' })
  @IsArray() @ArrayMinSize(1) @IsUUID('4', { each: true })
  role_ids!: string[];
}

export class ResetPasswordByAdminDto {
  @ApiPropertyOptional({ minLength: PASSWORD_MIN_LENGTH, description: 'Bỏ trống = server sinh và trả một lần' })
  @IsOptional() @IsString() @MinLength(PASSWORD_MIN_LENGTH) @MaxLength(200)
  new_password?: string;
}

export interface UserRoleRef {
  role_id: string;
  code: string;
  name: string;
}

export interface UserView {
  user_id: string;
  username: string;
  email: string | null;
  full_name: string;
  phone: string | null;
  enterprise_id: string | null;
  enterprise_name: string | null;
  roles: UserRoleRef[];
  status: UserStatus;
  must_change_password: boolean;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}
