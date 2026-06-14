import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

export interface CustomerJwtPayload {
  sub: string;       // Customer.id
  email: string;
  tenantId: string;
  type: 'customer';
}

export interface CurrentCustomerData {
  id: string;
  email: string;
  tenantId: string;
}

@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('Falta token de autenticación');

    try {
      const payload = await this.jwt.verifyAsync<CustomerJwtPayload>(token, {
        secret: this.config.get<string>('jwt.secret'),
      });
      if (payload.type !== 'customer') {
        throw new Error('tipo de token incorrecto');
      }
      req.customer = {
        id: payload.sub,
        email: payload.email,
        tenantId: payload.tenantId,
      } satisfies CurrentCustomerData;
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }

  private extractToken(req: { headers: Record<string, string> }): string | null {
    const header = req.headers['authorization'];
    if (!header) return null;
    const [type, token] = header.split(' ');
    return type === 'Bearer' && token ? token : null;
  }
}
