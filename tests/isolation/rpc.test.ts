/**
 * Las cuatro funciones SECURITY DEFINER son la única superficie que salta RLS.
 * Cada una tiene que defender sola el límite entre negocios.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { sql, seedTwoTenants, asAnon, asUser, type SeededTenant } from './helpers';

let a: SeededTenant;
let b: SeededTenant;

beforeEach(async () => {
  [a, b] = await seedTwoTenants();
});

const key = () => crypto.randomUUID();

describe('register_customer', () => {
  it('registra y entrega un serial, con el bono de bienvenida ya aplicado', async () => {
    const [row] = await asAnon(
      (tx) => tx`select app.register_customer('barberia-a', 'Ana', '+56911112222', 'v1') as r`,
    );
    const result = row!.r as { serial: string; created: boolean };
    expect(result.created).toBe(true);

    const [card] = await sql<{ points_balance: number }[]>`
      select points_balance from public.cards where serial = ${result.serial}
    `;
    // Nunca mostrar el contador en cero.
    expect(card!.points_balance).toBeGreaterThan(0);
  });

  it('registra el consentimiento versionado junto al cliente', async () => {
    await asAnon(
      (tx) => tx`select app.register_customer('barberia-a', 'Ana', '+56911112223', 'v1')`,
    );
    const [consent] = await sql<{ version: string }[]>`
      select version from public.consents order by granted_at desc limit 1
    `;
    expect(consent!.version).toBe('v1');
  });

  it('re-registrar el mismo teléfono devuelve la tarjeta existente, no una nueva', async () => {
    const first = await asAnon(
      (tx) => tx`select app.register_customer('barberia-a', 'Ana', '+56911112224', 'v1') as r`,
    );
    const second = await asAnon(
      (tx) => tx`select app.register_customer('barberia-a', 'Ana', '+56911112224', 'v1') as r`,
    );
    const r1 = first[0]!.r as { serial: string; created: boolean };
    const r2 = second[0]!.r as { serial: string; created: boolean };
    expect(r2.created).toBe(false);
    expect(r2.serial).toBe(r1.serial);
  });

  it('el mismo teléfono en dos negocios son dos personas distintas', async () => {
    await asAnon((tx) => tx`select app.register_customer('barberia-a', 'Ana', '+56911113333', 'v1')`);
    await asAnon((tx) => tx`select app.register_customer('cafe-b', 'Ana', '+56911113333', 'v1')`);

    const rows = await sql<{ tenant_id: string }[]>`
      select tenant_id from public.customers where phone_e164 = '+56911113333'
    `;
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.tenant_id)).size).toBe(2);
  });

  it('rechaza teléfonos que no son E.164', async () => {
    await expect(
      asAnon((tx) => tx`select app.register_customer('barberia-a', 'Ana', '12345', 'v1')`),
    ).rejects.toThrow(/Telefono invalido/i);
  });

  it('rechaza un negocio inexistente', async () => {
    await expect(
      asAnon((tx) => tx`select app.register_customer('no-existe', 'Ana', '+56911114444', 'v1')`),
    ).rejects.toThrow(/no encontrado/i);
  });

  it('no permite auto-referirse', async () => {
    const [r] = await asAnon(
      (tx) => tx`select app.register_customer('barberia-a', 'Ana', '+56911115555', 'v1', '+56911115555') as r`,
    );
    const serial = (r!.r as { serial: string }).serial;
    const [card] = await sql<{ id: string }[]>`select id from public.cards where serial = ${serial}`;
    const refs = await sql`
      select 1 from public.referrals where referred_customer_id =
        (select customer_id from public.cards where id = ${card!.id})
    `;
    expect(refs).toHaveLength(0);
  });
});

describe('record_scan', () => {
  it('suma una visita con el PIN correcto del local', async () => {
    const [row] = await asUser(
      a.userId,
      (tx) => tx`select app.record_scan(${a.cardSerial}, ${a.staffPin}, ${a.deviceId}, ${key()}) as r`,
    );
    const r = row!.r as { balance: number; customer_name: string; duplicate: boolean };
    expect(r.duplicate).toBe(false);
    expect(r.balance).toBe(1);
  });

  it('el PIN del negocio B no sirve para marcar en la tarjeta de A', async () => {
    const [row] = await asUser(
      b.userId,
      (tx) => tx`select app.record_scan(${a.cardSerial}, ${b.staffPin}, ${b.deviceId}, ${key()}) as r`,
    );
    // Devuelve en vez de lanzar para que el contador de intentos se confirme.
    expect(row!.r).toMatchObject({ ok: false, error: 'device_revoked' });
  });

  it('un dispositivo de otro negocio no puede marcar', async () => {
    const [row] = await asUser(
      a.userId,
      (tx) => tx`select app.record_scan(${a.cardSerial}, ${a.staffPin}, ${b.deviceId}, ${key()}) as r`,
    );
    expect(row!.r).toMatchObject({ ok: false, error: 'device_revoked' });
  });

  it('el contador de intentos fallidos SOBREVIVE al fallo de PIN', async () => {
    await asUser(
      a.userId,
      (tx) => tx`select app.record_scan(${a.cardSerial}, '0000', ${a.deviceId}, ${key()})`,
    );
    const [device] = await sql<{ failed_pin_attempts: number }[]>`
      select failed_pin_attempts from public.devices where id = ${a.deviceId}
    `;
    expect(device!.failed_pin_attempts).toBe(1);
  });

  it('reenviar el mismo evento desde la cola offline no suma dos veces', async () => {
    const k = key();
    await asUser(a.userId, (tx) => tx`select app.record_scan(${a.cardSerial}, ${a.staffPin}, ${a.deviceId}, ${k})`);
    const [row] = await asUser(
      a.userId,
      (tx) => tx`select app.record_scan(${a.cardSerial}, ${a.staffPin}, ${a.deviceId}, ${k}) as r`,
    );
    const r = row!.r as { duplicate: boolean; balance: number };
    expect(r.duplicate).toBe(true);
    expect(r.balance).toBe(1);
  });

  it('respeta la ventana antifraude entre dos visitas seguidas', async () => {
    await asUser(a.userId, (tx) => tx`select app.record_scan(${a.cardSerial}, ${a.staffPin}, ${a.deviceId}, ${key()})`);
    await expect(
      asUser(
        a.userId,
        (tx) => tx`select app.record_scan(${a.cardSerial}, ${a.staffPin}, ${a.deviceId}, ${key()})`,
      ),
    ).rejects.toThrow(/hace poco/i);
  });

  it('paga el referido solo con el primer earn real, no al registrarse', async () => {
    // El teléfono del referente se resuelve fuera de la sesión anónima: `anon` no
    // tiene acceso a `customers` (y ese es justamente el comportamiento correcto).
    const [referrer] = await sql<{ phone_e164: string }[]>`
      select phone_e164 from public.customers where id = ${a.customerId}
    `;

    const [reg] = await asAnon(
      (tx) => tx`select app.register_customer('barberia-a', 'Beto', '+56911116666', 'v1',
                 ${referrer!.phone_e164}) as r`,
    );
    const serial = (reg!.r as { serial: string }).serial;

    const before = await sql<{ points_balance: number }[]>`
      select points_balance from public.cards where id = ${a.cardId}
    `;

    await asUser(a.userId, (tx) => tx`select app.record_scan(${serial}, ${a.staffPin}, ${a.deviceId}, ${key()})`);

    const after = await sql<{ points_balance: number }[]>`
      select points_balance from public.cards where id = ${a.cardId}
    `;
    expect(after[0]!.points_balance).toBeGreaterThan(before[0]!.points_balance);

    const [ref] = await sql<{ status: string }[]>`select status from public.referrals limit 1`;
    expect(ref!.status).toBe('paid');
  });
});

describe('redeem_reward', () => {
  it('no se puede canjear un premio de otro negocio', async () => {
    await expect(
      asUser(
        a.userId,
        (tx) => tx`select app.redeem_reward(${a.cardSerial}, ${b.rewardId}, ${a.staffPin}, ${a.deviceId}, ${key()})`,
      ),
    ).rejects.toThrow(/no disponible/i);
  });

  it('tras 10 PIN fallidos el dispositivo queda bloqueado 15 minutos', async () => {
    for (let i = 0; i < 10; i += 1) {
      await asUser(
        a.userId,
        (tx) => tx`select app.record_scan(${a.cardSerial}, '0000', ${a.deviceId}, ${key()})`,
      );
    }
    const [row] = await asUser(
      a.userId,
      (tx) => tx`select app.record_scan(${a.cardSerial}, ${a.staffPin}, ${a.deviceId}, ${key()}) as r`,
    );
    expect(row!.r).toMatchObject({ ok: false, error: 'locked' });
  });

  it('un PIN correcto limpia el contador de intentos', async () => {
    await asUser(a.userId, (tx) => tx`select app.record_scan(${a.cardSerial}, '0000', ${a.deviceId}, ${key()})`);
    await asUser(a.userId, (tx) => tx`select app.record_scan(${a.cardSerial}, ${a.staffPin}, ${a.deviceId}, ${key()})`);
    const [device] = await sql<{ failed_pin_attempts: number }[]>`
      select failed_pin_attempts from public.devices where id = ${a.deviceId}
    `;
    expect(device!.failed_pin_attempts).toBe(0);
  });

  it('no se puede canjear sin puntos suficientes', async () => {
    await expect(
      asUser(
        a.userId,
        (tx) => tx`select app.redeem_reward(${a.cardSerial}, ${a.rewardId}, ${a.staffPin}, ${a.deviceId}, ${key()})`,
      ),
    ).rejects.toThrow(/insuficientes/i);
  });

  it('canjea y descuenta el umbral del saldo', async () => {
    await sql`
      insert into public.point_events (tenant_id, card_id, delta, kind, idempotency_key)
      values (${a.tenantId}, ${a.cardId}, 5, 'adjust', 'carga-canje')
    `;
    const [row] = await asUser(
      a.userId,
      (tx) => tx`select app.redeem_reward(${a.cardSerial}, ${a.rewardId}, ${a.staffPin}, ${a.deviceId}, ${key()}) as r`,
    );
    expect((row!.r as { balance: number }).balance).toBe(0);

    const redemptions = await sql`select 1 from public.redemptions`;
    expect(redemptions).toHaveLength(1);
  });
});

describe('resolve_apple_pass', () => {
  it('devuelve null con un token inválido en vez de filtrar el pase', async () => {
    const [row] = await asAnon(
      (tx) => tx`select app.resolve_apple_pass('serial-inexistente', 'token-malo') as r`,
    );
    expect(row!.r).toBeNull();
  });
});
