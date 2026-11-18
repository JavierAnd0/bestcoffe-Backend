import { IsString, Matches, MaxLength } from 'class-validator';

/** Regreso de Checkout Pro: pedido y pago que MercadoPago puso en la URL. */
export class SyncPaymentDto {
  @IsString()
  @MaxLength(40)
  orderId!: string;

  @IsString()
  @Matches(/^\d{1,20}$/, { message: 'paymentId inválido' })
  paymentId!: string;
}
