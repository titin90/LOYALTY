/**
 * Clases y objetos de Google Wallet.
 *
 * Modelo: una `LoyaltyClass` por negocio (el programa) y un `LoyaltyObject` por
 * cliente (su tarjeta). Actualizar puntos es un PATCH sobre el objeto y llega
 * casi al instante, sin push propio — bastante más simple que Apple.
 *
 * Los identificadores van siempre como `<issuerId>.<sufijo>`, y el sufijo solo
 * admite alfanuméricos, punto, guion y guion bajo: cualquier otra cosa la
 * rechaza la API con un error poco claro, así que se sanea aquí.
 */
import type { CardDesign } from '@/lib/wallet/design';

const SUFIJO_INVALIDO = /[^A-Za-z0-9._-]/g;

export function walletId(issuerId: string, suffix: string): string {
  const limpio = suffix.replace(SUFIJO_INVALIDO, '_');

  // Un sufijo que al sanear queda solo en separadores no distingue nada: dos
  // negocios distintos colisionarían en el mismo identificador.
  if (!/[A-Za-z0-9]/.test(limpio)) {
    throw new Error(`El sufijo "${suffix}" queda vacío al sanear`);
  }

  return `${issuerId}.${limpio}`;
}

export interface LoyaltyClassInput {
  readonly issuerId: string;
  readonly tenantSlug: string;
  readonly programName: string;
  readonly issuerName: string;
  readonly design: CardDesign;
}

export function buildLoyaltyClass(input: LoyaltyClassInput): Record<string, unknown> {
  return {
    id: walletId(input.issuerId, `programa_${input.tenantSlug}`),
    issuerName: input.issuerName,
    programName: input.programName,
    reviewStatus: 'UNDER_REVIEW',
    hexBackgroundColor: input.design.background,
    countryCode: 'CL',
    // Avisa al cliente cuando cambian sus puntos: el equivalente al
    // changeMessage de Apple, y por la misma razón.
    enableSmartTap: false,
    multipleDevicesAndHoldersAllowedStatus: 'ONE_USER_ALL_DEVICES',
  };
}

export interface LoyaltyObjectInput {
  readonly issuerId: string;
  readonly tenantSlug: string;
  readonly serial: string;
  readonly customerName: string;
  readonly balance: number;
  readonly progressText: string;
  readonly design: CardDesign;
}

export function buildLoyaltyObject(input: LoyaltyObjectInput): Record<string, unknown> {
  return {
    id: walletId(input.issuerId, `tarjeta_${input.serial}`),
    classId: walletId(input.issuerId, `programa_${input.tenantSlug}`),
    state: 'ACTIVE',
    accountId: input.serial,
    accountName: input.customerName,
    loyaltyPoints: {
      label: input.design.unitLabel,
      balance: { int: input.balance },
    },
    barcode: {
      type: 'QR_CODE',
      value: input.serial,
      alternateText: input.customerName,
    },
    textModulesData: [
      { id: 'progreso', header: 'PRÓXIMO PREMIO', body: input.progressText },
    ],
  };
}
