import { Module } from '@nestjs/common';
import { DeviceModule } from '../device/device.module';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [DeviceModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
