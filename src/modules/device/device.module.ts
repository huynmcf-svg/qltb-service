import { Module } from '@nestjs/common';
import { AppLogger } from '../../common/logger/app-logger.service';
import { DeviceController } from './device.controller';
import { DeviceRepository } from './device.repository';
import { DeviceService } from './device.service';

@Module({
  controllers: [DeviceController],
  providers: [DeviceService, DeviceRepository, AppLogger],
  exports: [DeviceService],
})
export class DeviceModule {}
