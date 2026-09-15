import { Module } from '@nestjs/common';
import { DeviceModule } from '../device/device.module';
import { WarrantyController } from './warranty.controller';
import { WarrantyService } from './warranty.service';

@Module({
  imports: [DeviceModule],
  controllers: [WarrantyController],
  providers: [WarrantyService],
  exports: [WarrantyService],
})
export class WarrantyModule {}
