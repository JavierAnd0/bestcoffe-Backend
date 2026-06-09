import { PartialType } from '@nestjs/swagger';
import { CreateCollectionDto } from './create-collection.dto';

/** Edición de colección: todo opcional. */
export class UpdateCollectionDto extends PartialType(CreateCollectionDto) {}
