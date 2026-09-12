/**
 * Diseño de la tarjeta, compartido por Apple y Google.
 *
 * Se guarda versionado en `card_designs.config`. Va validado con Zod porque
 * viene de jsonb: la base no comprueba su forma, y una configuración rota no
 * puede romper la emisión de pases de todos los clientes de un negocio.
 */
import { z } from 'zod';

/** Paleta de marca por defecto — ver idea-2-identidad-visual.md. */
export const MARCA = {
  negroCalido: '#171412',
  dorado: '#B8955A',
  crema: '#F5F1E8',
} as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color hexadecimal de 6 dígitos');

export const cardDesignSchema = z.object({
  /** Fondo de la tarjeta. */
  background: hex.default(MARCA.negroCalido),
  /** Texto principal y números. */
  foreground: hex.default(MARCA.crema),
  /** Etiquetas de los campos: el dorado es acento, nunca fondo. */
  label: hex.default(MARCA.dorado),
  /** Texto del logo sobre la tarjeta. Por defecto, el nombre del negocio. */
  logoText: z.string().trim().max(40).optional(),
  /** Cómo se llama la unidad que acumula el cliente. */
  unitLabel: z.string().trim().min(1).max(16).default('VISITAS'),
  /** Encabezado de la cara trasera. */
  backTitle: z.string().trim().max(60).default('Cómo funciona'),
});

export type CardDesign = z.output<typeof cardDesignSchema>;

export function parseCardDesign(raw: unknown): CardDesign {
  const result = cardDesignSchema.safeParse(raw ?? {});
  // Una configuración inválida cae a los valores de marca en vez de romper la
  // emisión: es preferible una tarjeta genérica a un cliente sin tarjeta.
  return result.success ? result.data : cardDesignSchema.parse({});
}

/** Apple espera los colores como `rgb(r,g,b)`, no como hexadecimal. */
export function hexToRgbCss(value: string): string {
  const n = Number.parseInt(value.slice(1), 16);
  return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`;
}
