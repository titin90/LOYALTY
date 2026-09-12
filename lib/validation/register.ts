import { z } from 'zod';
import { normalizeChileanPhone } from '@/lib/domain/phone';

/** Zod en el borde: nada entra al servidor sin validarse (CLAUDE.md regla 16). */
export const registerInputSchema = z.object({
  tenantSlug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/, 'Negocio inválido'),
  name: z
    .string()
    .trim()
    .min(2, 'Escribe tu nombre')
    .max(80, 'El nombre es demasiado largo'),
  phone: z
    .string()
    .trim()
    .min(1, 'Escribe tu teléfono')
    .transform((value, ctx) => {
      const result = normalizeChileanPhone(value);
      if (!result.ok) {
        ctx.addIssue({
          code: 'custom',
          message: 'Revisa el número: debe ser un celular chileno, como +56 9 1234 5678',
        });
        return z.NEVER;
      }
      return result.e164;
    }),
  referralCode: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((value) => {
      if (!value) return undefined;
      const asPhone = normalizeChileanPhone(value);
      return asPhone.ok ? asPhone.e164 : value;
    }),
  consent: z.literal(true, { error: 'Necesitamos tu autorización para crear la tarjeta' }),
});

export type RegisterInput = z.input<typeof registerInputSchema>;
export type RegisterParsed = z.output<typeof registerInputSchema>;
