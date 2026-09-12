/**
 * Lógica del web service de Apple Wallet.
 *
 * El protocolo lo define Apple y es fijo: rutas, verbos, cabeceras y códigos de
 * estado. No se renombra ni se "mejora" nada de esto (CLAUDE.md).
 */
import { sql } from 'drizzle-orm';
import { withAnonSession } from '@/lib/db/client';

/** `Authorization: ApplePass <token>` — no es autenticación de usuario. */
export function applePassToken(header: string | null): string | null {
  if (!header) return null;
  const prefijo = 'ApplePass ';
  return header.startsWith(prefijo) ? header.slice(prefijo.length).trim() || null : null;
}

export async function registerDevice(
  serial: string,
  authToken: string,
  deviceLibraryId: string,
  pushToken: string,
): Promise<boolean> {
  return callBoolean(
    sql`select app.apple_register_device(${serial}, ${authToken},
                                         ${deviceLibraryId}, ${pushToken}) as r`,
  );
}

export async function unregisterDevice(
  serial: string,
  authToken: string,
  deviceLibraryId: string,
): Promise<boolean> {
  return callBoolean(
    sql`select app.apple_unregister_device(${serial}, ${authToken}, ${deviceLibraryId}) as r`,
  );
}

export interface UpdatedSerials {
  serialNumbers: string[];
  lastUpdated: string;
}

export async function updatedSerials(
  deviceLibraryId: string,
  since: string | null,
): Promise<UpdatedSerials> {
  const rows = await withAnonSession(async (tx) => {
    const result = (await tx.execute<{ [k: string]: unknown; r: UpdatedSerials }>(
      sql`select app.apple_updated_serials(${deviceLibraryId},
            ${since === null ? null : new Date(Number(since) * 1000 || Date.parse(since))}) as r`,
    )) as unknown as { r: UpdatedSerials }[];
    return result;
  });

  return rows[0]?.r ?? { serialNumbers: [], lastUpdated: new Date().toISOString() };
}

async function callBoolean(query: ReturnType<typeof sql>): Promise<boolean> {
  const rows = await withAnonSession(async (tx) => {
    const result = (await tx.execute<{ [k: string]: unknown; r: boolean }>(query)) as unknown as {
      r: boolean;
    }[];
    return result;
  });
  return rows[0]?.r === true;
}
