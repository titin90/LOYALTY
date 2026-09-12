/**
 * Credenciales del dispositivo del local, firmadas con HMAC.
 *
 * Por qué firmadas y no una fila en la base: el teléfono del mostrador no tiene
 * sesión de usuario, y verificar su identidad contra la base exigiría leer
 * `devices` antes de tener sesión — es decir, una quinta función que salte RLS.
 * Con una firma, la verificación es puramente criptográfica: no toca la base.
 *
 * La revocación NO se hace aquí: `app.record_scan` comprueba en cada marcaje que
 * el dispositivo pertenezca al negocio y no esté revocado. Revocar un dispositivo
 * surte efecto en el siguiente escaneo aunque su cookie siga siendo válida.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type TokenKind = 'pair' | 'device';

export interface DeviceClaims {
  readonly kind: TokenKind;
  readonly tenantId: string;
  readonly deviceId: string;
  /** Miembro del negocio bajo cuya identidad corre la sesión de base de datos. */
  readonly userId: string;
  /** Epoch en segundos. */
  readonly exp: number;
}

/** El enlace de emparejamiento es un portador: vida corta a propósito. */
export const PAIR_TOKEN_TTL_SECONDS = 15 * 60;
export const DEVICE_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;

export function deviceSecret(): string {
  const secret = process.env.DEVICE_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('DEVICE_TOKEN_SECRET no está definida o es más corta que 32 caracteres');
  }
  return secret;
}

function b64url(input: Buffer): string {
  return input.toString('base64url');
}

function sign(payload: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(payload).digest());
}

export function signDeviceToken(claims: DeviceClaims, secret: string): string {
  const payload = b64url(Buffer.from(JSON.stringify(claims), 'utf8'));
  return `${payload}.${sign(payload, secret)}`;
}

export function issueToken(
  kind: TokenKind,
  base: Omit<DeviceClaims, 'kind' | 'exp'>,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const ttl = kind === 'pair' ? PAIR_TOKEN_TTL_SECONDS : DEVICE_TOKEN_TTL_SECONDS;
  return signDeviceToken({ ...base, kind, exp: nowSeconds + ttl }, secret);
}

export type VerifyFailure =
  | 'malformed'
  | 'bad_signature'
  | 'expired'
  | 'wrong_kind'
  | 'bad_claims';

export type VerifyResult =
  | { ok: true; claims: DeviceClaims }
  | { ok: false; reason: VerifyFailure };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function verifyDeviceToken(
  token: string,
  expectedKind: TokenKind,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): VerifyResult {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: 'malformed' };

  const payload = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = sign(payload, secret);

  // Comparación en tiempo constante: una comparación normal filtra la firma
  // byte a byte a quien pueda medir el tiempo de respuesta.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let claims: DeviceClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as DeviceClaims;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (
    !UUID.test(claims.tenantId ?? '') ||
    !UUID.test(claims.deviceId ?? '') ||
    !UUID.test(claims.userId ?? '') ||
    typeof claims.exp !== 'number'
  ) {
    return { ok: false, reason: 'bad_claims' };
  }

  // El tipo va firmado: un enlace de emparejamiento no sirve como cookie de
  // dispositivo, ni al revés.
  if (claims.kind !== expectedKind) return { ok: false, reason: 'wrong_kind' };
  if (claims.exp <= nowSeconds) return { ok: false, reason: 'expired' };

  return { ok: true, claims };
}
