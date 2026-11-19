import { IsString, Matches, MaxLength } from 'class-validator';

/** Regreso de ePayco: pedido y referencia que ePayco puso en la URL. */
export class SyncEpaycoPaymentDto {
  @IsString()
  @MaxLength(40)
  orderId!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9]{1,64}$/, { message: 'ref_payco inválido' })
  refPayco!: string;
}
