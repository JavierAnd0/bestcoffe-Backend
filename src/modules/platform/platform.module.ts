import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PlatformTenantsController } from './platform-tenants.controller';
import { PlatformTiersController } from './platform-tiers.controller';
import { PlatformTenantsService } from './platform-tenants.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [PlatformTenantsController, PlatformTiersController],
  providers: [PlatformTenantsService],
})
export class PlatformModule {}
