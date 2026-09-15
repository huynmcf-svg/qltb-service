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
    .addBearerAuth()
    .addTag('users', 'Tài khoản người dùng: tạo (kiểm hạn mức DN), sửa, khoá, gán vai trò, xoá mềm')
    .addTag('roles', 'Vai trò và ma trận quyền — ma trận là DỮ LIỆU, đổi không cần deploy')
    .addTag('enterprises', 'Doanh nghiệp và chi nhánh (tối đa 2 cấp), hạn mức tài khoản, đình chỉ cả cây')
    .addTag('auth', 'Đăng nhập, xoay phiên, đổi mật khẩu, hồ sơ cá nhân. Refresh token chỉ trong cookie httpOnly')
    .addTag(
      'devices',
      'Thiết bị: nhập kho, sửa hồ sơ, tra cứu kèm sản lượng và bảo hành. Đổi trạng thái đi ' +
        'qua action riêng (assign / unassign / status / lock / unlock), KHÔNG qua PUT hồ sơ',
    )
    .addTag('warranties', 'Bảo hành: tự tạo lúc gán máy, gia hạn, sắp hết hạn 30/15/7 ngày')
    .addTag('quota', 'Sản lượng: cấp, phân bổ cha → chi nhánh, lượt dùng từ thiết bị (X-Device-Key), khoá / mở khoá')
    .addTag('alerts', 'Cảnh báo (sản lượng / bảo hành / offline) và thông báo tới người dùng; job quét mỗi 10 phút')
    .addTag('device-exchanges', 'Đổi trả máy: tạo yêu cầu, duyệt (chuyển bảo hành + sản lượng sang máy mới), từ chối')
    .addTag('dashboard', 'Tổng quan quản trị / doanh nghiệp, biểu đồ sản lượng, sắp hết hạn')
    .addTag('reports', 'Xuất Excel — trả FILE, không envelope')
    .addTag('audit', 'Nhật ký thao tác, chỉ đọc — bảng append-only')
    .addTag('health', 'Liveness và readiness — ngoài prefix /api/v1, body trần')
    .build();

  return SwaggerModule.createDocument(app, config);
}

export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('docs', app, buildSwaggerDocument(app));
}
