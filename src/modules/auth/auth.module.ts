import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, MfaService],
  exports: [AuthService],
})
export class AuthModule {}
