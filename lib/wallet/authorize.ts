import type { NextRequest } from 'next/server';

/**
 * Serial guardado por el registro, en cookie httpOnly.
 *
 * El serial es la credencial de la tarjeta: conocerlo autoriza a obtener el
 * pase. Exigir además la cookie impide que alguien que escaneó el QR ajeno se
 * descargue ese pase, que lleva el nombre del titular.
 */
export function serialFromCookie(request: NextRequest): string | null {
  const raw = request.cookies.get('card_serial')?.value;
  if (!raw) return null;

  const separator = raw.indexOf(':');
  if (separator === -1) return null;

  const serial = raw.slice(separator + 1);
  return /^[0-9a-f]{32}$/i.test(serial) ? serial : null;
}
