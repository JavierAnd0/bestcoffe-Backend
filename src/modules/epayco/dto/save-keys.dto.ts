import { IsBoolean, IsString, Matches, MaxLength } from 'class-validator';

/** Llaves del panel de ePayco (Configuración → Personalizaciones → Llaves secretas). */
export class SaveEpaycoKeysDto {
  /** P_CUST_ID_CLIENTE */
  @IsString()
  @Matches(/^\s*\d{1,20}\s*$/, { message: 'El Customer ID son solo números' })
  customerId!: string;

  /** P_KEY */
  @IsString()
  @Matches(/^\s*[A-Za-z0-9]{8,128}\s*$/, { message: 'P_KEY inválida' })
  pKey!: string;

  /** PUBLIC_KEY */
  @IsString()
  @Matches(/^\s*[A-Za-z0-9]{8,128}\s*$/, { message: 'Llave pública inválida' })
  publicKey!: string;

  /** PRIVATE_KEY */
  @IsString()
  @MaxLength(128)
  @Matches(/^\s*[A-Za-z0-9]{8,128}\s*$/, { message: 'Llave privada inválida' })
  privateKey!: string;

  /** true: entorno de pruebas de ePayco (no se cobra dinero real). */
  @IsBoolean()
  test!: boolean;
}
