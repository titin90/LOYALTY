/**
 * Canjea un enlace de emparejamiento por la cookie de larga duración del equipo.
 *
 * Es un Route Handler y no una página porque Next solo permite escribir cookies
 * desde un Route Handler o un Server Action, nunca durante el render.
 *
 * El enlace es un portador de vida corta (15 min). La verificación es puramente
 * criptográfica y no toca la base: así el emparejamiento no necesita una quinta
 * función que salte RLS. La revocación la aplica `app.record_scan` en cada
 * marcaje, de modo que revocar un equipo surte efecto aunque su cookie siga viva.
 */
import { NextResponse, type NextRequest } from 'next/server';
import {
  verifyDeviceToken,
  issueToken,
  deviceSecret,
  DEVICE_TOKEN_TTL_SECONDS,
} from '@/lib/device/token';

export const dynamic = 'force-dynamic';

function fallo(request: NextRequest, motivo: string): NextResponse {
  const url = new URL('/scan/pairing-failed', request.url);
  url.searchParams.set('motivo', motivo);
  return NextResponse.redirect(url);
}

export function GET(request: NextRequest): NextResponse {
  const token = request.nextUrl.searchParams.get('t');
  if (!token) return fallo(request, 'falta');

  const result = verifyDeviceToken(token, 'pair', deviceSecret());
  if (!result.ok) {
    return fallo(request, result.reason === 'expired' ? 'vencido' : 'invalido');
  }

  const { tenantId, deviceId, userId } = result.claims;
  const response = NextResponse.redirect(new URL('/scan', request.url));

  response.cookies.set({
    name: 'device_token',
    value: issueToken('device', { tenantId, deviceId, userId }, deviceSecret()),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: DEVICE_TOKEN_TTL_SECONDS,
  });

  return response;
}
