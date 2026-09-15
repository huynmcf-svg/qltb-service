import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { setupSwagger } from './swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // Prefix /api/v1: NEXT_PUBLIC_API_BASE_URL của web trỏ vào đây. Đổi prefix
  // thì phải đổi cả bên web lẫn docs/api-contracts.md.
  //
  // `/health` và `/health/ready` nằm NGOÀI prefix: probe của hạ tầng gọi
  // chúng, và chúng không bọc envelope (@NoEnvelope).
  app.setGlobalPrefix('api/v1', {
    exclude: ['health', 'health/ready'],
  });

  const config = app.get(ConfigService);
  const isProd = config.getOrThrow<string>('nodeEnv') === 'production';

  /*
   * Header bảo mật. Service chỉ trả JSON nên CSP gần như không có gì để cấm,
   * nhưng vẫn khai để lỡ endpoint nào trả HTML (trang lỗi, Swagger) thì trình
   * duyệt cũng không chạy script lạ. HSTS chỉ ở production: bật trên dev
   * http://localhost là trình duyệt ghi nhớ và từ chối http về sau.
   */
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
        },
      },
      hsts: isProd ? { maxAge: 63_072_000, includeSubDomains: true } : false,
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  /*
   * CORS. `CORS_ORIGINS=*` (mặc định dev) = mở cho MỌI origin: không trả `*`
   * thô mà phản chiếu lại origin của request (`origin: true`), vì trình duyệt
   * từ chối `credentials: include` khi header là `*` — sau này có cookie auth
   * vẫn chạy. Production liệt kê origin cụ thể, ngăn cách bằng dấu phẩy.
   */
  const corsOrigins = config.getOrThrow<string[]>('corsOrigins');
  app.enableCors({
    origin: corsOrigins.includes('*') ? true : corsOrigins,
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
  });

  if (config.getOrThrow<boolean>('swagger.enabled')) {
    setupSwagger(app);
  }

  // 0.0.0.0 để chạy được trong container — localhost chỉ nghe loopback.
  await app.listen(config.getOrThrow<number>('port'), '0.0.0.0');
}

void bootstrap();
