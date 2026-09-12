/**
 * Sesión del dueño en el panel.
 *
 * Misma forma que la credencial del escáner: una cookie firmada con HMAC, sin
 * tabla de sesiones. La verificación es criptográfica y no toca la base, y lo
 * único que la cookie transporta es la identidad; qué puede ver esa identidad lo
 * decide RLS en cada consulta.
 *
 * Por qué autenticación propia y no Supabase Auth, como decía el documento de
 * arquitectura: `app.current_user_id()` ya lee el claim del JWT desde un GUC sin
 * depender del esquema `auth` de Supabase, así que esto encaja sin fricción y se
 * puede verificar de punta a punta contra Postgres. Cambiar a Supabase Auth más
 * adelante es reemplazar `signIn`: el resto de la aplicación no se entera.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface MemberSession {
  readonly userId: string;
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly name: string;
  readonly role: 'owner' | 'staff';
  readonly exp: number;
}

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_COOKIE = 'panel_session';

export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET ?? process.env.DEVICE_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET no está definida o es más corta que 32 caracteres');
  }
  return secret;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signSession(session: MemberSession, secret: string): string {
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function issueSession(
  base: Omit<MemberSession, 'exp'>,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  return signSession({ ...base, exp: nowSeconds + SESSION_TTL_SECONDS }, secret);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function verifySession(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): MemberSession | null {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;

  const payload = token.slice(0, dot);
  const a = Buffer.from(token.slice(dot + 1));
  const b = Buffer.from(sign(payload, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let session: MemberSession;
  try {
    session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as MemberSession;
  } catch {
    return null;
  }

  if (!UUID.test(session.userId ?? '') || !UUID.test(session.tenantId ?? '')) return null;
  if (typeof session.exp !== 'number' || session.exp <= nowSeconds) return null;
  if (session.role !== 'owner' && session.role !== 'staff') return null;

  return session;
}
