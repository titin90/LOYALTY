/**
 * Derechos ARCO de la Ley 21.719 (acceso, rectificación, supresión, oposición,
 * portabilidad).
 *
 * Quién hace qué: el negocio es el RESPONSABLE de los datos de sus clientes y la
 * plataforma solo el ENCARGADO. Por eso el cliente ejerce sus derechos ante el
 * negocio, y lo que aquí se construye son las herramientas para que el dueño
 * responda: exportar e imprimir lo que hay, y suprimirlo.
 *
 * No hay formulario público para pedir la supresión a distancia: sin verificar
 * identidad, cualquiera podría pedir el borrado de los datos de un tercero solo
 * con saber su teléfono. Verificarla exigiría SMS, que en v1 no existe.
 *
 * Todo corre bajo RLS con la sesión del dueño: no hizo falta ninguna función
 * nueva que salte RLS.
 */
import { sql } from 'drizzle-orm';
import { withUserSession } from '@/lib/db/client';

/** Plazo legal de respuesta. Se fija al crear la solicitud. */
export const DSR_DEADLINE_DAYS = 30;

export type DsrKind = 'access' | 'rectification' | 'deletion' | 'objection' | 'portability';

export interface CustomerExport {
  generatedAt: string;
  business: { name: string };
  subject: { name: string; phone: string; customerSince: string };
  consents: { purpose: string; version: string; grantedAt: string; revokedAt: string | null }[];
  card: { balance: number; estado: string } | null;
  ledger: { date: string; tipo: string; points: number }[];
  redemptions: { date: string; reward: string }[];
}

/**
 * Todo lo que la plataforma guarda sobre una persona, en un formato que se puede
 * entregar tal cual. Derechos de acceso y de portabilidad, en un solo archivo.
 */
export async function exportCustomer(
  userId: string,
  customerId: string,
): Promise<CustomerExport | null> {
  return withUserSession(userId, async (tx) => {
    const run = async <T>(query: ReturnType<typeof sql>): Promise<T[]> =>
      (await tx.execute(query)) as unknown as T[];

    const [customer] = await run<{ name: string; phone_e164: string; created_at: string }>(
      sql`select name, phone_e164, created_at from customers
          where id = ${customerId}::uuid and deleted_at is null`,
    );
    if (!customer) return null;

    const [business] = await run<{ name: string }>(sql`select name from tenants limit 1`);

    const consents = await run<{
      purpose: string;
      version: string;
      granted_at: string;
      revoked_at: string | null;
    }>(
      sql`select purpose, version, granted_at, revoked_at from consents
          where customer_id = ${customerId}::uuid order by granted_at`,
    );

    const [card] = await run<{ id: string; points_balance: number; status: string }>(
      sql`select id, points_balance, status from cards where customer_id = ${customerId}::uuid`,
    );

    const ledger = card
      ? await run<{ created_at: string; kind: string; delta: number }>(
          sql`select created_at, kind, delta from point_events
              where card_id = ${card.id}::uuid order by created_at`,
        )
      : [];

    const redemptions = card
      ? await run<{ created_at: string; name: string }>(
          sql`select d.created_at, r.name from redemptions d
              join rewards r on r.id = d.reward_id
              where d.card_id = ${card.id}::uuid order by d.created_at`,
        )
      : [];

    return {
      generatedAt: new Date().toISOString(),
      business: { name: business?.name ?? '' },
      subject: {
        name: customer.name,
        phone: customer.phone_e164,
        customerSince: customer.created_at,
      },
      consents: consents.map((c) => ({
        purpose: c.purpose,
        version: c.version,
        grantedAt: c.granted_at,
        revokedAt: c.revoked_at,
      })),
      card: card ? { balance: card.points_balance, estado: card.status } : null,
      ledger: ledger.map((m) => ({
        date: m.created_at,
        tipo: m.kind,
        points: m.delta,
      })),
      redemptions: redemptions.map((c) => ({ date: c.created_at, reward: c.name })),
    };
  });
}

export type EraseResult =
  | { ok: true; ledgerEntriesKept: number }
  | { ok: false; reason: 'no_encontrado' };

/**
 * Supresión efectiva e irreversible de los datos personales.
 *
 * La tarjeta y su ledger sobreviven SIN ninguna referencia a la persona
 * (`cards.customer_id` queda nulo): la contabilidad del negocio no puede
 * destruirse al ejercer un derecho, y lo que queda no identifica a nadie.
 */
export async function eraseCustomer(
  userId: string,
  customerId: string,
): Promise<EraseResult> {
  return withUserSession(userId, async (tx) => {
    const run = async <T>(query: ReturnType<typeof sql>): Promise<T[]> =>
      (await tx.execute(query)) as unknown as T[];

    const [card] = await run<{ id: string }>(
      sql`select id from cards where customer_id = ${customerId}::uuid`,
    );

    const [existe] = await run<{ id: string }>(
      sql`select id from customers where id = ${customerId}::uuid`,
    );
    if (!existe) return { ok: false as const, reason: 'no_encontrado' as const };

    const ledger = card
      ? (
          await run<{ n: string }>(
            sql`select count(*) as n from point_events where card_id = ${card.id}::uuid`,
          )
        )[0]
      : undefined;

    if (card) {
      // Cerrada: deja de emitir pases y `record_scan` la rechaza.
      await run(sql`update cards set status = 'closed' where id = ${card.id}::uuid`);
      await run(sql`delete from wallet_passes where card_id = ${card.id}::uuid`);
    }

    // El rastro queda en audit_log, que no guarda datos personales.
    await run(
      sql`insert into audit_log (tenant_id, actor_type, action, target_table, target_id)
          select tenant_id, 'staff', 'customer.erase', 'customers', ${customerId}::uuid
          from customers where id = ${customerId}::uuid`,
    );

    await run(sql`delete from customers where id = ${customerId}::uuid`);

    return { ok: true as const, ledgerEntriesKept: Number(ledger?.n ?? 0) };
  });
}

export interface PrivacyRequest {
  id: string;
  tipo: DsrKind;
  estado: string;
  dueAt: Date;
  createdAt: Date;
  customer: string | null;
  overdue: boolean;
}

export async function solicitudes(userId: string): Promise<PrivacyRequest[]> {
  const filas = await withUserSession(userId, async (tx) => {
    const result = (await tx.execute(
      sql`select d.id, d.kind, d.status, d.due_at, d.created_at, c.name
          from dsr_requests d
          left join customers c on c.id = d.customer_id
          order by d.status = 'resolved', d.due_at`,
    )) as unknown as {
      id: string;
      kind: DsrKind;
      status: string;
      due_at: string;
      created_at: string;
      name: string | null;
    }[];
    return result;
  });

  const ahora = Date.now();

  return filas.map((f) => ({
    id: f.id,
    tipo: f.kind,
    estado: f.status,
    dueAt: new Date(f.due_at),
    createdAt: new Date(f.created_at),
    customer: f.name,
    overdue: f.status !== 'resolved' && new Date(f.due_at).getTime() < ahora,
  }));
}

export async function recordPrivacyRequest(
  userId: string,
  tenantId: string,
  customerId: string | null,
  tipo: DsrKind,
): Promise<void> {
  await withUserSession(userId, (tx) =>
    tx.execute(
      sql`insert into dsr_requests (tenant_id, customer_id, kind, due_at)
          values (${tenantId}::uuid, ${customerId}::uuid, ${tipo},
                  now() + make_interval(days => ${DSR_DEADLINE_DAYS}))`,
    ),
  );
}

export async function resolvePrivacyRequest(userId: string, id: string): Promise<void> {
  await withUserSession(userId, (tx) =>
    tx.execute(
      sql`update dsr_requests set status = 'resolved', resolved_at = now()
          where id = ${id}::uuid`,
    ),
  );
}
