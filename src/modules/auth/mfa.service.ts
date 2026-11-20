import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { deriveSecretBoxKey, open, seal } from '../../common/crypto/secret-box';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  totpUri,
  verifyTotp,
} from '../../common/crypto/totp';

const ISSUER = 'Bestkofi';
const INVALID_CODE =
  'El código no es válido. Revisa la hora del teléfono e inténtalo de nuevo.';

/**
 * Verificación en dos pasos de los operadores (app autenticadora + códigos de
 * respaldo). Es opcional por cuenta: quien la activa debe dar un código después
 * del enlace mágico para obtener su sesión.
 */
@Injectable()
export class MfaService {
  private readonly key = deriveSecretBoxKey();

  constructor(private readonly prisma: PrismaService) {}

  async status(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { totpEnabledAt: true, totpRecoveryCodes: true },
    });
    return {
      enabled: !!user.totpEnabledAt,
      enabledAt: user.totpEnabledAt,
      recoveryCodesLeft: user.totpEnabledAt ? user.totpRecoveryCodes.length : 0,
    };
  }

  /** Paso 1 de la activación: secreto nuevo (pendiente) y la URI para el QR. */
  async startSetup(userId: string, email: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { totpEnabledAt: true },
    });
    if (user.totpEnabledAt) {
      throw new BadRequestException(
        'La verificación en dos pasos ya está activa.',
      );
    }
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpPendingSecret: seal(secret, this.key) },
    });
    return { secret, otpauthUri: totpUri(secret, email, ISSUER) };
  }

  /**
   * Paso 2: el primer código confirma que la app quedó bien configurada. Activa
   * la verificación y devuelve los códigos de respaldo (se muestran una vez).
   */
  async confirmSetup(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { totpEnabledAt: true, totpPendingSecret: true },
    });
    if (user.totpEnabledAt) {
      throw new BadRequestException(
        'La verificación en dos pasos ya está activa.',
      );
    }
    if (!user.totpPendingSecret) {
      throw new BadRequestException('Primero genera el código QR.');
    }
    const step = verifyTotp(open(user.totpPendingSecret, this.key), code);
    if (step === null) throw new BadRequestException(INVALID_CODE);

    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpSecret: user.totpPendingSecret,
        totpPendingSecret: null,
        totpEnabledAt: new Date(),
        totpLastStep: step,
        totpRecoveryCodes: recoveryCodes.map(hashRecoveryCode),
      },
    });
    return { recoveryCodes };
  }

  /** Desactivar exige un código válido: una sesión robada no basta. */
  async disable(userId: string, code: string) {
    await this.assertCode(userId, code);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpSecret: null,
        totpPendingSecret: null,
        totpEnabledAt: null,
        totpLastStep: null,
        totpRecoveryCodes: [],
      },
    });
    return { enabled: false };
  }

  /** Reemplaza los códigos de respaldo (los anteriores dejan de servir). */
  async regenerateRecoveryCodes(userId: string, code: string) {
    await this.assertCode(userId, code);
    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpRecoveryCodes: recoveryCodes.map(hashRecoveryCode) },
    });
    return { recoveryCodes };
  }

  /**
   * ¿Es válido este código para este operador? Acepta el de la app (una sola
   * vez por paso de 30 s) o un código de respaldo, que se consume. Las dos
   * escrituras son condicionales para que dos peticiones simultáneas no puedan
   * usar el mismo código.
   */
  async verifyCode(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        totpSecret: true,
        totpEnabledAt: true,
        totpLastStep: true,
        totpRecoveryCodes: true,
      },
    });
    if (!user?.totpEnabledAt || !user.totpSecret) return false;

    const trimmed = code.trim();
    if (/^\d{6}$/.test(trimmed.replace(/\s/g, ''))) {
      const step = verifyTotp(open(user.totpSecret, this.key), trimmed, {
        lastStep: user.totpLastStep,
      });
      if (step === null) return false;
      const r = await this.prisma.user.updateMany({
        where: {
          id: userId,
          OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }],
        },
        data: { totpLastStep: step },
      });
      return r.count === 1;
    }

    const hash = hashRecoveryCode(trimmed);
    if (!user.totpRecoveryCodes.includes(hash)) return false;
    const r = await this.prisma.user.updateMany({
      where: { id: userId, totpRecoveryCodes: { has: hash } },
      data: {
        totpRecoveryCodes: user.totpRecoveryCodes.filter((h) => h !== hash),
      },
    });
    return r.count === 1;
  }

  private async assertCode(userId: string, code: string) {
    if (!(await this.verifyCode(userId, code))) {
      throw new BadRequestException(INVALID_CODE);
    }
  }
}
