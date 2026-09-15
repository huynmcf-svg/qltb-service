import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { assertSystemAdmin, inScope } from '../../common/auth/scope';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-code';
import { AuditService } from '../audit/audit.service';
import { DeviceRepository } from '../device/device.repository';
import { actorOf, meta, type Ctx } from '../enterprise/enterprise.service';
import type { CreateWarrantyDto, ListWarrantiesDto, UpdateWarrantyDto } from './dto/warranty.dto';
import { WarrantyRepository, type WarrantyFullView } from './warranty.repository';

@Injectable()
export class WarrantyService {
  constructor(
    private readonly repo: WarrantyRepository,
    private readonly devices: DeviceRepository,
    private readonly audit: AuditService,
  ) {}

  list(query: ListWarrantiesDto, actor: AuthenticatedUser): Promise<CursorPage<WarrantyFullView>> {
    return this.repo.list(query, actor.scope);
  }

  expiring(days: number, actor: AuthenticatedUser): Promise<CursorPage<WarrantyFullView>> {
    return this.repo.list({ expiring_within_days: days, limit: 200 }, actor.scope);
  }

  async get(warranty_id: string, actor: AuthenticatedUser): Promise<WarrantyFullView> {
    const w = await this.repo.findById(warranty_id);
    if (!w || !inScope(w.enterprise_id, actor.scope)) throw AppException.notFound('bảo hành', warranty_id);
    return w;
  }

  /** Tạo tay (bán lẻ lượt bảo hành / gia hạn dạng lượt mới). Máy đang có ACTIVE → 422. */
  async create(dto: CreateWarrantyDto, ctx: Ctx): Promise<WarrantyFullView> {
    assertSystemAdmin(ctx.actor, 'tạo được bảo hành');
    if (dto.end_date < dto.start_date) throw AppException.invalidPayload('end_date phải ≥ start_date', { violations: ['end_date < start_date'] });
    const device = await this.devices.findRaw(dto.device_id);
    if (!device) throw AppException.notFound('thiết bị', dto.device_id);
    if (await this.repo.activeOf(dto.device_id)) {
      throw AppException.unprocessable(ErrorCode.INVALID_PAYLOAD, 'Máy đang có bảo hành ACTIVE — gia hạn bằng PUT /warranties/{id} thay vì tạo mới', { device_id: dto.device_id });
    }
    const row = await this.repo.create({ ...dto, enterprise_id: device.enterprise_id, created_by: ctx.actor.user_id });
    await this.audit.record({ module: 'warranty', action: 'WARRANTY_CREATE', resource_type: 'warranty', resource_id: row.warranty_id, enterprise_id: device.enterprise_id, actor: actorOf(ctx), new_values: { ...dto }, ...meta(ctx) });
    return this.get(row.warranty_id, ctx.actor);
  }

  /** Gia hạn: `end_date` chỉ dời về sau. Ghi audit với giá trị cũ / mới. */
  async update(warranty_id: string, dto: UpdateWarrantyDto, ctx: Ctx): Promise<WarrantyFullView> {
    assertSystemAdmin(ctx.actor, 'gia hạn được bảo hành');
    const before = await this.get(warranty_id, ctx.actor);
    if (dto.end_date !== undefined) {
      if (before.status !== 'ACTIVE') throw AppException.unprocessable(ErrorCode.INVALID_PAYLOAD, 'Chỉ gia hạn được bảo hành đang ACTIVE', { status: before.status });
      if (dto.end_date < before.end_date) throw AppException.invalidPayload('Gia hạn chỉ dời end_date về sau', { violations: [`end_date phải ≥ ${before.end_date}`] });
    }
    await this.repo.update(warranty_id, dto);
    await this.audit.record({ module: 'warranty', action: dto.end_date && dto.end_date !== before.end_date ? 'WARRANTY_EXTEND' : 'WARRANTY_UPDATE', resource_type: 'warranty', resource_id: warranty_id, enterprise_id: before.enterprise_id, actor: actorOf(ctx), old_values: { end_date: before.end_date, notes: before.notes }, new_values: { ...dto }, ...meta(ctx) });
    return this.get(warranty_id, ctx.actor);
  }
}
