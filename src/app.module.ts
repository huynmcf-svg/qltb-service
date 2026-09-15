import { MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AppLogger } from './common/logger/app-logger.service';
import { ensureRequestId } from './common/request-context';
import { configuration } from './config/configuration';
import { validateEnv } from './config/env.validation';
import { DrizzleModule } from './db/drizzle.module';
import { AlertModule } from './modules/alert/alert.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DeviceModule } from './modules/device/device.module';
import { ExchangeModule } from './modules/exchange/exchange.module';
import { ReportModule } from './modules/report/report.module';
import { EnterpriseModule } from './modules/enterprise/enterprise.module';
import { QuotaModule } from './modules/quota/quota.module';
import { WarrantyModule } from './modules/warranty/warranty.module';
import { RoleModule } from './modules/role/role.module';
import { UserModule } from './modules/user/user.module';
import { HealthModule } from './modules/health/health.module';

/**
 * Request pipeline REST (docs/rules/backend-structure.md):
 *
 *   AccessTokenGuard (global)     ← đăng ký trong AuthModule; @Public() để hở
 *   → PermissionsGuard (global)   ← @RequirePermissions(...)
 *     → ValidationPipe            ← whitelist, forbidNonWhitelisted
 *       → Controller → Service → Repository
 *         → ResponseInterceptor   ← bọc envelope request_id/data/error
 *           → ExceptionFilter     ← map sang error code chuẩn
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
      // .env chỉ để dev. Môi trường khác nhận giá trị từ env của môi trường đó.
      envFilePath: ['.env'],
    }),
    DrizzleModule,
    // Job quét cảnh báo (alerts) chạy theo cron trong tiến trình — 1 replica là đủ.
    ScheduleModule.forRoot(),
    AuditModule,
    AuthModule,
    UserModule,
    RoleModule,
    EnterpriseModule,
    DeviceModule,
    WarrantyModule,
    QuotaModule,
    AlertModule,
    ExchangeModule,
    DashboardModule,
    ReportModule,
    HealthModule,
  ],
  providers: [
    AppLogger,
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        // Field lạ thì 400 INVALID_PAYLOAD, không im lặng bỏ qua: client gửi
        // `status` hay `created_by` mà server lờ đi là kiểu lỗi chỉ lộ ra khi
        // đối chiếu dữ liệu, lúc đã muộn.
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
    /*
     * Thứ tự interceptor: chiều VÀO theo mảng, chiều RA ngược lại.
     * ResponseInterceptor khai trước → nằm ngoài cùng → chạy SAU ở chiều ra,
     * nên IdempotencyInterceptor nhận dữ liệu trần, tự dựng envelope để lưu,
     * và ResponseInterceptor thấy envelope thì giữ nguyên. Đảo là bọc hai lần.
     */
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Gán request_id sớm nhất có thể, trước cả guard — nếu không thì log của
    // một request bị chặn ở guard sẽ không có id để ghép với log tầng trên.
    consumer
      .apply((req: Request, res: Response, next: NextFunction) => {
        res.setHeader('X-Request-Id', ensureRequestId(req));
        next();
      })
      // '{*path}' chứ không phải '*': path-to-regexp v8 (Nest 11) bỏ cú pháp cũ.
      .forRoutes('{*path}');
  }
}
