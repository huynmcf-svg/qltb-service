import { Module } from '@nestjs/common';
import { AppLogger } from '../../common/logger/app-logger.service';
import { DeviceModule } from '../device/device.module';
import { AlertEmitter } from './alert-emitter.service';
import { AlertScanService } from './alert-scan.service';
import { AlertController } from './alert.controller';
import { AlertRepository } from './alert.repository';

@Module({
  imports: [DeviceModule],
  controllers: [AlertController],
  providers: [AlertRepository, AlertEmitter, AlertScanService, AppLogger],
  exports: [AlertRepository],
})
export class AlertModule {}
