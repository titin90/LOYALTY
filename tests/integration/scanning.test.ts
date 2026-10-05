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
