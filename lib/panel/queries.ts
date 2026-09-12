/**
 * Consultas del panel del dueño.
 *
 * Ninguna filtra por `tenant_id`: todas corren dentro de `withUserSession`, así
 * que RLS ya decidió qué filas existen. Es la propiedad que hace seguro que este
 * archivo crezca — olvidar un filtro aquí no puede filtrar datos de otro negocio.
 */
import { sql } from 'drizzle-orm';
import { withUserSession } from '@/lib/db/client';
import { assessRisk, type RiskAssessment } from '@/lib/domain/risk';
import { formatChileanPhone } from '@/lib/domain/phone';

async function rows<T>(userId: string, query: ReturnType<typeof sql>): Promise<T[]> {
  return withUserSession(userId, async (tx) => {
    const result = (await tx.execute(query)) as unknown as T[];
    return result;
  });
}

export interface Resumen {
  clientes: number;
  clientesNuevosMes: number;
  visitasMes: number;
  canjesMes: number;
  escaneosSemana: number;
}

export async function resumen(userId: string): Promise<Resumen> {
  const [fila] = await rows<Record<string, string>>(
    userId,
    sql`
      select
        (select count(*) from customers where deleted_at is null) as clientes,
        (select count(*) from customers
          where deleted_at is null and created_at >= date_trunc('month', now())) as nuevos,
        (select count(*) from point_events
          where kind = 'earn' and created_at >= date_trunc('month', now())) as visitas,
        (select count(*) from redemptions
          where created_at >= date_trunc('month', now())) as canjes,
        (select count(*) from point_events
          where kind = 'earn' and created_at >= now() - interval '7 days') as semana
    `,
  );

  return {
    clientes: Number(fila?.clientes ?? 0),
    clientesNuevosMes: Number(fila?.nuevos ?? 0),
    visitasMes: Number(fila?.visitas ?? 0),
    canjesMes: Number(fila?.canjes ?? 0),
    escaneosSemana: Number(fila?.semana ?? 0),
  };
}

export interface ClienteFila {
  id: string;
  nombre: string;
  telefono: string;
  telefonoLegible: string;
  saldo: number;
  visitas: number;
  ultimaVisita: Date | null;
  desde: Date;
}

interface ClienteRow {
  id: string;
  name: string;
  phone_e164: string;
  points_balance: number;
  visitas: string;
  ultima_visita: string | null;
  created_at: string;
}

export async function clientes(
  userId: string,
  busqueda = '',
  limite = 50,
): Promise<ClienteFila[]> {
  const patron = `%${busqueda.trim().toLowerCase()}%`;

  const filas = await rows<ClienteRow>(
    userId,
    sql`
      select c.id, c.name, c.phone_e164, k.points_balance, c.created_at,
             (select count(*) from point_events e where e.card_id = k.id and e.kind = 'earn') as visitas,
             (select max(e.created_at) from point_events e where e.card_id = k.id and e.kind = 'earn') as ultima_visita
      from customers c
      join cards k on k.customer_id = c.id
      where c.deleted_at is null
        and (${busqueda.trim() === ''} or lower(c.name) like ${patron} or c.phone_e164 like ${patron})
      order by ultima_visita desc nulls last, c.created_at desc
      limit ${limite}
    `,
  );

  return filas.map((f) => ({
    id: f.id,
    nombre: f.name,
    telefono: f.phone_e164,
    telefonoLegible: formatChileanPhone(f.phone_e164),
    saldo: f.points_balance,
    visitas: Number(f.visitas),
    ultimaVisita: f.ultima_visita ? new Date(f.ultima_visita) : null,
    desde: new Date(f.created_at),
  }));
}

export interface ClienteEnRiesgo extends ClienteFila {
  riesgo: RiskAssessment;
}

/**
 * Clientes que llevan más del doble de SU PROPIA cadencia sin venir.
 *
 * El cálculo se hace en TypeScript con `assessRisk`, la misma función pura que
 * está cubierta por tests: no hay una segunda implementación en SQL que pueda
 * divergir de la primera.
 */
export async function clientesEnRiesgo(userId: string): Promise<ClienteEnRiesgo[]> {
  const filas = await rows<ClienteRow & { visitas_fechas: string[]; risk_multiplier: number }>(
    userId,
    sql`
      select c.id, c.name, c.phone_e164, k.points_balance, c.created_at,
             (select count(*) from point_events e where e.card_id = k.id and e.kind = 'earn') as visitas,
             (select max(e.created_at) from point_events e where e.card_id = k.id and e.kind = 'earn') as ultima_visita,
             -- jsonb y no array_agg: un timestamptz[] no vuelve como arreglo de
             -- JavaScript, y el error aparecería recién al renderizar.
             coalesce((select jsonb_agg(e.created_at order by e.created_at)
                       from point_events e where e.card_id = k.id and e.kind = 'earn'),
                      '[]'::jsonb) as visitas_fechas,
             s.risk_multiplier
      from customers c
      join cards k on k.customer_id = c.id
      join tenant_settings s on true
      where c.deleted_at is null
    `,
  );

  const ahora = new Date();

  return filas
    .map((f) => ({
      id: f.id,
      nombre: f.name,
      telefono: f.phone_e164,
      telefonoLegible: formatChileanPhone(f.phone_e164),
      saldo: f.points_balance,
      visitas: Number(f.visitas),
      ultimaVisita: f.ultima_visita ? new Date(f.ultima_visita) : null,
      desde: new Date(f.created_at),
      riesgo: assessRisk(
        (Array.isArray(f.visitas_fechas) ? f.visitas_fechas : []).map((d) => new Date(d)),
        f.risk_multiplier,
        ahora,
      ),
    }))
    .filter((c) => c.riesgo.atRisk)
    .sort((a, b) => (b.riesgo.daysSinceLastVisit ?? 0) - (a.riesgo.daysSinceLastVisit ?? 0));
}

export interface Premio {
  id: string;
  nombre: string;
  umbral: number;
  activo: boolean;
}

export async function premios(userId: string): Promise<Premio[]> {
  const filas = await rows<{ id: string; name: string; threshold: number; active: boolean }>(
    userId,
    sql`select id, name, threshold, active from rewards order by sort_order, threshold`,
  );
  return filas.map((f) => ({ id: f.id, nombre: f.name, umbral: f.threshold, activo: f.active }));
}

/** Diseño publicado vigente del negocio, o null si nunca publicó uno. */
export async function disenoVigente(userId: string): Promise<unknown | null> {
  const filas = await rows<{ config: unknown }>(
    userId,
    sql`select config from card_designs where published_at is not null
        order by version desc limit 1`,
  );
  return filas[0]?.config ?? null;
}

export interface Equipo {
  id: string;
  nombre: string;
  ultimaVez: Date | null;
  revocado: boolean;
  bloqueado: boolean;
}

export async function equipos(userId: string): Promise<Equipo[]> {
  const filas = await rows<{
    id: string;
    name: string;
    last_seen_at: string | null;
    revoked_at: string | null;
    locked_until: string | null;
  }>(userId, sql`select id, name, last_seen_at, revoked_at, locked_until from devices order by created_at`);

  return filas.map((f) => ({
    id: f.id,
    nombre: f.name,
    ultimaVez: f.last_seen_at ? new Date(f.last_seen_at) : null,
    revocado: f.revoked_at !== null,
    bloqueado: f.locked_until !== null && new Date(f.locked_until) > new Date(),
  }));
}

export interface Movimiento {
  cuando: Date;
  cliente: string;
  tipo: string;
  delta: number;
}

export async function actividad(userId: string, limite = 20): Promise<Movimiento[]> {
  const filas = await rows<{ created_at: string; name: string; kind: string; delta: number }>(
    userId,
    sql`
      select e.created_at, c.name, e.kind, e.delta
      from point_events e
      join cards k on k.id = e.card_id
      join customers c on c.id = k.customer_id
      order by e.created_at desc
      limit ${limite}
    `,
  );

  return filas.map((f) => ({
    cuando: new Date(f.created_at),
    cliente: f.name,
    tipo: f.kind,
    delta: f.delta,
  }));
}
