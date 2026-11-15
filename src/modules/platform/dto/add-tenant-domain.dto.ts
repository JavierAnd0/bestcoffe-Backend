import { ApiProperty } from '@nestjs/swagger';
import { IsFQDN } from 'class-validator';

export class AddTenantDomainDto {
  @ApiProperty({
    description: 'Dominio propio de la tienda (sin https://)',
    example: 'tienda.caferoma.com',
  })
  @IsFQDN()
  domain!: string;
}
