/**
 * Acceso cruzado entre negocios. Es el test que protege de la multa: una fuga
 * aquí es una brecha notificable en 72h bajo la Ley 21.719.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { sql, seedTwoTenants, asUser, asAnon, type SeededTenant } from './helpers';

let a: SeededTenant;
let b: SeededTenant;

beforeAll(async () => {
  [a, b] = await seedTwoTenants();
});

describe('lectura cruzada', () => {
  it('el dueño de A solo ve su propio negocio', async () => {
    const rows = await asUser(a.userId, (tx) => tx`select id from public.tenants`);
    expect(rows.map((r) => r.id)).toEqual([a.tenantId]);
  });

  it('el dueño de A no ve clientes de B', async () => {
    const rows = await asUser(a.userId, (tx) => tx`select id, tenant_id from public.customers`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tenant_id).toBe(a.tenantId);
  });

  it('buscar el cliente de B por su id devuelve vacío, no un error', async () => {
    const rows = await asUser(
      a.userId,
      (tx) => tx`select id from public.customers where id = ${b.customerId}`,
    );
    expect(rows).toEqual([]);
  });

  it('el serial de la tarjeta de B no es consultable desde A', async () => {
    const rows = await asUser(
      a.userId,
      (tx) => tx`select id from public.cards where serial = ${b.cardSerial}`,
    );
    expect(rows).toEqual([]);
  });

  it.each([
    'customers',
    'cards',
    'point_events',
    'rewards',
    'consents',
    'devices',
    'audit_log',
    'referrals',
    'dsr_requests',
    'review_prompts',
    'wallet_passes',
    'card_designs',
  ])('ninguna fila de otro tenant se filtra por %s', async (table) => {
    const rows = await asUser(
      a.userId,
      (tx) => tx`select tenant_id from ${tx(`public.${table}`)}`,
    );
    for (const row of rows) {
      expect(row.tenant_id).toBe(a.tenantId);
    }
  });
});

describe('escritura cruzada', () => {
  it('A no puede insertar un cliente dentro de B', async () => {
    await expect(
      asUser(
        a.userId,
        (tx) => tx`
          insert into public.customers (tenant_id, name, phone_e164)
          values (${b.tenantId}, 'Intruso', '+56999999999')
        `,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('A no puede modificar un cliente de B', async () => {
    const result = await asUser(
      a.userId,
      (tx) => tx`update public.customers set name = 'Hackeado' where id = ${b.customerId}`,
    );
    expect(result.count).toBe(0);

    const [row] = await sql<{ name: string }[]>`
      select name from public.customers where id = ${b.customerId}
    `;
    expect(row!.name).toBe('Cliente');
  });

  it('A no puede borrar datos de B', async () => {
    const result = await asUser(
      a.userId,
      (tx) => tx`delete from public.customers where id = ${b.customerId}`,
    );
    expect(result.count).toBe(0);
  });

  it('A no puede sumar puntos a una tarjeta de B', async () => {
    await expect(
      asUser(
        a.userId,
        (tx) => tx`
          insert into public.point_events (tenant_id, card_id, delta, kind, idempotency_key)
          values (${b.tenantId}, ${b.cardId}, 100, 'adjust', 'ataque-1')
        `,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('A no puede sumar puntos a la tarjeta de B etiquetándola con su propio tenant', async () => {
    await expect(
      asUser(
        a.userId,
        (tx) => tx`
          insert into public.point_events (tenant_id, card_id, delta, kind, idempotency_key)
          values (${a.tenantId}, ${b.cardId}, 100, 'adjust', 'ataque-2')
        `,
      ),
    ).rejects.toThrow();
  });
});

describe('visitante anónimo', () => {
  it.each(['tenants', 'customers', 'cards', 'point_events', 'audit_log'])(
    'anon no puede leer %s',
    async (table) => {
      await expect(
        asAnon((tx) => tx`select * from ${tx(`public.${table}`)}`),
      ).rejects.toThrow(/permission denied/i);
    },
  );
});
