/**
 * Escáner del local, contra base real: identidad del dispositivo, PIN del
 * empleado, antifraude, idempotencia de la cola sin conexión y canje.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { recordScan, redeemReward, findCustomersByPhone } from '@/lib/scanning';
import type { DeviceClaims } from '@/lib/device/token';
import { sql, seedTwoTenants, type SeededTenant } from '../isolation/helpers';

let a: SeededTenant;
let b: SeededTenant;

const claimsFor = (t: SeededTenant): DeviceClaims => ({
  kind: 'device',
  tenantId: t.tenantId,
  deviceId: t.deviceId,
  userId: t.userId,
  exp: Math.floor(Date.now() / 1000) + 3600,
});

const key = () => crypto.randomUUID();

beforeEach(async () => {
  [a, b] = await seedTwoTenants();
});

describe('recordScan', () => {
  it('suma la visita y dice cuánto falta para el premio', async () => {
    const outcome = await recordScan({
      serial: a.cardSerial,
      pin: a.staffPin,
      claims: claimsFor(a),
      idempotencyKey: key(),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.balance).toBe(1);
    expect(outcome.result.pointsToNextReward).toBe(4);
    expect(outcome.result.duplicate).toBe(false);
  });

  it('la tarjeta de otro local se rechaza con un mensaje claro, no con "PIN incorrecto"', async () => {
    const outcome = await recordScan({
      serial: b.cardSerial,
      pin: a.staffPin,
      claims: claimsFor(a),
      idempotencyKey: key(),
    });

    expect(outcome).toMatchObject({
      ok: false,
      failure: 'card_not_here',
      message: 'Esta tarjeta no es de este local.',
    });
  });

  it('un PIN equivocado no suma nada', async () => {
    const outcome = await recordScan({
      serial: a.cardSerial,
      pin: '9999',
      claims: claimsFor(a),
      idempotencyKey: key(),
    });
    expect(outcome).toMatchObject({ ok: false, failure: 'bad_pin' });

    const [card] = await sql<{ points_balance: number }[]>`
      select points_balance from public.cards where id = ${a.cardId}
    `;
    expect(card!.points_balance).toBe(0);
  });

  it('un dispositivo revocado deja de marcar', async () => {
    await sql`update public.devices set revoked_at = now() where id = ${a.deviceId}`;
    const outcome = await recordScan({
      serial: a.cardSerial,
      pin: a.staffPin,
      claims: claimsFor(a),
      idempotencyKey: key(),
    });
    expect(outcome).toMatchObject({ ok: false, failure: 'device_revoked' });
  });

  it('reenviar el mismo marcaje desde la cola sin conexión no suma dos veces', async () => {
    const k = key();
    const req = { serial: a.cardSerial, pin: a.staffPin, claims: claimsFor(a), idempotencyKey: k };

    const first = await recordScan(req);
    const second = await recordScan(req);

    expect(first.ok && first.result.duplicate).toBe(false);
    expect(second.ok && second.result.duplicate).toBe(true);
    expect(second.ok && second.result.balance).toBe(1);
  });

  it('respeta la ventana antifraude entre dos visitas seguidas', async () => {
    await recordScan({ serial: a.cardSerial, pin: a.staffPin, claims: claimsFor(a), idempotencyKey: key() });
    const outcome = await recordScan({
      serial: a.cardSerial,
      pin: a.staffPin,
      claims: claimsFor(a),
      idempotencyKey: key(),
    });
    expect(outcome).toMatchObject({ ok: false, failure: 'too_soon' });
  });

  it('rechaza un serial que no tiene forma de tarjeta sin tocar la base', async () => {
    const outcome = await recordScan({
      serial: 'https://sitio-cualquiera.cl',
      pin: a.staffPin,
      claims: claimsFor(a),
      idempotencyKey: key(),
    });
    expect(outcome).toMatchObject({ ok: false, failure: 'card_not_here' });
  });

  it('el PIN queda registrado como quién marcó, para el audit log', async () => {
    await recordScan({ serial: a.cardSerial, pin: a.staffPin, claims: claimsFor(a), idempotencyKey: key() });
    const [event] = await sql<{ staff_id: string | null; device_id: string | null }[]>`
      select staff_id, device_id from public.point_events where kind = 'earn'
    `;
    expect(event!.staff_id).not.toBeNull();
    expect(event!.device_id).toBe(a.deviceId);
  });

  it('se bloquea tras 10 intentos fallidos de PIN', async () => {
    for (let i = 0; i < 10; i += 1) {
      await recordScan({ serial: a.cardSerial, pin: '0000', claims: claimsFor(a), idempotencyKey: key() });
    }
    const outcome = await recordScan({
      serial: a.cardSerial,
      pin: a.staffPin,
      claims: claimsFor(a),
      idempotencyKey: key(),
    });
    expect(outcome).toMatchObject({ ok: false, failure: 'locked' });
  });
});

describe('redeemReward', () => {
  it('canja al alcanzar el umbral y descuenta los puntos', async () => {
    await sql`
      insert into public.point_events (tenant_id, card_id, delta, kind, idempotency_key)
      values (${a.tenantId}, ${a.cardId}, 5, 'adjust', 'carga')
    `;
    const outcome = await redeemReward({
      serial: a.cardSerial,
      rewardId: a.rewardId,
      pin: a.staffPin,
      claims: claimsFor(a),
      idempotencyKey: key(),
    });

    expect(outcome).toMatchObject({ ok: true, balance: 0 });
  });

  it('no canja sin puntos suficientes', async () => {
    const outcome = await redeemReward({
      serial: a.cardSerial,
      rewardId: a.rewardId,
      pin: a.staffPin,
      claims: claimsFor(a),
      idempotencyKey: key(),
    });
    expect(outcome).toMatchObject({ ok: false, failure: 'not_enough_points' });
  });

  it('no se puede canjear un premio de otro local', async () => {
    const outcome = await redeemReward({
      serial: a.cardSerial,
      rewardId: b.rewardId,
      pin: a.staffPin,
      claims: claimsFor(a),
      idempotencyKey: key(),
    });
    expect(outcome).toMatchObject({ ok: false, failure: 'reward_gone' });
  });
});

describe('canje desde el escáner', () => {
  it('el marcaje avisa qué puede canjear el cliente en ese momento', async () => {
    // Justo en el umbral del premio sembrado (5).
    await sql`
      insert into public.point_events (tenant_id, card_id, delta, kind, idempotency_key)
      values (${a.tenantId}, ${a.cardId}, 4, 'adjust', 'carga-umbral')
    `;

    const outcome = await recordScan({
      serial: a.cardSerial,
      pin: a.staffPin,
      claims: claimsFor(a),
      idempotencyKey: key(),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.balance).toBe(5);
    expect(outcome.result.redeemable).toHaveLength(1);
    expect(outcome.result.redeemable[0]).toMatchObject({ name: 'Corte gratis', threshold: 5 });
  });

  it('sin puntos suficientes no ofrece nada que canjear', async () => {
    const outcome = await recordScan({
      serial: a.cardSerial,
      pin: a.staffPin,
      claims: claimsFor(a),
      idempotencyKey: key(),
    });
    expect(outcome.ok && outcome.result.redeemable).toEqual([]);
  });

  it('nunca ofrece un premio de otro negocio', async () => {
    await sql`
      insert into public.point_events (tenant_id, card_id, delta, kind, idempotency_key)
      values (${a.tenantId}, ${a.cardId}, 99, 'adjust', 'carga-alta')
    `;
    // El premio de B tiene el mismo umbral: si se colara, aparecería aquí.
    const outcome = await recordScan({
      serial: a.cardSerial,
      pin: a.staffPin,
      claims: claimsFor(a),
      idempotencyKey: key(),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.redeemable).toHaveLength(1);
    expect(outcome.result.redeemable[0]!.id).toBe(a.rewardId);
  });

  it('un premio pausado deja de ofrecerse', async () => {
    await sql`
      insert into public.point_events (tenant_id, card_id, delta, kind, idempotency_key)
      values (${a.tenantId}, ${a.cardId}, 9, 'adjust', 'carga')
    `;
    await sql`update public.rewards set active = false where id = ${a.rewardId}`;

    const outcome = await recordScan({
      serial: a.cardSerial,
      pin: a.staffPin,
      claims: claimsFor(a),
      idempotencyKey: key(),
    });
    expect(outcome.ok && outcome.result.redeemable).toEqual([]);
  });

  it('marcar y canjear seguido deja el saldo correcto', async () => {
    await sql`
      insert into public.point_events (tenant_id, card_id, delta, kind, idempotency_key)
      values (${a.tenantId}, ${a.cardId}, 4, 'adjust', 'carga')
    `;

    const marcaje = await recordScan({
      serial: a.cardSerial,
      pin: a.staffPin,
      claims: claimsFor(a),
      idempotencyKey: key(),
    });
    if (!marcaje.ok) throw new Error('esperaba éxito');

    const canje = await redeemReward({
      serial: a.cardSerial,
      rewardId: marcaje.result.redeemable[0]!.id,
      pin: a.staffPin,
      claims: claimsFor(a),
      idempotencyKey: key(),
    });

    expect(canje).toMatchObject({ ok: true, balance: 0 });
  });
});

describe('búsqueda por teléfono', () => {
  it('encuentra por los últimos dígitos', async () => {
    const [customer] = await sql<{ phone_e164: string }[]>`
      select phone_e164 from public.customers where id = ${a.customerId}
    `;
    const resultados = await findCustomersByPhone(claimsFor(a), customer!.phone_e164.slice(-5), a.staffPin);

    expect(resultados).toHaveLength(1);
    expect(resultados[0]!.name).toBe('Cliente');
    expect(resultados[0]!.serial).toBe(a.cardSerial);
  });

  it('NO devuelve el teléfono completo, solo los últimos dígitos', async () => {
    const [customer] = await sql<{ phone_e164: string }[]>`
      select phone_e164 from public.customers where id = ${a.customerId}
    `;
    const resultados = await findCustomersByPhone(claimsFor(a), customer!.phone_e164.slice(-5), a.staffPin);

    expect(resultados[0]!.phoneSuffix).not.toContain(customer!.phone_e164);
    expect(resultados[0]!.phoneSuffix).toBe(`··· ${customer!.phone_e164.slice(-4)}`);
  });

  it.each(['', '1', '123'])('con %j dígitos no busca nada: evita pasearse por la lista', async (q) => {
    expect(await findCustomersByPhone(claimsFor(a), q, a.staffPin)).toEqual([]);
  });

  it('SIN PIN válido no devuelve nada, aunque el dispositivo esté emparejado', async () => {
    const [customer] = await sql<{ phone_e164: string }[]>`
      select phone_e164 from public.customers where id = ${a.customerId}
    `;
    const consulta = customer!.phone_e164.slice(-5);

    // Con el PIN correcto sí aparece: la diferencia es exactamente el PIN.
    expect(await findCustomersByPhone(claimsFor(a), consulta, a.staffPin)).toHaveLength(1);
    expect(await findCustomersByPhone(claimsFor(a), consulta, '0000')).toEqual([]);
    expect(await findCustomersByPhone(claimsFor(a), consulta, 'no-es-pin')).toEqual([]);
  });

  it('el PIN de otro negocio no sirve para buscar aquí', async () => {
    const [customer] = await sql<{ phone_e164: string }[]>`
      select phone_e164 from public.customers where id = ${a.customerId}
    `;
    expect(
      await findCustomersByPhone(claimsFor(a), customer!.phone_e164.slice(-5), b.staffPin),
    ).toEqual([]);
  });

  it('nunca encuentra clientes de otro negocio', async () => {
    const [customer] = await sql<{ phone_e164: string }[]>`
      select phone_e164 from public.customers where id = ${b.customerId}
    `;
    expect(await findCustomersByPhone(claimsFor(a), customer!.phone_e164.slice(-5), a.staffPin)).toEqual([]);
  });

  it('no muestra clientes suprimidos', async () => {
    const [customer] = await sql<{ phone_e164: string }[]>`
      select phone_e164 from public.customers where id = ${a.customerId}
    `;
    await sql`update public.customers set deleted_at = now() where id = ${a.customerId}`;
    expect(await findCustomersByPhone(claimsFor(a), customer!.phone_e164.slice(-5), a.staffPin)).toEqual([]);
  });

  it('el serial encontrado sirve para marcar la visita', async () => {
    const [customer] = await sql<{ phone_e164: string }[]>`
      select phone_e164 from public.customers where id = ${a.customerId}
    `;
    const [encontrado] = await findCustomersByPhone(claimsFor(a), customer!.phone_e164.slice(-5), a.staffPin);

    const outcome = await recordScan({
      serial: encontrado!.serial,
      pin: a.staffPin,
      claims: claimsFor(a),
      idempotencyKey: key(),
    });
    expect(outcome.ok && outcome.result.balance).toBe(1);
  });
});

describe('solicitud de reseña de Google', () => {
  const scan = () =>
    recordScan({
      serial: a.cardSerial,
      pin: a.staffPin,
      claims: claimsFor(a),
      idempotencyKey: key(),
    });

  /** Deja la tarjeta con n visitas previas, sin tocar la ventana antifraude. */
  const seedVisits = async (n: number) => {
    for (let i = 0; i < n; i += 1) {
      await sql`
        insert into public.point_events (tenant_id, card_id, delta, kind, idempotency_key, created_at)
        values (${a.tenantId}, ${a.cardId}, 1, 'earn', ${'prev' + i},
                now() - make_interval(days => ${(i + 1) * 10}))
      `;
    }
  };

  it('sin enlace configurado no se registra ninguna solicitud', async () => {
    await seedVisits(5);
    await scan();
    expect(await sql`select 1 from public.review_prompts`).toHaveLength(0);
  });

  it('con enlace y visitas suficientes se registra una', async () => {
    await sql`update public.tenant_settings set google_review_url = 'https://g.page/r/x/review'
              where tenant_id = ${a.tenantId}`;
    await seedVisits(5);
    await scan();

    const filas = await sql<{ customer_id: string }[]>`select customer_id from public.review_prompts`;
    expect(filas).toHaveLength(1);
    expect(filas[0]!.customer_id).toBe(a.customerId);
  });

  it('no se pide antes de la visita mínima', async () => {
    await sql`update public.tenant_settings set google_review_url = 'https://g.page/r/x/review'
              where tenant_id = ${a.tenantId}`;
    await scan();
    expect(await sql`select 1 from public.review_prompts`).toHaveLength(0);
  });

  it('respeta el tope: no se repite dentro de la ventana', async () => {
    await sql`update public.tenant_settings set google_review_url = 'https://g.page/r/x/review'
              where tenant_id = ${a.tenantId}`;
    await sql`insert into public.review_prompts (tenant_id, customer_id)
              values (${a.tenantId}, ${a.customerId})`;
    await seedVisits(5);
    await scan();

    expect(await sql`select 1 from public.review_prompts`).toHaveLength(1);
  });

  it('el enlace llega al pase solo cuando hay solicitud vigente', async () => {
    await sql`update public.tenant_settings set google_review_url = 'https://g.page/r/x/review'
              where tenant_id = ${a.tenantId}`;

    const { passPayload } = await import('@/lib/wallet/issue');
    expect((await passPayload(a.cardSerial))?.review_url).toBeNull();

    await sql`insert into public.review_prompts (tenant_id, customer_id)
              values (${a.tenantId}, ${a.customerId})`;
    expect((await passPayload(a.cardSerial))?.review_url).toBe('https://g.page/r/x/review');
  });

  it('una solicitud vieja ya no aparece en el pase', async () => {
    await sql`update public.tenant_settings set google_review_url = 'https://g.page/r/x/review'
              where tenant_id = ${a.tenantId}`;
    await sql`insert into public.review_prompts (tenant_id, customer_id, sent_at)
              values (${a.tenantId}, ${a.customerId}, now() - interval '40 days')`;

    const { passPayload } = await import('@/lib/wallet/issue');
    expect((await passPayload(a.cardSerial))?.review_url).toBeNull();
  });
});

describe('la búsqueda respeta las defensas del equipo', () => {
  const phoneOf = async () => {
    const [row] = await sql<{ phone_e164: string }[]>`
      select phone_e164 from public.customers where id = ${a.customerId}
    `;
    return row!.phone_e164.slice(-5);
  };

  it('un equipo revocado deja de leer la base de clientes', async () => {
    const q = await phoneOf();
    expect(await findCustomersByPhone(claimsFor(a), q, a.staffPin)).toHaveLength(1);

    await sql`update public.devices set revoked_at = now() where id = ${a.deviceId}`;
    expect(await findCustomersByPhone(claimsFor(a), q, a.staffPin)).toEqual([]);
  });

  it('un equipo bloqueado por PIN tampoco busca', async () => {
    const q = await phoneOf();
    await sql`update public.devices set locked_until = now() + interval '15 minutes'
              where id = ${a.deviceId}`;
    expect(await findCustomersByPhone(claimsFor(a), q, a.staffPin)).toEqual([]);
  });

  it('un PIN errado INCREMENTA el contador: la búsqueda no es un oráculo libre', async () => {
    const q = await phoneOf();
    await findCustomersByPhone(claimsFor(a), q, '0000');

    const [device] = await sql<{ failed_pin_attempts: number }[]>`
      select failed_pin_attempts from public.devices where id = ${a.deviceId}
    `;
    expect(device!.failed_pin_attempts).toBe(1);
  });

  it('tras 10 intentos por la búsqueda, el equipo queda bloqueado', async () => {
    const q = await phoneOf();
    for (let i = 0; i < 10; i += 1) {
      await findCustomersByPhone(claimsFor(a), q, '0000');
    }
    // Con el PIN correcto tampoco: el bloqueo es del equipo.
    expect(await findCustomersByPhone(claimsFor(a), q, a.staffPin)).toEqual([]);

    const outcome = await recordScan({
      serial: a.cardSerial,
      pin: a.staffPin,
      claims: claimsFor(a),
      idempotencyKey: key(),
    });
    expect(outcome).toMatchObject({ ok: false, failure: 'locked' });
  });

  it('un PIN correcto limpia el contador', async () => {
    const q = await phoneOf();
    await findCustomersByPhone(claimsFor(a), q, '0000');
    await findCustomersByPhone(claimsFor(a), q, a.staffPin);

    const [device] = await sql<{ failed_pin_attempts: number }[]>`
      select failed_pin_attempts from public.devices where id = ${a.deviceId}
    `;
    expect(device!.failed_pin_attempts).toBe(0);
  });
});
