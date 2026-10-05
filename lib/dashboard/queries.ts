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

export interface DashboardSummary {
  customers: number;
  newCustomersThisMonth: number;
  visitsThisMonth: number;
  redemptionsThisMonth: number;
  scansThisWeek: number;
}

export async function dashboardSummary(userId: string): Promise<DashboardSummary> {
  const [fila] = await rows<Record<string, string>>(
    userId,
    sql`
      select
        (select count(*) from customers where deleted_at is null) as customers,
        (select count(*) from customers
          where deleted_at is null and created_at >= date_trunc('month', now())) as new_customers,
        (select count(*) from point_events
          where kind = 'earn' and created_at >= date_trunc('month', now())) as visits,
        (select count(*) from redemptions
          where created_at >= date_trunc('month', now())) as redemptions,
        (select count(*) from point_events
          where kind = 'earn' and created_at >= now() - interval '7 days') as scans_week
    `,
  );

  return {
    customers: Number(fila?.customers ?? 0),
    newCustomersThisMonth: Number(fila?.new_customers ?? 0),
    visitsThisMonth: Number(fila?.visits ?? 0),
    redemptionsThisMonth: Number(fila?.redemptions ?? 0),
    scansThisWeek: Number(fila?.scans_week ?? 0),
  };
}

export interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  phoneFormatted: string;
  balance: number;
  visits: number;
  lastVisit: Date | null;
  since: Date;
}

interface CustomerQueryRow {
  id: string;
  name: string;
  phone_e164: string;
  points_balance: number;
  visits: string;
  last_visit: string | null;
  created_at: string;
}

export async function customers(
  userId: string,
  busqueda = '',
  limit = 50,
): Promise<CustomerRow[]> {
  const patron = `%${busqueda.trim().toLowerCase()}%`;

  const filas = await rows<CustomerQueryRow>(
    userId,
    sql`
      select c.id, c.name, c.phone_e164, k.points_balance, c.created_at,
             (select count(*) from point_events e where e.card_id = k.id and e.kind = 'earn') as visits,
             (select max(e.created_at) from point_events e where e.card_id = k.id and e.kind = 'earn') as last_visit
      from customers c
      join cards k on k.customer_id = c.id
      where c.deleted_at is null
        and (${busqueda.trim() === ''} or lower(c.name) like ${patron} or c.phone_e164 like ${patron})
      order by last_visit desc nulls last, c.created_at desc
      limit ${limit}
    `,
  );

  return filas.map((f) => ({
    id: f.id,
    name: f.name,
    phone: f.phone_e164,
    phoneFormatted: formatChileanPhone(f.phone_e164),
    balance: f.points_balance,
    visits: Number(f.visits),
    lastVisit: f.last_visit ? new Date(f.last_visit) : null,
    since: new Date(f.created_at),
  }));
}

export interface AtRiskCustomer extends CustomerRow {
  risk: RiskAssessment;
}

/**
 * Clientes que llevan más del doble de SU PROPIA cadencia sin venir.
 *
 * El cálculo se hace en TypeScript con `assessRisk`, la misma función pura que
 * está cubierta por tests: no hay una segunda implementación en SQL que pueda
 * divergir de la primera.
 */
export async function atRiskCustomers(userId: string): Promise<AtRiskCustomer[]> {
  const filas = await rows<CustomerQueryRow & { visit_dates: string[]; risk_multiplier: number }>(
    userId,
    sql`
      select c.id, c.name, c.phone_e164, k.points_balance, c.created_at,
             (select count(*) from point_events e where e.card_id = k.id and e.kind = 'earn') as visits,
             (select max(e.created_at) from point_events e where e.card_id = k.id and e.kind = 'earn') as last_visit,
             -- jsonb y no array_agg: un timestamptz[] no vuelve como arreglo de
             -- JavaScript, y el error aparecería recién al renderizar.
             coalesce((select jsonb_agg(e.created_at order by e.created_at)
                       from point_events e where e.card_id = k.id and e.kind = 'earn'),
                      '[]'::jsonb) as visit_dates,
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
      name: f.name,
      phone: f.phone_e164,
      phoneFormatted: formatChileanPhone(f.phone_e164),
      balance: f.points_balance,
      visits: Number(f.visits),
      lastVisit: f.last_visit ? new Date(f.last_visit) : null,
      since: new Date(f.created_at),
      risk: assessRisk(
        (Array.isArray(f.visit_dates) ? f.visit_dates : []).map((d) => new Date(d)),
        f.risk_multiplier,
        ahora,
      ),
    }))
    .filter((c) => c.risk.atRisk)
    .sort((a, b) => (b.risk.daysSinceLastVisit ?? 0) - (a.risk.daysSinceLastVisit ?? 0));
}

export interface Reward {
  id: string;
  name: string;
  threshold: number;
  active: boolean;
}

export async function listRewards(userId: string): Promise<Reward[]> {
  const filas = await rows<{ id: string; name: string; threshold: number; active: boolean }>(
    userId,
    sql`select id, name, threshold, active from rewards order by sort_order, threshold`,
  );
  return filas.map((f) => ({ id: f.id, name: f.name, threshold: f.threshold, active: f.active }));
}

/** Diseño publicado vigente del negocio, o null si nunca publicó uno. */
export async function publishedCardDesign(userId: string): Promise<unknown | null> {
  const filas = await rows<{ config: unknown }>(
    userId,
    sql`select config from card_designs where published_at is not null
        order by version desc limit 1`,
  );
  return filas[0]?.config ?? null;
}

export interface Device {
  id: string;
  name: string;
  lastSeen: Date | null;
  revoked: boolean;
  locked: boolean;
}

export async function listDevices(userId: string): Promise<Device[]> {
  const filas = await rows<{
    id: string;
    name: string;
    last_seen_at: string | null;
    revoked_at: string | null;
    locked_until: string | null;
  }>(userId, sql`select id, name, last_seen_at, revoked_at, locked_until from devices order by created_at`);

  return filas.map((f) => ({
    id: f.id,
    name: f.name,
    lastSeen: f.last_seen_at ? new Date(f.last_seen_at) : null,
    revoked: f.revoked_at !== null,
    locked: f.locked_until !== null && new Date(f.locked_until) > new Date(),
  }));
}

export interface LedgerEntry {
  at: Date;
  customer: string;
  kind: string;
  delta: number;
}

export async function recentLedger(userId: string, limit = 20): Promise<LedgerEntry[]> {
  const filas = await rows<{ created_at: string; name: string; kind: string; delta: number }>(
    userId,
    sql`
      select e.created_at, c.name, e.kind, e.delta
      from point_events e
      join cards k on k.id = e.card_id
      join customers c on c.id = k.customer_id
      order by e.created_at desc
      limit ${limit}
    `,
  );

  return filas.map((f) => ({
    at: new Date(f.created_at),
    customer: f.name,
    kind: f.kind,
    delta: f.delta,
  }));
}
