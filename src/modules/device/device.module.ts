import { Module } from '@nestjs/common';
import { AppLogger } from '../../common/logger/app-logger.service';
import { AlertEmitter } from '../alert/alert-emitter.service';
import { EnterpriseRepository } from '../enterprise/enterprise.repository';
import { QuotaRepository } from '../quota/quota.repository';
import { QuotaService } from '../quota/quota.service';
import { WarrantyRepository } from '../warranty/warranty.repository';
import { DeviceController } from './device.controller';
import { DeviceRepository } from './device.repository';
import { DeviceService } from './device.service';

/**
 * Device ↔ Quota ↔ Warranty dùng chung repository (đều chỉ cần DRIZZLE) nên
 * khai provider thẳng ở đây thay vì import chéo module — tránh vòng import.
 */
@Module({
  controllers: [DeviceController],
  providers: [DeviceService, DeviceRepository, EnterpriseRepository, WarrantyRepository, QuotaRepository, QuotaService, AlertEmitter, AppLogger],
  exports: [DeviceService, DeviceRepository, QuotaService, QuotaRepository, WarrantyRepository],
})
export class DeviceModule {}
