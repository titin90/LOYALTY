/**
 * Escáner del local, contra base real: identidad del dispositivo, PIN del
 * empleado, antifraude, idempotencia de la cola sin conexión y canje.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { recordScan, redeemReward } from '@/lib/scanning';
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
