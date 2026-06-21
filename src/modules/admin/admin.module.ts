import { Module } from '@nestjs/common';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminCustomersController } from './admin-customers.controller';
import { AdminDashboardService } from './admin-dashboard.service';

@Module({
  controllers: [AdminDashboardController, AdminCustomersController],
  providers: [AdminDashboardService],
})
export class AdminModule {}
