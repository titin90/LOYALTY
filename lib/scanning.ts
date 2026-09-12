/**
 * Operaciones del escáner del local. Igual que `lib/registration.ts`, vive
 * separado de los server actions para poder testearse contra una base real.
 *
 * Identidad: el dispositivo trae una cookie firmada (`lib/device/token.ts`) con
 * el miembro del negocio bajo cuya identidad se abre la sesión de base de datos.
 * A partir de ahí manda RLS. El PIN lo verifica Postgres dentro de las funciones
 * `app.record_scan` / `app.redeem_reward`, nunca este código.
 */
import { sql } from 'drizzle-orm';
import { withUserSession } from '@/lib/db/client';
import { rootCauseMessage, sqlState } from '@/lib/db/errors';
import type { DeviceClaims } from '@/lib/device/token';

export interface ScanSuccess {
  readonly customerName: string;
  readonly earned: number;
  readonly balance: number;
  readonly pointsToNextReward: number | null;
  /** El evento ya existía: la cola sin conexión reenvió el mismo marcaje. */
  readonly duplicate: boolean;
}

export type ScanFailure =
  | 'card_not_here'
  | 'bad_pin'
  | 'locked'
  | 'device_revoked'
  | 'too_soon'
  | 'card_blocked'
  | 'unknown';

export type ScanOutcome =
  | { ok: true; result: ScanSuccess }
  | { ok: false; failure: ScanFailure; message: string };

export interface ScanRequest {
  readonly serial: string;
  readonly pin: string;
  readonly claims: DeviceClaims;
  readonly idempotencyKey: string;
}

/**
 * Las rutas de PIN de `app.record_scan` devuelven `{ok:false, error}` en vez de
 * lanzar excepción: una excepción revierte la transacción y con ella el contador
 * de intentos fallidos, que es justo lo que hace posible el bloqueo.
 */
interface ScanRow {
  [key: string]: unknown;
  r: {
    ok: boolean;
    error?: string;
    duplicate: boolean;
    customer_name: string;
    earned?: number;
    balance: number;
    points_to_next_reward: number | null;
  };
}

const AUTH_FAILURES: Record<string, { failure: ScanFailure; message: string }> = {
  bad_pin: { failure: 'bad_pin', message: 'PIN incorrecto.' },
  locked: { failure: 'locked', message: 'Demasiados intentos. Espera 15 minutos.' },
  device_revoked: {
    failure: 'device_revoked',
    message: 'Este equipo ya no está autorizado. Vuelve a emparejarlo.',
  },
};

export async function recordScan(request: ScanRequest): Promise<ScanOutcome> {
  const { serial, pin, claims, idempotencyKey } = request;

  if (!/^[0-9a-f]{32}$/i.test(serial)) {
    return { ok: false, failure: 'card_not_here', message: 'Ese código no es una tarjeta válida.' };
  }
  if (!/^\d{4,8}$/.test(pin)) {
    return { ok: false, failure: 'bad_pin', message: 'El PIN son 4 dígitos.' };
  }

  try {
    return await withUserSession(claims.userId, async (tx) => {
      // Bajo RLS solo existen las tarjetas de este negocio: si no aparece, es de
      // otro local. Distinguirlo aquí evita el mensaje confuso de "PIN inválido".
      const found = (await tx.execute(
        sql`select 1 as ok from public.cards where serial = ${serial}`,
      )) as unknown as unknown[];

      if (found.length === 0) {
        return {
          ok: false as const,
          failure: 'card_not_here' as const,
          message: 'Esta tarjeta no es de este local.',
        };
      }

      const rows = (await tx.execute<ScanRow>(
        sql`select app.record_scan(${serial}, ${pin}, ${claims.deviceId}, ${idempotencyKey}) as r`,
      )) as unknown as ScanRow[];

      const row = rows[0];
      if (!row) throw new Error('record_scan no devolvió resultado');

      if (row.r.ok === false) {
        const mapped = AUTH_FAILURES[row.r.error ?? ''];
        return mapped
          ? { ok: false as const, ...mapped }
          : { ok: false as const, failure: 'unknown' as const, message: 'No se pudo marcar.' };
      }

      return {
        ok: true as const,
        result: {
          customerName: row.r.customer_name,
          earned: row.r.earned ?? 0,
          balance: row.r.balance,
          pointsToNextReward: row.r.points_to_next_reward,
          duplicate: row.r.duplicate,
        },
      };
    });
  } catch (error) {
    return failureFor(error);
  }
}

export interface RedeemRequest {
  readonly serial: string;
  readonly rewardId: string;
  readonly pin: string;
  readonly claims: DeviceClaims;
  readonly idempotencyKey: string;
}

export type RedeemOutcome =
  | { ok: true; reward: string; balance: number; duplicate: boolean }
  | { ok: false; failure: ScanFailure | 'not_enough_points' | 'reward_gone'; message: string };

interface RedeemRow {
  [key: string]: unknown;
  r: { ok: boolean; error?: string; duplicate: boolean; reward?: string; balance?: number };
}

export async function redeemReward(request: RedeemRequest): Promise<RedeemOutcome> {
  const { serial, rewardId, pin, claims, idempotencyKey } = request;

  try {
    return await withUserSession(claims.userId, async (tx) => {
      const rows = (await tx.execute<RedeemRow>(
        sql`select app.redeem_reward(${serial}, ${rewardId}::uuid, ${pin},
                                     ${claims.deviceId}, ${idempotencyKey}) as r`,
      )) as unknown as RedeemRow[];

      const row = rows[0];
      if (!row) throw new Error('redeem_reward no devolvió resultado');

      if (row.r.ok === false) {
        const mapped = AUTH_FAILURES[row.r.error ?? ''];
        return mapped
          ? { ok: false as const, ...mapped }
          : { ok: false as const, failure: 'unknown' as const, message: 'No se pudo canjear.' };
      }

      return {
        ok: true as const,
        reward: row.r.reward ?? '',
        balance: row.r.balance ?? 0,
        duplicate: row.r.duplicate,
      };
    });
  } catch (error) {
    const mapped = failureFor(error);
    const raw = rootCauseMessage(error);

    if (/insuficientes/i.test(raw)) {
      return { ok: false, failure: 'not_enough_points', message: 'Todavía no le alcanzan los puntos.' };
    }
    if (/no disponible/i.test(raw)) {
      return { ok: false, failure: 'reward_gone', message: 'Ese premio ya no está disponible.' };
    }
    return mapped;
  }
}

function failureFor(error: unknown): { ok: false; failure: ScanFailure; message: string } {
  const raw = rootCauseMessage(error);

  if (/PIN invalido/i.test(raw)) {
    return { ok: false, failure: 'bad_pin', message: 'PIN incorrecto.' };
  }
  if (/bloqueada temporalmente/i.test(raw)) {
    return { ok: false, failure: 'locked', message: 'Demasiados intentos. Espera 15 minutos.' };
  }
  if (/Dispositivo no autorizado/i.test(raw)) {
    return {
      ok: false,
      failure: 'device_revoked',
      message: 'Este equipo ya no está autorizado. Vuelve a emparejarlo.',
    };
  }
  if (/hace poco/i.test(raw)) {
    return { ok: false, failure: 'too_soon', message: 'Esta tarjeta ya sumó una visita hace poco.' };
  }
  if (/Tarjeta bloqueada/i.test(raw)) {
    return { ok: false, failure: 'card_blocked', message: 'Esta tarjeta está bloqueada.' };
  }
  if (/Tarjeta no encontrada/i.test(raw)) {
    return { ok: false, failure: 'card_not_here', message: 'Esta tarjeta no es de este local.' };
  }

  // Solo causa raíz y SQLSTATE: el mensaje del envoltorio lleva la consulta
  // con sus parámetros (CLAUDE.md regla 14).
  console.error('[escaner] fallo inesperado', { sqlState: sqlState(error), raw });
  return { ok: false, failure: 'unknown', message: 'No se pudo marcar. Inténtalo de nuevo.' };
}
