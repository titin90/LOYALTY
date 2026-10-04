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
import { securityHeaders, type Entorno } from '@/lib/security/headers';

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

  const entorno = (process.env.NODE_ENV ?? 'production') as Entorno;
  for (const [nombre, valor] of Object.entries(securityHeaders(ruta, entorno))) {
    response.headers.set(nombre, valor);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
