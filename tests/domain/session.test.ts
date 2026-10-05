import { describe, it, expect } from 'vitest';
import { issueSession, verifySession, signSession, SESSION_TTL_SECONDS } from '@/lib/auth/session';

const SECRET = 'z'.repeat(48);
const NOW = 1_800_000_000;

const base = {
  userId: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  tenantSlug: 'barberia-a',
  tenantName: 'Barbería A',
  name: 'Don Luis',
  role: 'owner' as const,
};

describe('sesión del panel', () => {
  it('una sesión recién emitida se verifica', () => {
    const session = verifySession(issueSession(base, SECRET, NOW), SECRET, NOW);
    expect(session?.tenantSlug).toBe('barberia-a');
    expect(session?.role).toBe('owner');
  });

  it('rechaza una firma de otra clave', () => {
    expect(verifySession(issueSession(base, 'w'.repeat(48), NOW), SECRET, NOW)).toBeNull();
  });

  it('no se puede cambiar de negocio editando la cookie', () => {
    const token = issueSession(base, SECRET, NOW);
    const [, firma] = token.split('.');
    const alterado = Buffer.from(
      JSON.stringify({ ...base, tenantSlug: 'cafe-b', exp: NOW + 100 }),
    ).toString('base64url');

    expect(verifySession(`${alterado}.${firma}`, SECRET, NOW)).toBeNull();
  });

  it('no se puede ascender a owner editando la cookie', () => {
    const token = issueSession({ ...base, role: 'staff' }, SECRET, NOW);
    const [, firma] = token.split('.');
    const alterado = Buffer.from(
      JSON.stringify({ ...base, role: 'owner', exp: NOW + 100 }),
    ).toString('base64url');

    expect(verifySession(`${alterado}.${firma}`, SECRET, NOW)).toBeNull();
  });

  it('caduca a los 30 días', () => {
    const token = issueSession(base, SECRET, NOW);
    expect(verifySession(token, SECRET, NOW + SESSION_TTL_SECONDS - 1)).not.toBeNull();
    expect(verifySession(token, SECRET, NOW + SESSION_TTL_SECONDS)).toBeNull();
  });

  it('rechaza un rol que no existe', () => {
    const token = signSession(
      { ...base, role: 'superadmin' as unknown as 'owner', exp: NOW + 100 },
      SECRET,
    );
    expect(verifySession(token, SECRET, NOW)).toBeNull();
  });

  it('rechaza identificadores que no son UUID', () => {
    const token = signSession({ ...base, userId: 'admin', exp: NOW + 100 }, SECRET);
    expect(verifySession(token, SECRET, NOW)).toBeNull();
  });

  it.each(['', 'sinpunto', '.firma', 'payload.'])('rechaza el token mal formado %j', (token) => {
    expect(verifySession(token, SECRET, NOW)).toBeNull();
  });
});
