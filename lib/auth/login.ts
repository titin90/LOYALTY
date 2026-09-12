/**
 * Verificación de credenciales del dueño. Separada del server action para poder
 * testearla contra base real.
 */
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withAnonSession } from '@/lib/db/client';
import { rootCauseMessage, sqlState } from '@/lib/db/errors';
import type { MemberSession } from './session';

export const loginInputSchema = z.object({
  email: z.string().trim().min(1, 'Escribe tu correo').email('Revisa el correo'),
  password: z.string().min(1, 'Escribe tu contraseña'),
});

export type LoginOutcome =
  | { ok: true; session: Omit<MemberSession, 'exp'> }
  | { ok: false; kind: 'validation'; fieldErrors: Record<string, string> }
  | { ok: false; kind: 'rejected'; message: string };

interface AuthRow {
  [key: string]: unknown;
  r: {
    ok: boolean;
    error?: string;
    user_id?: string;
    tenant_id?: string;
    tenant_slug?: string;
    name?: string;
    role?: 'owner' | 'staff';
  };
}

const MENSAJES: Record<string, string> = {
  // Mismo texto para correo desconocido y contraseña errónea: distinguirlos
  // revela qué direcciones están registradas en la plataforma.
  bad_credentials: 'Correo o contraseña incorrectos.',
  locked: 'Demasiados intentos. Espera 15 minutos.',
  tenant_inactive: 'Esta cuenta está suspendida. Escríbenos para reactivarla.',
};

export async function signIn(input: unknown): Promise<LoginOutcome> {
  const parsed = loginInputSchema.safeParse(input);

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, kind: 'validation', fieldErrors };
  }

  try {
    const rows = await withAnonSession(async (tx) => {
      const result = (await tx.execute<AuthRow>(
        sql`select app.authenticate_member(${parsed.data.email}, ${parsed.data.password}) as r`,
      )) as unknown as AuthRow[];
      return result;
    });

    const r = rows[0]?.r;
    if (!r || r.ok !== true) {
      return {
        ok: false,
        kind: 'rejected',
        message: MENSAJES[r?.error ?? ''] ?? MENSAJES.bad_credentials!,
      };
    }

    return {
      ok: true,
      session: {
        userId: r.user_id!,
        tenantId: r.tenant_id!,
        tenantSlug: r.tenant_slug!,
        name: r.name!,
        role: r.role!,
      },
    };
  } catch (error) {
    console.error('[login] fallo inesperado', { sqlState: sqlState(error), raw: rootCauseMessage(error) });
    return { ok: false, kind: 'rejected', message: 'No pudimos iniciar sesión. Inténtalo de nuevo.' };
  }
}
