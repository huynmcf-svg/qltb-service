import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/** Tối thiểu 8 ký tự — chính sách chi tiết hơn (độ phức tạp, lịch sử) chốt sau. */
export const PASSWORD_MIN_LENGTH = 8;

/** argon2id với tham số mặc định của @node-rs/argon2 (19 MiB, 2 lượt). */
@Injectable()
export class PasswordService {
  /** Hash giả để `burnTime` so sánh thời gian đều nhau. */
  private dummyHash: Promise<string> = hash('dummy-password-for-timing');

  hash(plain: string): Promise<string> {
    return hash(plain);
  }

  async verify(passwordHash: string, plain: string): Promise<boolean> {
    try {
      return await verify(passwordHash, plain);
    } catch {
      return false;
    }
  }

  /**
   * Không tìm thấy tài khoản vẫn băm một lần: trả lời nhanh hơn "sai mật khẩu"
   * là cách để đoán username nào tồn tại.
   */
  async burnTime(plain: string): Promise<void> {
    await verify(await this.dummyHash, plain).catch(() => false);
  }
}
