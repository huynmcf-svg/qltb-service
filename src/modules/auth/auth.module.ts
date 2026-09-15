import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AppLogger } from '../../common/logger/app-logger.service';
import { AuthContextService } from './auth-context.service';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionCookie } from './session-cookie';
import { TokenService } from './token.service';

/**
 * Đăng ký hai guard TOÀN CỤC ở đây (không ở app.module) để module nào import
 * AuthModule là có guard, và thứ tự cố định: token trước, quyền sau.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    AuthContextService,
    PasswordService,
    TokenService,
    SessionCookie,
    AppLogger,
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [AuthContextService, PasswordService],
})
export class AuthModule {}
