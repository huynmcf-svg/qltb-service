import { Module } from '@nestjs/common';
import { DeviceModule } from '../device/device.module';
import { DeviceKeyGuard } from './device-key.guard';
import { QuotaController } from './quota.controller';

/** QuotaService / QuotaRepository sống trong DeviceModule (dùng chung) — đây chỉ là controller. */
@Module({
  imports: [DeviceModule],
  controllers: [QuotaController],
  providers: [DeviceKeyGuard],
})
export class QuotaModule {}
