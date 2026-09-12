/**
 * Infraestructura de la suite de aislamiento.
 *
 * Todo corre contra un Postgres real con las migraciones aplicadas: las políticas
 * RLS no se pueden testear con mocks, y son lo único que separa los datos de un
 * negocio de los de otro.
 */
import postgres from 'postgres';

export const DATABASE_URL = process.env.DATABASE_URL ?? '';
export const hasDatabase = DATABASE_URL !== '';

export const sql = postgres(DATABASE_URL || 'postgresql://invalid', {
  max: 4,
  prepare: false,
  onnotice: () => {},
});

export interface SeededTenant {
  tenantId: string;
  userId: string;
  customerId: string;
  cardSerial: string;
  cardId: string;
  rewardId: string;
  deviceId: string;
  staffPin: string;
}

/** Borra todo y siembra dos negocios independientes, A y B. */
export async function seedTwoTenants(): Promise<[SeededTenant, SeededTenant]> {
  await sql`
    truncate table
      public.tenants, public.tenant_settings, public.tenant_members, public.devices,
      public.customers, public.consents, public.cards, public.card_designs,
      public.wallet_passes, public.apple_registrations, public.point_events,
      public.rewards, public.redemptions, public.referrals,
      public.audit_log, public.dsr_requests, public.review_prompts
    restart identity cascade
  `;
  return [await seedTenant('barberia-a', '1111'), await seedTenant('cafe-b', '2222')];
}

async function seedTenant(slug: string, pin: string): Promise<SeededTenant> {
  const [tenant] = await sql<{ id: string }[]>`
    insert into public.tenants (slug, name) values (${slug}, ${slug}) returning id
  `;
  const tenantId = tenant!.id;

  await sql`insert into public.tenant_settings (tenant_id) values (${tenantId})`;

  const userId = crypto.randomUUID();
  await sql`
    insert into public.tenant_members (tenant_id, user_id, role, name, pin_hash)
    values (${tenantId}, ${userId}, 'owner', 'Dueño', app.hash_pin(${pin}))
  `;

  const [device] = await sql<{ id: string }[]>`
    insert into public.devices (tenant_id, name) values (${tenantId}, 'Mostrador') returning id
  `;

  const [customer] = await sql<{ id: string }[]>`
    insert into public.customers (tenant_id, name, phone_e164)
    values (${tenantId}, 'Cliente', ${'+569' + Math.floor(10000000 + Math.random() * 89999999)})
    returning id
  `;

  const serial = crypto.randomUUID().replace(/-/g, '');
  const [card] = await sql<{ id: string }[]>`
    insert into public.cards (tenant_id, customer_id, serial)
    values (${tenantId}, ${customer!.id}, ${serial}) returning id
  `;

  const [rewardRow] = await sql<{ id: string }[]>`
    insert into public.rewards (tenant_id, name, threshold)
    values (${tenantId}, 'Corte gratis', 5) returning id
  `;

  return {
    tenantId,
    userId,
    customerId: customer!.id,
    cardSerial: serial,
    cardId: card!.id,
    rewardId: rewardRow!.id,
    deviceId: device!.id,
    staffPin: pin,
  };
}

/** Ejecuta una consulta con la identidad de un usuario (rol `authenticated` + JWT). */
export async function asUser<T>(
  userId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId })}, true)`;
    await tx`set local role authenticated`;
    return fn(tx);
  }) as Promise<T>;
}

/** Ejecuta una consulta como visitante anónimo. */
export async function asAnon<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`set local role anon`;
    return fn(tx);
  }) as Promise<T>;
}

/** Tablas reales del esquema público, leídas del catálogo — no de una lista a mano. */
export async function publicTables(): Promise<string[]> {
  const rows = await sql<{ relname: string }[]>`
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  `;
  return rows.map((r) => r.relname);
}
