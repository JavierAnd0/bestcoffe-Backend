import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Prisma, SiteContentKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RevalidationService } from '../revalidation/revalidation.service';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { ListContentDto } from './dto/list-content.dto';
import {
  AnnouncementDataDto,
  FeaturedBundleDataDto,
  HeroDataDto,
  SpotlightDataDto,
} from './dto/content-data.dto';

/** Mapa kind → clase DTO que valida la forma de `data`. */
const DATA_DTO: Record<SiteContentKind, new () => object> = {
  [SiteContentKind.ANNOUNCEMENT]: AnnouncementDataDto,
  [SiteContentKind.HERO]: HeroDataDto,
  [SiteContentKind.SPOTLIGHT]: SpotlightDataDto,
  [SiteContentKind.FEATURED_BUNDLE]: FeaturedBundleDataDto,
};

@Injectable()
export class AdminContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidation: RevalidationService,
  ) {}

  /** Listado admin: todos los bloques (incluye inactivos), opcional por kind. */
  async list(tenantId: string, dto: ListContentDto) {
    return this.prisma.siteContent.findMany({
      where: { tenantId, ...(dto.kind && { kind: dto.kind }) },
      orderBy: [{ kind: 'asc' }, { position: 'asc' }],
    });
  }

  async findOne(tenantId: string, id: string) {
    const block = await this.prisma.siteContent.findFirst({
      where: { id, tenantId },
    });
    if (!block) throw new NotFoundException('Bloque de contenido no encontrado');
    return block;
  }

  async create(tenantId: string, tenantSlug: string, dto: CreateContentDto) {
    const data = this.validateData(dto.kind, dto.data);
    this.assertWindow(dto.startsAt, dto.endsAt);

    const block = await this.prisma.siteContent.create({
      data: {
        tenantId,
        kind: dto.kind,
        data: data as Prisma.InputJsonValue,
        active: dto.active ?? true,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        position: dto.position ?? 0,
      },
    });
    this.revalidation.dispatch(tenantSlug, ['content']);
    return block;
  }

  async update(
    tenantId: string,
    tenantSlug: string,
    id: string,
    dto: UpdateContentDto,
  ) {
    const existing = await this.findOne(tenantId, id);

    const data =
      dto.data !== undefined
        ? (this.validateData(existing.kind, dto.data) as Prisma.InputJsonValue)
        : undefined;

    // ventana efectiva = lo nuevo si vino en el body, si no lo existente
    const startsAt =
      dto.startsAt !== undefined
        ? dto.startsAt
          ? new Date(dto.startsAt)
          : null
        : existing.startsAt;
    const endsAt =
      dto.endsAt !== undefined
        ? dto.endsAt
          ? new Date(dto.endsAt)
          : null
        : existing.endsAt;
    this.assertWindow(startsAt, endsAt);

    const block = await this.prisma.siteContent.update({
      where: { id },
      data: {
        ...(data !== undefined && { data }),
        ...(dto.active !== undefined && { active: dto.active }),
        ...(dto.startsAt !== undefined && { startsAt }),
        ...(dto.endsAt !== undefined && { endsAt }),
        ...(dto.position !== undefined && { position: dto.position }),
      },
    });
    this.revalidation.dispatch(tenantSlug, ['content']);
    return block;
  }

  async remove(tenantId: string, tenantSlug: string, id: string) {
    await this.findOne(tenantId, id);
    await this.prisma.siteContent.delete({ where: { id } });
    this.revalidation.dispatch(tenantSlug, ['content']);
    return { id, deleted: true };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Valida `data` contra el DTO del `kind`; devuelve el objeto saneado. */
  private validateData(
    kind: SiteContentKind,
    data: Record<string, unknown>,
  ): object {
    const instance = plainToInstance(DATA_DTO[kind], data, {
      excludeExtraneousValues: false,
    });
    const errors = validateSync(instance, {
      whitelist: true,
      forbidNonWhitelisted: false,
    });
    if (errors.length) {
      const detail = errors
        .map((e) => Object.values(e.constraints ?? {}).join(', '))
        .filter(Boolean)
        .join('; ');
      throw new BadRequestException(
        `data inválida para ${kind}: ${detail || 'forma incorrecta'}`,
      );
    }
    return instance;
  }

  private assertWindow(
    startsAt?: Date | string | null,
    endsAt?: Date | string | null,
  ) {
    if (!startsAt || !endsAt) return;
    if (new Date(startsAt).getTime() > new Date(endsAt).getTime()) {
      throw new BadRequestException('startsAt no puede ser posterior a endsAt');
    }
  }
}
