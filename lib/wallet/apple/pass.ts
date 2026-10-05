/**
 * Construcción de `pass.json` para una tarjeta de fidelización (storeCard).
 *
 * El detalle que más importa del archivo: `changeMessage`. Cuando el pase se
 * actualiza, Apple muestra ese texto como notificación en la pantalla bloqueada.
 * Es un canal push directo al cliente sin aplicación instalada y sin costo de
 * SMS — el argumento central del producto. Un campo sin `changeMessage` se
 * actualiza en silencio.
 */
import { hexToRgbCss, type CardDesign } from '@/lib/wallet/design';

export interface PassInput {
  readonly serial: string;
  readonly authenticationToken: string;
  readonly organizationName: string;
  readonly customerName: string;
  readonly balance: number;
  readonly pointsToNextReward: number | null;
  readonly rewardName: string | null;
  readonly design: CardDesign;
  /** Enlace de reseña, solo cuando corresponde pedirla. */
  readonly reviewUrl: string | null;
  readonly passTypeIdentifier: string;
  readonly teamIdentifier: string;
  readonly webServiceUrl: string;
}

export function buildPassJson(input: PassInput): Record<string, unknown> {
  const {
    serial,
    authenticationToken,
    organizationName,
    customerName,
    balance,
    pointsToNextReward,
    rewardName,
    design,
    reviewUrl,
    passTypeIdentifier,
    teamIdentifier,
    webServiceUrl,
  } = input;

  return {
    formatVersion: 1,
    passTypeIdentifier,
    teamIdentifier,
    serialNumber: serial,
    organizationName,
    description: `Tarjeta de fidelización de ${organizationName}`,
    logoText: design.logoText ?? organizationName,
    backgroundColor: hexToRgbCss(design.background),
    foregroundColor: hexToRgbCss(design.foreground),
    labelColor: hexToRgbCss(design.label),
    webServiceURL: webServiceUrl,
    authenticationToken,
    sharingProhibited: true,
    barcodes: [
      {
        format: 'PKBarcodeFormatQR',
        message: serial,
        messageEncoding: 'iso-8859-1',
        altText: customerName,
      },
    ],
    storeCard: {
      headerFields: [
        {
          key: 'balance',
          label: design.unitLabel,
          value: balance,
          // Sin %@ no hay notificación: Apple lo exige para avisar del cambio.
          changeMessage: `Ahora tienes %@ ${design.unitLabel.toLowerCase()}`,
        },
      ],
      secondaryFields: [
        {
          key: 'progress',
          label: 'PRÓXIMO PREMIO',
          value: progressText(pointsToNextReward, rewardName),
          changeMessage: '%@',
        },
      ],
      backFields: [
        {
          key: 'como-funciona',
          label: design.backTitle,
          value:
            'Muestra el código de esta tarjeta cada vez que vengas y suma una ' +
            'visita. Al llegar al total, canjea tu premio en el local.',
        },
        {
          key: 'titular',
          label: 'A nombre de',
          value: customerName,
        },
        // El enlace aparece solo cuando toca pedir la reseña, y nunca a cambio
        // de puntos: eso viola las políticas de Google.
        ...(reviewUrl === null
          ? []
          : [
              {
                key: 'resena',
                label: '¿Cómo lo hicimos?',
                value: `Cuéntale a otros cómo te fue: ${reviewUrl}`,
                changeMessage: '%@',
              },
            ]),
      ],
    },
  };
}

export function progressText(
  pointsToNextReward: number | null,
  rewardName: string | null,
): string {
  if (rewardName === null) return 'Sigue sumando visitas';
  if (pointsToNextReward === null || pointsToNextReward <= 0) {
    return `¡Ya puedes canjear ${rewardName}!`;
  }
  return pointsToNextReward === 1
    ? `Te falta 1 visita para ${rewardName}`
    : `Te faltan ${pointsToNextReward} visitas para ${rewardName}`;
}
