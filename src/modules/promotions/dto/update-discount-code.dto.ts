import { PartialType } from '@nestjs/swagger';
import { CreateDiscountCodeDto } from './create-discount-code.dto';

/** Edición de un código: todo opcional (incluye `code`, se re-valida unicidad). */
export class UpdateDiscountCodeDto extends PartialType(CreateDiscountCodeDto) {}
