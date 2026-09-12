/**
 * Registro de un cliente en un negocio.
 *
 * Vive separado del server action a propósito: el action solo traduce FormData,
 * pone la cookie y redirige. Toda la lógica que importa está aquí, donde puede
 * testearse contra una base de datos real sin montar una petición HTTP.
 */
import { sql } from 'drizzle-orm';
import { withAnonSession } from '@/lib/db/client';
import { registerInputSchema } from '@/lib/validation/register';
import { CONSENT_VERSION } from '@/lib/consent';
import { rootCauseMessage, sqlState } from '@/lib/db/errors';

export type RegisterOutcome =
  | { ok: true; serial: string; created: boolean }
  | { ok: false; kind: 'validation'; fieldErrors: Record<string, string> }
  | { ok: false; kind: 'rejected'; message: string };

interface RegisterCustomerRow {
  [key: string]: unknown;
  r: { serial: string; created: boolean };
}

export async function registerCard(input: unknown): Promise<RegisterOutcome> {
  const parsed = registerInputSchema.safeParse(input);

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, kind: 'validation', fieldErrors };
  }

  const { tenantSlug, name, phone, referralCode } = parsed.data;

  try {
    const result = await withAnonSession(async (tx) => {
      const rows = (await tx.execute<RegisterCustomerRow>(
        sql`select app.register_customer(
              ${tenantSlug}, ${name}, ${phone}, ${CONSENT_VERSION}, ${referralCode ?? null}
            ) as r`,
      )) as unknown as RegisterCustomerRow[];

      const row = rows[0];
      if (!row) throw new Error('register_customer no devolvió resultado');
      return row.r;
    });

    return { ok: true, serial: result.serial, created: result.created };
  } catch (error) {
    return { ok: false, kind: 'rejected', message: messageFor(error) };
  }
}

/**
 * Traduce los errores de la función SQL a algo que el cliente entienda.
 *
 * Lee la cadena de `cause`: el `message` del envoltorio de Drizzle es la consulta
 * con sus parámetros, y ese texto no se lee ni se registra nunca.
 */
function messageFor(error: unknown): string {
  const raw = rootCauseMessage(error);

  if (/Telefono invalido/i.test(raw)) return 'Revisa el número de teléfono.';
  if (/Negocio no encontrado/i.test(raw)) return 'Este negocio no está disponible.';
  if (/Nombre requerido/i.test(raw)) return 'Escribe tu nombre.';

  // Solo la causa raíz y el SQLSTATE: nunca el texto de la consulta.
  console.error('[registro] fallo inesperado', { sqlState: sqlState(error), raw });
  return 'No pudimos crear tu tarjeta. Inténtalo de nuevo en un momento.';
}
