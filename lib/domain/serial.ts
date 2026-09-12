/**
 * Extracción del serial de la tarjeta desde lo que trae el QR.
 *
 * El pase puede codificar el serial pelado o una URL que termina en él, según la
 * plataforma de wallet. El escáner también apunta a códigos que no son nuestros,
 * así que esto tiene que rechazar en vez de adivinar.
 */
const SERIAL = /^[0-9a-f]{32}$/i;

export function extractSerial(scanned: string): string | null {
  const text = scanned.trim();
  if (text === '') return null;

  if (SERIAL.test(text)) return text.toLowerCase();

  // Formas de URL: .../p/<serial>, ...?s=<serial>
  try {
    const url = new URL(text);
    const fromQuery = url.searchParams.get('s');
    if (fromQuery && SERIAL.test(fromQuery)) return fromQuery.toLowerCase();

    const last = url.pathname.split('/').filter(Boolean).pop();
    if (last && SERIAL.test(last)) return last.toLowerCase();
  } catch {
    // No era una URL: cae al rechazo de abajo.
  }

  return null;
}
