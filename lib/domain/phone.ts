/**
 * Normalización de teléfonos chilenos a E.164.
 *
 * El teléfono no se verifica en v1 (sin OTP: el costo de SMS y la fricción no se
 * justifican), pero sí se normaliza: es la clave única del cliente dentro del
 * negocio y el canal del win-back. Un typo aquí rompe ambas cosas.
 */
const CL_MOBILE = /^(?:\+?56)?0?(9\d{8})$/;

export type PhoneResult =
  | { ok: true; e164: string }
  | { ok: false; reason: 'empty' | 'format' };

export function normalizeChileanPhone(input: string): PhoneResult {
  const digits = (input ?? '').replace(/[\s()\-.]/g, '');
  if (digits === '') return { ok: false, reason: 'empty' };

  const match = CL_MOBILE.exec(digits);
  if (!match?.[1]) return { ok: false, reason: 'format' };

  return { ok: true, e164: `+56${match[1]}` };
}

/** Formato legible para el panel: +56 9 1234 5678 */
export function formatChileanPhone(e164: string): string {
  const m = /^\+56(9)(\d{4})(\d{4})$/.exec(e164);
  if (!m) return e164;
  return `+56 ${m[1]} ${m[2]} ${m[3]}`;
}
