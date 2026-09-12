/**
 * Firma de los JWT de Google Wallet.
 *
 * Dos usos distintos:
 *  - El enlace "Guardar en Google Wallet": un JWT con el objeto dentro, que el
 *    cliente abre en su teléfono. No requiere llamar a la API.
 *  - La aserción para pedir un token de acceso (RFC 7523), necesaria para
 *    actualizar puntos vía REST.
 */
import { SignJWT, importPKCS8 } from 'jose';

export interface ServiceAccount {
  readonly client_email: string;
  readonly private_key: string;
}

export function parseServiceAccount(json: string): ServiceAccount {
  const parsed: unknown = JSON.parse(json);

  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    typeof (parsed as ServiceAccount).client_email !== 'string' ||
    typeof (parsed as ServiceAccount).private_key !== 'string'
  ) {
    throw new Error('El service account de Google no tiene client_email y private_key');
  }

  return parsed as ServiceAccount;
}

/** JWT que va dentro del enlace "Guardar en Google Wallet". */
export async function signSaveJwt(
  account: ServiceAccount,
  loyaltyObject: Record<string, unknown>,
  origins: readonly string[] = [],
): Promise<string> {
  const key = await importPKCS8(account.private_key, 'RS256');

  return new SignJWT({
    iss: account.client_email,
    aud: 'google',
    typ: 'savetowallet',
    origins: [...origins],
    payload: { loyaltyObjects: [loyaltyObject] },
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuedAt()
    .sign(key);
}

export function saveUrl(jwt: string): string {
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';

/** Aserción JWT-bearer (RFC 7523) para obtener un token de acceso. */
export async function signAssertion(
  account: ServiceAccount,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const key = await importPKCS8(account.private_key, 'RS256');

  return new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(account.client_email)
    .setAudience(TOKEN_ENDPOINT)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + 3600)
    .sign(key);
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cached: CachedToken | null = null;

export async function accessToken(account: ServiceAccount): Promise<string> {
  const ahora = Math.floor(Date.now() / 1000);
  // Se renueva un minuto antes para no usar un token que caduca en vuelo.
  if (cached && cached.expiresAt - 60 > ahora) return cached.token;

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: await signAssertion(account, ahora),
    }),
  });

  if (!response.ok) {
    // El cuerpo de la respuesta puede traer detalles del proyecto: solo el estado.
    throw new Error(`Google rechazó la aserción (HTTP ${response.status})`);
  }

  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('Google no devolvió access_token');

  cached = { token: body.access_token, expiresAt: ahora + (body.expires_in ?? 3600) };
  return cached.token;
}

/** Solo para tests: limpia el token en caché entre casos. */
export function resetTokenCache(): void {
  cached = null;
}
