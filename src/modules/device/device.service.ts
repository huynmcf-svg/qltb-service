import { Injectable } from '@nestjs/common';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { AppException } from '../../common/errors/app.exception';
import { uniqueViolation } from '../../common/errors/db-error';
import { ErrorCode } from '../../common/errors/error-code';
import { AppLogger } from '../../common/logger/app-logger.service';
import { DeviceRepository } from './device.repository';
import type { CreateDeviceDto, DeviceView, ListDevicesDto, UpdateDeviceDto } from './dto/device.dto';

/** Ngữ cảnh của một thao tác — lấy từ request, sau này thêm actor từ token. */
export interface ActionContext {
  request_id: string;
  actor_user_id?: string;
  actor_name?: string;
}

/**
 * Nghiệp vụ thiết bị. Mọi đường đổi `status` đi qua `transition()` bên dưới
 * (khi thêm assign / return / dispose) — không có đường tắt.
 */
@Injectable()
export class DeviceService {
  constructor(
    private readonly repo: DeviceRepository,
    private readonly logger: AppLogger,
  ) {}

  list(query: ListDevicesDto): Promise<CursorPage<DeviceView>> {
    return this.repo.list(query);
  }

  async get(device_id: string): Promise<DeviceView> {
    const device = await this.repo.findById(device_id);
    if (!device) throw AppException.notFound('thiết bị', device_id);
    return device;
  }

  async create(dto: CreateDeviceDto, ctx: ActionContext): Promise<DeviceView> {
    if (!(await this.repo.categoryExists(dto.category_id))) {
      throw AppException.invalidPayload('Loại thiết bị không tồn tại', {
        violations: ['category_id không tồn tại'],
      });
    }

    let device_id: string;
    try {
      const row = await this.repo.create(
        { ...dto, status: 'IN_STOCK' },
        {
          action: 'REGISTER',
          from_status: null,
          to_status: 'IN_STOCK',
          actor_user_id: ctx.actor_user_id,
          actor_name: ctx.actor_name,
          request_id: ctx.request_id,
        },
      );
      device_id = row.device_id;
    } catch (error) {
      // Cứ INSERT rồi bắt 23505 — không SELECT trước, hai request song song
      // sẽ lọt cả hai qua bước SELECT.
      if (uniqueViolation(error) === 'devices_code_key') {
        throw AppException.conflict(ErrorCode.DEVICE_CODE_CONFLICT, 'Mã thiết bị đã tồn tại', {
          code: dto.code,
        });
      }
      throw error;
    }

    this.logger.info('device registered', { request_id: ctx.request_id, device_id, code: dto.code });
    return this.get(device_id);
  }

  async update(device_id: string, dto: UpdateDeviceDto, ctx: ActionContext): Promise<DeviceView> {
    if (dto.category_id && !(await this.repo.categoryExists(dto.category_id))) {
      throw AppException.invalidPayload('Loại thiết bị không tồn tại', {
        violations: ['category_id không tồn tại'],
      });
    }
    const row = await this.repo.update(device_id, dto);
    if (!row) throw AppException.notFound('thiết bị', device_id);

    this.logger.info('device updated', { request_id: ctx.request_id, device_id });
    return this.get(device_id);
  }
}
