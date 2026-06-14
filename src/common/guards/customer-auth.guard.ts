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

export const CUSTOMER_COOKIE = 'customer_token';

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
        secret: this.config.get<string>('jwt.customerSecret'),
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

  // Cookie HttpOnly primaria; Authorization Bearer como fallback para clientes nativos.
  private extractToken(req: {
    cookies?: Record<string, string>;
    headers: Record<string, string>;
  }): string | null {
    if (req.cookies?.[CUSTOMER_COOKIE]) return req.cookies[CUSTOMER_COOKIE];
    const header = req.headers['authorization'];
    if (!header) return null;
    const [type, token] = header.split(' ');
    return type === 'Bearer' && token ? token : null;
  }
}
