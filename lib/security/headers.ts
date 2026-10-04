/**
 * Cabeceras de seguridad.
 *
 * Vive aparte del middleware para poder testearse: una CSP mal armada no falla
 * de forma visible, simplemente bloquea cosas en silencio — o rompe el modo
 * desarrollo, que es justo lo que pasó con la primera versión.
 */
export type Entorno = 'development' | 'production' | 'test';

export function securityHeaders(ruta: string, entorno: Entorno): Record<string, string> {
  // El escáner necesita la cámara; ninguna otra ruta debería pedirla.
  const camara = ruta.startsWith('/scan') ? 'camera=(self)' : 'camera=()';

  // React usa eval() en desarrollo para reconstruir stacks y para el refresco en
  // caliente. En producción NUNCA lo usa, así que el permiso no se concede ahí.
  const evalEnDesarrollo = entorno === 'development' ? " 'unsafe-eval'" : '';

  const csp = [
    "default-src 'self'",
    // `unsafe-inline`: Next inyecta scripts en línea para hidratar.
    // `wasm-unsafe-eval`: lo necesita el decodificador de QR del escáner.
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${evalEnDesarrollo}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // Solo lo nuestro y Google Wallet, que es a donde va el enlace de guardado.
    // En desarrollo se agrega websocket para el refresco en caliente de Next.
    entorno === 'development'
      ? "connect-src 'self' ws: wss: https://walletobjects.googleapis.com"
      : "connect-src 'self' https://walletobjects.googleapis.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ];

  // Sobre http://localhost esto rompería cada petición.
  if (entorno === 'production') csp.push('upgrade-insecure-requests');

  const cabeceras: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': `${camara}, microphone=(), geolocation=(), payment=()`,
    'x-frame-options': 'DENY',
    'content-security-policy': csp.join('; '),
  };

  // HSTS solo en producción: en local no hay https y el navegador recordaría
  // la regla para localhost durante dos años.
  if (entorno === 'production') {
    cabeceras['strict-transport-security'] = 'max-age=63072000; includeSubDomains; preload';
  }

  return cabeceras;
}
