/**
 * Cabeceras de seguridad y límite de peticiones.
 *
 * Las rutas caras o sensibles llevan un tope por IP. No sustituye a los bloqueos
 * de la base de datos (PIN por dispositivo, inicio de sesión por cuenta), que son
 * los que de verdad garantizan algo; esto solo evita que alguien martille los
 * endpoints públicos.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { consumir, ipDe } from '@/lib/security/rate-limit';

const LIMITES: { patron: RegExp; maximo: number; ventana: number }[] = [
  // El registro crea filas: es lo más caro que puede disparar un anónimo.
  { patron: /^\/r\//, maximo: 20, ventana: 60 },
  // Iniciar sesión cuesta un bcrypt por intento.
  { patron: /^\/entrar/, maximo: 15, ventana: 60 },
  // Emitir un pase firma criptografía.
  { patron: /^\/api\/wallet\//, maximo: 30, ventana: 60 },
  // El web service de Apple: generoso, lo llaman los dispositivos.
  { patron: /^\/api\/v1\//, maximo: 120, ventana: 60 },
];

export function middleware(request: NextRequest): NextResponse {
  const ruta = request.nextUrl.pathname;
  const limite = LIMITES.find((l) => l.patron.test(ruta));

  if (limite) {
    const resultado = consumir(`${ipDe(request.headers)}:${limite.patron.source}`, limite.maximo, limite.ventana);

    if (!resultado.permitido) {
      return new NextResponse('Demasiadas peticiones. Espera un momento.', {
        status: 429,
        headers: {
          'retry-after': String(resultado.reiniciaEnSegundos),
          'content-type': 'text/plain; charset=utf-8',
        },
      });
    }
  }

  const response = NextResponse.next();

  for (const [nombre, valor] of Object.entries(cabecerasDeSeguridad(ruta))) {
    response.headers.set(nombre, valor);
  }

  return response;
}

function cabecerasDeSeguridad(ruta: string): Record<string, string> {
  // El escáner necesita la cámara; ninguna otra ruta debería pedirla.
  const camara = ruta.startsWith('/scan') ? 'camera=(self)' : 'camera=()';

  return {
    'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': `${camara}, microphone=(), geolocation=(), payment=()`,
    'x-frame-options': 'DENY',
    'content-security-policy': [
      "default-src 'self'",
      // Next inyecta scripts en línea para hidratar; wasm-unsafe-eval es lo que
      // necesita el decodificador de QR del escáner.
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      // Solo lo nuestro y Google Wallet, que es a donde va el enlace de guardado.
      "connect-src 'self' https://walletobjects.googleapis.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      'upgrade-insecure-requests',
    ].join('; '),
  };
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
