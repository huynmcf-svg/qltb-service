import { SetMetadata } from '@nestjs/common';

export const NO_ENVELOPE_KEY = 'qltb:no_envelope';
export const IS_PUBLIC_KEY = 'qltb:public';

/**
 * Trả body trần, không bọc envelope `{ request_id, data, error }`.
 *
 * Chỉ dùng cho `/health` — nó nằm ngoài hợp đồng REST, người đọc là probe của
 * hạ tầng chứ không phải web. Đừng gắn cho endpoint nghiệp vụ: web đọc
 * `error.code` trước `data`, body trần làm web không rẽ nhánh được.
 */
export const NoEnvelope = () => SetMetadata(NO_ENVELOPE_KEY, true);

/**
 * Bỏ qua guard xác thực (khi có). Khai sẵn để `/health` gắn ngay từ đầu — lúc
 * thêm guard toàn cục thì không phải đi tìm endpoint nào cần mở.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
