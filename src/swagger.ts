import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

/**
 * Cấu hình Swagger, tách khỏi `main.ts` để **test kiểm được**.
 *
 * `test/swagger.spec.ts` dựng đúng tài liệu này rồi bắt buộc mọi endpoint phải
 * có `summary` VÀ `description` tiếng Việt cùng ví dụ response. Nếu cấu hình
 * nằm trong `main.ts` thì test phải chép lại một bản, và bản chép sẽ lệch.
 *
 * Luật đầy đủ ở `qltb-workspace/docs/conventions.md` mục "Swagger".
 */
export function buildSwaggerDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('QLTB Management API')
    .setDescription('API quản lý thiết bị. Mọi response bọc envelope `{ request_id, data, error }`.')
    .setVersion('1.0')
    .addTag(
      'devices',
      'Hồ sơ thiết bị: đăng ký, sửa thông tin, tra cứu. Đổi trạng thái đi qua action ' +
        'riêng (assign / return / dispose), KHÔNG qua PATCH',
    )
    .addTag('health', 'Liveness và readiness — ngoài prefix /api/v1, body trần')
    .build();

  return SwaggerModule.createDocument(app, config);
}

export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('docs', app, buildSwaggerDocument(app));
}
