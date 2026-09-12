/**
 * Purga por retención.
 *
 * La Ley 21.719 exige no guardar datos personales más de lo necesario. Aquí se
 * hacen dos cosas, ambas conservando el ledger sin referencia a la persona:
 *
 *   1. Clientes marcados como eliminados hace más de `GRACIA_DIAS`: se suprimen
 *      de verdad. El borrado lógico existe para que el negocio pueda deshacer un
 *      error; pasado el plazo, se cumple.
 *   2. Clientes sin ninguna visita en `INACTIVIDAD_MESES`: ya no hay finalidad
 *      que justifique conservar su teléfono.
 *
 *   pnpm tsx scripts/retention.ts [--aplicar]
 *
 * Sin `--aplicar` solo informa. Es irreversible: correrlo a ciegas contra
 * producción no es una opción.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { unsafeAdminDb } from '../lib/db/client';

const GRACIA_DIAS = 30;
const INACTIVIDAD_MESES = 36;

const aplicar = process.argv.includes('--aplicar');
const db = unsafeAdminDb('platform-job');

interface Candidato {
  id: string;
  tenant_id: string;
  motivo: string;
}

const candidatos = (await db.execute(sql`
  select c.id, c.tenant_id, 'eliminado hace más de ${sql.raw(String(GRACIA_DIAS))} días' as motivo
  from customers c
  where c.deleted_at is not null
    and c.deleted_at < now() - make_interval(days => ${GRACIA_DIAS})

  union all

  select c.id, c.tenant_id, 'sin visitas en ${sql.raw(String(INACTIVIDAD_MESES))} meses' as motivo
  from customers c
  join cards k on k.customer_id = c.id
  where c.deleted_at is null
    and c.created_at < now() - make_interval(months => ${INACTIVIDAD_MESES})
    and not exists (
      select 1 from point_events e
      where e.card_id = k.id and e.kind = 'earn'
        and e.created_at > now() - make_interval(months => ${INACTIVIDAD_MESES})
    )
`)) as unknown as Candidato[];

if (candidatos.length === 0) {
  console.log('Nada que purgar.');
  process.exit(0);
}

console.log(`${candidatos.length} cliente(s) cumplen el plazo de retención:`);
for (const c of candidatos) {
  console.log(`  · ${c.id} — ${c.motivo}`);
}

if (!aplicar) {
  console.log('\nSimulación. Vuelve a correrlo con --aplicar para ejecutarlo.');
  process.exit(0);
}

for (const c of candidatos) {
  await db.execute(sql`
    update cards set status = 'closed' where customer_id = ${c.id}::uuid
  `);
  await db.execute(sql`
    delete from wallet_passes where card_id in (select id from cards where customer_id = ${c.id}::uuid)
  `);
  await db.execute(sql`
    insert into audit_log (tenant_id, actor_type, action, target_table, target_id)
    values (${c.tenant_id}::uuid, 'system', 'customer.retention_purge', 'customers', ${c.id}::uuid)
  `);
  // El ledger sobrevive: cards.customer_id queda nulo por la clave foránea.
  await db.execute(sql`delete from customers where id = ${c.id}::uuid`);
}

console.log(`\n${candidatos.length} cliente(s) purgados. El ledger quedó intacto y anonimizado.`);
process.exit(0);
