/**
 * Web service de Apple: alta, baja y listado de pases actualizados.
 * El protocolo lo define Apple; estos tests fijan su contrato.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { unzipSync } from 'fflate';
import {
  applePassToken,
  registerDevice,
  unregisterDevice,
  updatedSerials,
} from '@/lib/wallet/apple/web-service';
import { passPayload, issueApplePass } from '@/lib/wallet/issue';
import { resetWalletConfigCache } from '@/lib/wallet/config';
import { sql, seedTwoTenants, type SeededTenant } from '../isolation/helpers';
import { testCertificates, testP12 } from '../fixtures/certs';

let a: SeededTenant;
let b: SeededTenant;
const entornoOriginal = { ...process.env };

beforeAll(() => {
  const { caPem } = testCertificates();
  process.env.APPLE_PASS_TYPE_ID = 'pass.cl.prueba.loyalty';
  process.env.APPLE_TEAM_ID = 'ABCDE12345';
  process.env.APPLE_PASS_CERT_P12_BASE64 = testP12('clave-de-prueba');
  process.env.APPLE_PASS_CERT_PASSWORD = 'clave-de-prueba';
  process.env.APPLE_WWDR_CERT_PEM = caPem;
  process.env.APP_URL = 'https://app.prueba.cl';
  resetWalletConfigCache();
}, 60_000);

afterAll(() => {
  process.env = entornoOriginal;
  resetWalletConfigCache();
});

/** Emite el pase y devuelve su authenticationToken. */
async function emitir(seed: SeededTenant): Promise<string> {
  const payload = await passPayload(seed.cardSerial);
  const contenido = unzipSync((await issueApplePass(payload!))!);
  return (
    JSON.parse(Buffer.from(contenido['pass.json']!).toString('utf8')) as {
      authenticationToken: string;
    }
  ).authenticationToken;
}

beforeEach(async () => {
  [a, b] = await seedTwoTenants();
});

describe('applePassToken', () => {
  it('extrae el token del header de Apple', () => {
    expect(applePassToken('ApplePass abc123')).toBe('abc123');
  });

  it.each<[string | null, string]>([
    [null, 'ausente'],
    ['Bearer abc123', 'otro esquema'],
    ['ApplePass ', 'vacío'],
    ['abc123', 'sin esquema'],
  ])('rechaza %j (%s)', (header, _motivo) => {
    expect(applePassToken(header)).toBeNull();
  });
});

describe('registerDevice', () => {
  it('registra el dispositivo con el token correcto', async () => {
    const token = await emitir(a);
    expect(await registerDevice(a.cardSerial, token, 'dispositivo-1', 'push-1')).toBe(true);

    const filas = await sql<{ push_token: string }[]>`
      select push_token from public.apple_registrations
    `;
    expect(filas).toHaveLength(1);
    expect(filas[0]!.push_token).toBe('push-1');
  });

  it('rechaza un token equivocado sin registrar nada', async () => {
    await emitir(a);
    expect(await registerDevice(a.cardSerial, 'token-malo', 'dispositivo-1', 'push-1')).toBe(false);
    expect(await sql`select 1 from public.apple_registrations`).toHaveLength(0);
  });

  it('el token del pase de otro negocio no sirve', async () => {
    await emitir(a);
    const tokenB = await emitir(b);
    expect(await registerDevice(a.cardSerial, tokenB, 'dispositivo-1', 'push-1')).toBe(false);
  });

  it('registrar dos veces actualiza el push token en vez de duplicar', async () => {
    const token = await emitir(a);
    await registerDevice(a.cardSerial, token, 'dispositivo-1', 'push-viejo');
    await registerDevice(a.cardSerial, token, 'dispositivo-1', 'push-nuevo');

    const filas = await sql<{ push_token: string }[]>`
      select push_token from public.apple_registrations
    `;
    expect(filas).toHaveLength(1);
    expect(filas[0]!.push_token).toBe('push-nuevo');
  });

  it('el mismo pase en dos teléfonos son dos registros', async () => {
    const token = await emitir(a);
    await registerDevice(a.cardSerial, token, 'telefono-1', 'push-1');
    await registerDevice(a.cardSerial, token, 'telefono-2', 'push-2');
    expect(await sql`select 1 from public.apple_registrations`).toHaveLength(2);
  });
});

describe('unregisterDevice', () => {
  it('da de baja el dispositivo', async () => {
    const token = await emitir(a);
    await registerDevice(a.cardSerial, token, 'dispositivo-1', 'push-1');

    expect(await unregisterDevice(a.cardSerial, token, 'dispositivo-1')).toBe(true);
    expect(await sql`select 1 from public.apple_registrations`).toHaveLength(0);
  });

  it('un token equivocado no puede dar de baja el pase de nadie', async () => {
    const token = await emitir(a);
    await registerDevice(a.cardSerial, token, 'dispositivo-1', 'push-1');

    expect(await unregisterDevice(a.cardSerial, 'token-malo', 'dispositivo-1')).toBe(false);
    expect(await sql`select 1 from public.apple_registrations`).toHaveLength(1);
  });
});

describe('updatedSerials', () => {
  it('lista los seriales que ese dispositivo registró', async () => {
    const token = await emitir(a);
    await registerDevice(a.cardSerial, token, 'dispositivo-1', 'push-1');

    const result = await updatedSerials('dispositivo-1', null);
    expect(result.serialNumbers).toEqual([a.cardSerial]);
  });

  it('un dispositivo no ve los pases de otro', async () => {
    const tokenA = await emitir(a);
    const tokenB = await emitir(b);
    await registerDevice(a.cardSerial, tokenA, 'telefono-de-ana', 'push-a');
    await registerDevice(b.cardSerial, tokenB, 'telefono-de-beto', 'push-b');

    expect((await updatedSerials('telefono-de-ana', null)).serialNumbers).toEqual([a.cardSerial]);
    expect((await updatedSerials('telefono-de-beto', null)).serialNumbers).toEqual([b.cardSerial]);
  });

  it('un dispositivo desconocido no recibe nada', async () => {
    expect((await updatedSerials('no-existe', null)).serialNumbers).toEqual([]);
  });
});
