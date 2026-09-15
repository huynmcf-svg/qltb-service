import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { Permission } from '../../modules/permission/permission.catalog';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import type { RequestContext } from '../request-context';

export const NO_ENVELOPE_KEY = 'qltb:no_envelope';
export const IS_PUBLIC_KEY = 'qltb:public';
export const REQUIRED_PERMISSIONS_KEY = 'qltb:permissions';

/**
 * Trả body trần, không bọc envelope. Chỉ dùng cho `/health` — người đọc là
 * probe của hạ tầng, không phải web.
 */
export const NoEnvelope = () => SetMetadata(NO_ENVELOPE_KEY, true);

/**
 * Bỏ qua `AccessTokenGuard`. Guard đăng ký GLOBAL nên mặc định mọi endpoint
 * đều phải có token — quên gắn guard cho endpoint mới không làm nó hở. Đường
 * hở duy nhất là ai đó chủ động gắn decorator này.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Quyền cần có để gọi endpoint. Guard kiểm theo ma trận quyền LẤY TỪ DB, nên
 * đổi vai trò nào có quyền nào là đổi dữ liệu, không phải deploy lại.
 * Nhiều quyền = phải có ĐỦ (AND) — nới quyền nhầm nguy hiểm hơn siết nhầm.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

/** Lấy actor từ token. Đừng đọc `actor` từ body — client không đáng tin. */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<RequestContext>();
    const user = req.auth_user;
    if (!user) return undefined;
    return field ? user[field] : user;
  },
);

export const SIDE_EFFECT_KEY = 'qltb:side_effect';

/**
 * Đánh dấu endpoint có side effect: bắt buộc header `Idempotency-Key`.
 * Bấm "cấp sản lượng" hai lần vì mạng chậm không được cấp hai lần — lịch sử
 * append-only nên không có cách sửa lại sau.
 */
export const SideEffect = () => SetMetadata(SIDE_EFFECT_KEY, true);
