import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../../common/guards/auth.guard';
import type { CurrentUserData } from '../../common/decorators/current-user.decorator';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Login de operador. Fase 0: passwordless de desarrollo — valida que el
   * email exista como User con alguna membresía. En Fase 1 se reemplaza por
   * magic link (Resend) + verificación real.
   */
  async login(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: { include: { tenant: { select: { slug: true } } } } },
    });
    if (!user || user.memberships.length === 0) {
      throw new UnauthorizedException('Operador no autorizado');
    }

    const accessToken = await this.signToken({
      sub: user.id,
      email: user.email,
      type: 'operator',
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        tenants: user.memberships.map((m) => ({
          slug: m.tenant.slug,
          role: m.role,
        })),
      },
    };
  }

  getMe(user: CurrentUserData) {
    const ownerEmail = this.config.get<string>('platformOwnerEmail');
    return {
      ...user,
      isPlatformOwner: !!ownerEmail && user.email === ownerEmail,
    };
  }

  signToken(payload: JwtPayload): Promise<string> {
    // secret + expiresIn vienen del JwtModule (CommonModule).
    return this.jwt.signAsync(payload);
  }
}
