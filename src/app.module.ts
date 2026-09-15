import { MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AppLogger } from './common/logger/app-logger.service';
import { ensureRequestId } from './common/request-context';
import { configuration } from './config/configuration';
import { validateEnv } from './config/env.validation';
import { DrizzleModule } from './db/drizzle.module';
import { DeviceModule } from './modules/device/device.module';
import { HealthModule } from './modules/health/health.module';

/**
 * Request pipeline REST (docs/rules/backend-structure.md):
 *
 *   (Guard auth — khi có)
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
    DeviceModule,
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
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
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
