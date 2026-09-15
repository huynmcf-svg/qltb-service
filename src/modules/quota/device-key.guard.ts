import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppException } from '../../common/errors/app.exception';
import { DeviceService } from '../device/device.service';

export interface DeviceRequest extends Request {
  device_id?: string;
}

/**
 * Xác thực THIẾT BỊ bằng header `X-Device-Key` (cấp lúc assign). Endpoint gắn
 * guard này cũng gắn `@Public()` để `AccessTokenGuard` bỏ qua — thiết bị không
 * có JWT. Key sai / máy đã thu hồi → 401.
 */
@Injectable()
export class DeviceKeyGuard implements CanActivate {
  constructor(private readonly devices: DeviceService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<DeviceRequest>();
    const key = req.headers['x-device-key'];
    if (typeof key !== 'string' || !key) throw AppException.authenticationFailed('Thiếu header X-Device-Key');
    const device_id = await this.devices.authenticateDevice(key);
    if (!device_id) throw AppException.authenticationFailed('X-Device-Key không hợp lệ hoặc đã bị thu hồi');
    req.device_id = device_id;
    return true;
  }
}
