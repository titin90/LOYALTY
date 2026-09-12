/**
 * Versión vigente del texto de consentimiento.
 *
 * Se guarda junto a cada registro (`consents.version`). Cambiar el texto exige
 * subir la versión: la Ley 21.719 obliga a poder demostrar a qué consintió cada
 * persona y cuándo, no solo que consintió.
 */
export const CONSENT_VERSION = '2026-09-v1';

export const CONSENT_TEXT =
  'Autorizo a este negocio a guardar mi nombre y teléfono para administrar mi ' +
  'tarjeta de fidelización y avisarme de mis beneficios. Puedo pedir acceder a ' +
  'mis datos o eliminarlos en cualquier momento.';
