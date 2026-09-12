/**
 * El ledger es la contabilidad del cliente. Estos tests verifican que las reglas
 * 4, 5 y 6 de CLAUDE.md las impone Postgres, no la disciplina de quien escribe.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { sql, seedTwoTenants, asUser, type SeededTenant } from './helpers';

let a: SeededTenant;

beforeAll(async () => {
  [a] = await seedTwoTenants();
});

describe('append-only', () => {
  it('el trigger mantiene el saldo al insertar eventos', async () => {
    await sql`
      insert into public.point_events (tenant_id, card_id, delta, kind, idempotency_key)
      values (${a.tenantId}, ${a.cardId}, 3, 'earn', 'ledger-1')
    `;
    const [card] = await sql<{ points_balance: number }[]>`
      select points_balance from public.cards where id = ${a.cardId}
    `;
    expect(card!.points_balance).toBe(3);
  });

  it('no se puede modificar un evento del ledger', async () => {
    await expect(
      sql`update public.point_events set delta = 999 where idempotency_key = 'ledger-1'`,
    ).rejects.toThrow(/append-only/i);
  });

  it('no se puede borrar un evento del ledger', async () => {
    await expect(
      sql`delete from public.point_events where idempotency_key = 'ledger-1'`,
    ).rejects.toThrow(/append-only/i);
  });

  it('la aplicación no tiene permiso para escribir el saldo directamente', async () => {
    await expect(
      asUser(
        a.userId,
        (tx) => tx`update public.cards set points_balance = 9999 where id = ${a.cardId}`,
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('el saldo no puede quedar negativo', async () => {
    await expect(
      sql`
        insert into public.point_events (tenant_id, card_id, delta, kind, idempotency_key)
        values (${a.tenantId}, ${a.cardId}, -100, 'redeem', 'ledger-negativo')
      `,
    ).rejects.toThrow(/balance_non_negative/i);
  });

  it('un evento con delta cero no tiene sentido y se rechaza', async () => {
    await expect(
      sql`
        insert into public.point_events (tenant_id, card_id, delta, kind, idempotency_key)
        values (${a.tenantId}, ${a.cardId}, 0, 'adjust', 'ledger-cero')
      `,
    ).rejects.toThrow(/delta_not_zero/i);
  });

  it('la idempotency_key es única dentro del negocio', async () => {
    await expect(
      sql`
        insert into public.point_events (tenant_id, card_id, delta, kind, idempotency_key)
        values (${a.tenantId}, ${a.cardId}, 1, 'earn', 'ledger-1')
      `,
    ).rejects.toThrow(/point_events_tenant_idempotency_key/i);
  });

  it('el audit_log no se reescribe ni se borra desde la aplicación', async () => {
    await sql`
      insert into public.audit_log (tenant_id, actor_type, action)
      values (${a.tenantId}, 'system', 'test')
    `;
    await expect(
      asUser(a.userId, (tx) => tx`update public.audit_log set action = 'x'`),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asUser(a.userId, (tx) => tx`delete from public.audit_log`),
    ).rejects.toThrow(/permission denied/i);
  });
});
