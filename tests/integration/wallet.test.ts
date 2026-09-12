/**
 * Emisión de pases de punta a punta contra base real, con certificados de
 * prueba. Lo único que cambia en producción son las variables de entorno.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { unzipSync } from 'fflate';
import { passPayload, issueApplePass, googleSaveUrl } from '@/lib/wallet/issue';
import { walletAvailability, resetWalletConfigCache, p12ToPem } from '@/lib/wallet/config';
import { sql, seedTwoTenants, type SeededTenant } from '../isolation/helpers';
import { testCertificates, testP12 } from '../fixtures/certs';

let a: SeededTenant;
const entornoOriginal = { ...process.env };

beforeAll(() => {
  const { caPem } = testCertificates();

  process.env.APPLE_PASS_TYPE_ID = 'pass.cl.prueba.loyalty';
  process.env.APPLE_TEAM_ID = 'ABCDE12345';
  process.env.APPLE_PASS_CERT_P12_BASE64 = testP12('clave-de-prueba');
  process.env.APPLE_PASS_CERT_PASSWORD = 'clave-de-prueba';
  process.env.APPLE_WWDR_CERT_PEM = caPem;

  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.GOOGLE_WALLET_ISSUER_ID = '3388000000022000000';
  process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64 = Buffer.from(
    JSON.stringify({
      client_email: 'wallet@prueba.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    }),
  ).toString('base64');

  process.env.APP_URL = 'https://app.prueba.cl';
  resetWalletConfigCache();
}, 60_000);

afterAll(() => {
  process.env = entornoOriginal;
  resetWalletConfigCache();
});

beforeEach(async () => {
  [a] = await seedTwoTenants();
});

describe('configuración', () => {
  it('ambas plataformas quedan disponibles con el entorno completo', () => {
    expect(walletAvailability()).toEqual({ apple: true, google: true });
  });

  it('p12ToPem recupera certificado y clave del .p12 de Apple', () => {
    const { certPem, keyPem } = p12ToPem(testP12('clave-de-prueba'), 'clave-de-prueba');
    expect(certPem).toContain('BEGIN CERTIFICATE');
    expect(keyPem).toContain('PRIVATE KEY');
  });

  it('sin configuración la plataforma se declara no disponible en vez de reventar', () => {
    const guardado = process.env.APPLE_PASS_TYPE_ID;
    delete process.env.APPLE_PASS_TYPE_ID;
    resetWalletConfigCache();

    expect(walletAvailability().apple).toBe(false);

    process.env.APPLE_PASS_TYPE_ID = guardado;
    resetWalletConfigCache();
  });
});

describe('passPayload', () => {
  it('trae lo que el pase necesita', async () => {
    const payload = await passPayload(a.cardSerial);
    expect(payload).toMatchObject({
      customer_name: 'Cliente',
      tenant_name: 'barberia-a',
      balance: 0,
      reward_name: 'Corte gratis',
      points_to_next: 5,
    });
  });

  it('null para un serial inexistente', async () => {
    expect(await passPayload('0'.repeat(32))).toBeNull();
  });
});

describe('issueApplePass', () => {
  it('emite un .pkpass con los cuatro archivos y el pase registrado', async () => {
    const payload = await passPayload(a.cardSerial);
    const pkpass = await issueApplePass(payload!);

    expect(pkpass).not.toBeNull();
    const entradas = Object.keys(unzipSync(pkpass!)).sort();
    expect(entradas).toContain('pass.json');
    expect(entradas).toContain('manifest.json');
    expect(entradas).toContain('signature');
    expect(entradas).toContain('icon.png');

    const [registrado] = await sql<{ platform: string; auth_token_hash: string | null }[]>`
      select platform, auth_token_hash from public.wallet_passes where card_id = ${a.cardId}
    `;
    expect(registrado!.platform).toBe('apple');
    expect(registrado!.auth_token_hash).not.toBeNull();
  });

  it('el pass.json lleva los datos del cliente y del negocio', async () => {
    const payload = await passPayload(a.cardSerial);
    const contenido = unzipSync((await issueApplePass(payload!))!);
    const pass = JSON.parse(Buffer.from(contenido['pass.json']!).toString('utf8')) as Record<
      string,
      unknown
    >;

    expect(pass.serialNumber).toBe(a.cardSerial);
    expect(pass.passTypeIdentifier).toBe('pass.cl.prueba.loyalty');
    expect(pass.webServiceURL).toBe('https://app.prueba.cl/api/v1');
    expect(pass.organizationName).toBe('barberia-a');
  });

  it('el token de autenticación se guarda hasheado, nunca en claro', async () => {
    const payload = await passPayload(a.cardSerial);
    const contenido = unzipSync((await issueApplePass(payload!))!);
    const pass = JSON.parse(Buffer.from(contenido['pass.json']!).toString('utf8')) as {
      authenticationToken: string;
    };

    const [registrado] = await sql<{ auth_token_hash: string }[]>`
      select auth_token_hash from public.wallet_passes where card_id = ${a.cardId}
    `;
    expect(registrado!.auth_token_hash).not.toBe(pass.authenticationToken);
    expect(registrado!.auth_token_hash).toMatch(/^\$2[aby]\$/);
  });

  it('el token emitido autoriza al web service de Apple', async () => {
    const payload = await passPayload(a.cardSerial);
    const contenido = unzipSync((await issueApplePass(payload!))!);
    const pass = JSON.parse(Buffer.from(contenido['pass.json']!).toString('utf8')) as {
      authenticationToken: string;
    };

    expect(await passPayload(a.cardSerial, pass.authenticationToken)).not.toBeNull();
    expect(await passPayload(a.cardSerial, 'token-equivocado')).toBeNull();
  });

  it('el pase NO lleva el teléfono del cliente', async () => {
    const payload = await passPayload(a.cardSerial);
    const contenido = unzipSync((await issueApplePass(payload!))!);
    const texto = Buffer.from(contenido['pass.json']!).toString('utf8');
    expect(texto).not.toMatch(/\+?569\d{8}/);
  });
});

describe('googleSaveUrl', () => {
  it('entrega un enlace de guardado y registra el objeto', async () => {
    const payload = await passPayload(a.cardSerial);
    const url = await googleSaveUrl(payload!);

    expect(url).toMatch(/^https:\/\/pay\.google\.com\/gp\/v\/save\//);

    const [registrado] = await sql<{ platform: string; external_id: string }[]>`
      select platform, external_id from public.wallet_passes
      where card_id = ${a.cardId} and platform = 'google'
    `;
    expect(registrado!.external_id).toBe(`3388000000022000000.tarjeta_${a.cardSerial}`);
  });

  it('las dos plataformas conviven sobre la misma tarjeta', async () => {
    const payload = await passPayload(a.cardSerial);
    await issueApplePass(payload!);
    await googleSaveUrl(payload!);

    const filas = await sql<{ platform: string }[]>`
      select platform from public.wallet_passes where card_id = ${a.cardId} order by platform
    `;
    expect(filas.map((f) => f.platform)).toEqual(['apple', 'google']);
  });
});
