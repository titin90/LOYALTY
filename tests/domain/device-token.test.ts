import { describe, it, expect } from 'vitest';
import {
  issueToken,
  verifyDeviceToken,
  signDeviceToken,
  PAIR_TOKEN_TTL_SECONDS,
} from '@/lib/device/token';

const SECRET = 'x'.repeat(48);
const OTRO_SECRET = 'y'.repeat(48);
const NOW = 1_800_000_000;

const base = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  deviceId: '22222222-2222-4222-8222-222222222222',
  userId: '33333333-3333-4333-8333-333333333333',
};

describe('issueToken / verifyDeviceToken', () => {
  it('un token recién emitido se verifica', () => {
    const token = issueToken('device', base, SECRET, NOW);
    const result = verifyDeviceToken(token, 'device', SECRET, NOW);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.claims.tenantId).toBe(base.tenantId);
    expect(result.claims.deviceId).toBe(base.deviceId);
  });

  it('rechaza una firma hecha con otra clave', () => {
    const token = issueToken('device', base, OTRO_SECRET, NOW);
    expect(verifyDeviceToken(token, 'device', SECRET, NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rechaza un payload alterado', () => {
    const token = issueToken('device', base, SECRET, NOW);
    const [payload, firma] = token.split('.');
    const alterado = Buffer.from(
      JSON.stringify({ ...base, kind: 'device', exp: NOW + 999 }),
    ).toString('base64url');
    expect(payload).not.toBe(alterado);
    expect(verifyDeviceToken(`${alterado}.${firma}`, 'device', SECRET, NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('un enlace de emparejamiento NO sirve como cookie de dispositivo', () => {
    const token = issueToken('pair', base, SECRET, NOW);
    expect(verifyDeviceToken(token, 'device', SECRET, NOW)).toEqual({
      ok: false,
      reason: 'wrong_kind',
    });
  });

  it('una cookie de dispositivo NO sirve como enlace de emparejamiento', () => {
    const token = issueToken('device', base, SECRET, NOW);
    expect(verifyDeviceToken(token, 'pair', SECRET, NOW)).toEqual({
      ok: false,
      reason: 'wrong_kind',
    });
  });

  it('el enlace de emparejamiento caduca a los 15 minutos', () => {
    const token = issueToken('pair', base, SECRET, NOW);
    expect(verifyDeviceToken(token, 'pair', SECRET, NOW + PAIR_TOKEN_TTL_SECONDS - 1).ok).toBe(true);
    expect(verifyDeviceToken(token, 'pair', SECRET, NOW + PAIR_TOKEN_TTL_SECONDS)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it.each([
    ['', 'malformed'],
    ['sinpunto', 'malformed'],
    ['.firma', 'malformed'],
    ['payload.', 'malformed'],
  ])('rechaza el token mal formado %j', (token, reason) => {
    expect(verifyDeviceToken(token, 'device', SECRET, NOW)).toEqual({ ok: false, reason });
  });

  it('rechaza claims con identificadores que no son UUID', () => {
    const token = signDeviceToken(
      { kind: 'device', tenantId: 'no-es-uuid', deviceId: base.deviceId, userId: base.userId, exp: NOW + 60 },
      SECRET,
    );
    expect(verifyDeviceToken(token, 'device', SECRET, NOW)).toEqual({
      ok: false,
      reason: 'bad_claims',
    });
  });

  it('no revela la firma esperada en el mensaje de error', () => {
    const result = verifyDeviceToken('aaaa.bbbb', 'device', SECRET, NOW);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});
