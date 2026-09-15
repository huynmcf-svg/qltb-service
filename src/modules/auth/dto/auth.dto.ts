import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../password.service';

export class LoginDto {
  @ApiProperty({ example: 'admin' })
  @IsString()
  @Length(1, 100)
  username!: string;

  @ApiProperty({ example: 'Admin@2026' })
  @IsString()
  @Length(1, 200)
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @Length(1, 200)
  current_password!: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: `new_password tối thiểu ${PASSWORD_MIN_LENGTH} ký tự` })
  @MaxLength(200)
  new_password!: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Nguyễn Văn A' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  full_name?: string;

  @ApiPropertyOptional({ example: 'a@vpcc.vn', nullable: true })
  @IsOptional()
  @IsEmail({}, { message: 'email không hợp lệ' })
  @MaxLength(200)
  email?: string;

  @ApiPropertyOptional({ example: '+84912345678', nullable: true })
  @IsOptional()
  @Matches(/^\+?[0-9]{8,15}$/, { message: 'phone chỉ gồm số, 8–15 ký tự' })
  phone?: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'ketoan.dongdanh', description: 'username hoặc email' }) @IsString() @Length(1, 200) identifier!: string;
}

export class ResetPasswordDto {
  @ApiProperty() @IsString() @Length(1, 200) token!: string;
  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH }) @IsString() @MinLength(PASSWORD_MIN_LENGTH) @MaxLength(200) new_password!: string;
}
