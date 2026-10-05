import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { decodeJwt, decodeProtectedHeader, jwtVerify, importSPKI } from 'jose';
import { buildLoyaltyClass, buildLoyaltyObject, walletId } from '@/lib/wallet/google/objects';
import { signSaveJwt, signAssertion, saveUrl, parseServiceAccount } from '@/lib/wallet/google/jwt';
import { parseCardDesign } from '@/lib/wallet/design';

const ISSUER = '3388000000022000000';
const design = parseCardDesign(undefined);

let account: { client_email: string; private_key: string };
let publicKeyPem: string;

beforeAll(() => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  account = {
    client_email: 'wallet@proyecto.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
  publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
}, 30_000);

describe('walletId', () => {
  it('compone issuerId.sufijo', () => {
    expect(walletId(ISSUER, 'tarjeta_abc')).toBe(`${ISSUER}.tarjeta_abc`);
  });

  it('sanea los caracteres que la API rechaza con un error poco claro', () => {
    expect(walletId(ISSUER, 'barbería don luis!')).toBe(`${ISSUER}.barber_a_don_luis_`);
  });

  it('falla si al sanear no queda ningún carácter útil', () => {
    // Dos negocios con nombres distintos pero solo símbolos colisionarían.
    expect(() => walletId(ISSUER, '¡!¿?')).toThrow(/vacío/);
    expect(() => walletId(ISSUER, '')).toThrow(/vacío/);
  });
});

describe('buildLoyaltyClass', () => {
  const clase = buildLoyaltyClass({
    issuerId: ISSUER,
    tenantSlug: 'barberia-don-luis',
    programName: 'Fidelidad Don Luis',
    issuerName: 'Barbería Don Luis',
    design,
  });

  it('el id es estable a partir del slug del negocio', () => {
    expect(clase.id).toBe(`${ISSUER}.programa_barberia-don-luis`);
  });

  it('usa el color de fondo del diseño', () => {
    expect(clase.hexBackgroundColor).toBe(design.background);
  });

  it('declara el país', () => {
    expect(clase.countryCode).toBe('CL');
  });
});

describe('buildLoyaltyObject', () => {
  const objeto = buildLoyaltyObject({
    issuerId: ISSUER,
    tenantSlug: 'barberia-don-luis',
    serial: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    customerName: 'Ana Pérez',
    balance: 3,
    progressText: 'Te faltan 2 visitas para un corte gratis',
    design,
    reviewUrl: null,
  });

  it('apunta a la clase de su negocio', () => {
    expect(objeto.classId).toBe(`${ISSUER}.programa_barberia-don-luis`);
  });

  it('el QR lleva el serial, igual que en Apple', () => {
    expect(objeto.barcode).toMatchObject({ type: 'QR_CODE', value: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' });
  });

  it('muestra el saldo con la etiqueta del negocio', () => {
    expect(objeto.loyaltyPoints).toMatchObject({ label: 'VISITAS', balance: { int: 3 } });
  });
});

describe('signSaveJwt', () => {
  it('produce un JWT RS256 verificable con la clave pública', async () => {
    const objeto = buildLoyaltyObject({
      issuerId: ISSUER,
      tenantSlug: 'x',
      serial: 'a'.repeat(32),
      customerName: 'Ana',
      balance: 1,
      progressText: '',
      design,
      reviewUrl: null,
    });

    const jwt = await signSaveJwt(account, objeto, ['https://app.ejemplo.cl']);
    expect(decodeProtectedHeader(jwt).alg).toBe('RS256');

    const { payload } = await jwtVerify(jwt, await importSPKI(publicKeyPem, 'RS256'), {
      audience: 'google',
    });
    expect(payload.iss).toBe(account.client_email);
    expect(payload.typ).toBe('savetowallet');

    const contenido = payload.payload as { loyaltyObjects: Record<string, unknown>[] };
    expect(contenido.loyaltyObjects[0]!.id).toBe(objeto.id);
  });

  it('una firma con otra clave no verifica', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const otro = {
      client_email: account.client_email,
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };

    const jwt = await signSaveJwt(otro, {});
    await expect(
      jwtVerify(jwt, await importSPKI(publicKeyPem, 'RS256')),
    ).rejects.toThrow();
  });
});

describe('saveUrl', () => {
  it('apunta al endpoint de guardado de Google', () => {
    expect(saveUrl('abc.def.ghi')).toBe('https://pay.google.com/gp/v/save/abc.def.ghi');
  });
});

describe('signAssertion', () => {
  it('pide el scope de emisor y caduca en una hora', async () => {
    const jwt = await signAssertion(account, 1_800_000_000);
    const payload = decodeJwt(jwt);

    expect(payload.scope).toBe('https://www.googleapis.com/auth/wallet_object.issuer');
    expect(payload.aud).toBe('https://oauth2.googleapis.com/token');
    expect(payload.iss).toBe(account.client_email);
    expect(payload.exp! - payload.iat!).toBe(3600);
  });
});

describe('parseServiceAccount', () => {
  it('acepta un service account válido', () => {
    const parsed = parseServiceAccount(JSON.stringify(account));
    expect(parsed.client_email).toBe(account.client_email);
  });

  it.each([
    ['{}', 'sin campos'],
    ['{"client_email":"a@b.c"}', 'sin clave privada'],
    ['null', 'nulo'],
  ])('rechaza %s (%s)', (json) => {
    expect(() => parseServiceAccount(json)).toThrow(/client_email|private_key/);
  });
});

describe('enlace de reseña en Google Wallet', () => {
  const base = {
    issuerId: ISSUER,
    tenantSlug: 'x',
    serial: 'a'.repeat(32),
    customerName: 'Ana',
    balance: 6,
    progressText: '',
    design,
  };

  it('sin solicitud vigente el objeto no lleva módulo de enlaces', () => {
    expect(buildLoyaltyObject({ ...base, reviewUrl: null })).not.toHaveProperty('linksModuleData');
  });

  it('con solicitud vigente lo lleva', () => {
    const objeto = buildLoyaltyObject({ ...base, reviewUrl: 'https://g.page/r/abc/review' });
    expect(objeto.linksModuleData).toMatchObject({
      uris: [{ id: 'resena', uri: 'https://g.page/r/abc/review' }],
    });
  });
});
