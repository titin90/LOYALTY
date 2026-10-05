/**
 * Purga por retención, ejecutada por el cron de Vercel.
 *
 * Se protege con `CRON_SECRET`: Vercel lo envía en la cabecera `authorization`,
 * y sin él la ruta queda abierta a cualquiera que la descubra. Borra datos de
 * forma irreversible, así que no corre nunca sin el secreto configurado.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { unsafeAdminDb } from '@/lib/db/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GRACE_DAYS = 30;
const INACTIVE_MONTHS = 36;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET no configurado' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse(null, { status: 401 });
  }

  const db = unsafeAdminDb('platform-job');

  const candidates = (await db.execute(sql`
    select c.id, c.tenant_id
    from customers c
    where c.deleted_at is not null
      and c.deleted_at < now() - make_interval(days => ${GRACE_DAYS})

    union all

    select c.id, c.tenant_id
    from customers c
    join cards k on k.customer_id = c.id
    where c.deleted_at is null
      and c.created_at < now() - make_interval(months => ${INACTIVE_MONTHS})
      and not exists (
        select 1 from point_events e
        where e.card_id = k.id and e.kind = 'earn'
          and e.created_at > now() - make_interval(months => ${INACTIVE_MONTHS})
      )
  `)) as unknown as { id: string; tenant_id: string }[];

  for (const c of candidates) {
    await db.execute(sql`update cards set status = 'closed' where customer_id = ${c.id}::uuid`);
    await db.execute(
      sql`delete from wallet_passes
          where card_id in (select id from cards where customer_id = ${c.id}::uuid)`,
    );
    await db.execute(
      sql`insert into audit_log (tenant_id, actor_type, action, target_table, target_id)
          values (${c.tenant_id}::uuid, 'system', 'customer.retention_purge', 'customers', ${c.id}::uuid)`,
    );
    // El ledger sobrevive: cards.customer_id queda nulo por la clave foránea.
    await db.execute(sql`delete from customers where id = ${c.id}::uuid`);
  }

  return NextResponse.json({ purged: candidates.length });
}
