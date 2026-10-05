/**
 * Cabeceras de seguridad y límite de peticiones.
 *
 * Las rutas caras o sensibles llevan un tope por IP. No sustituye a los bloqueos
 * de la base de datos (PIN por dispositivo, inicio de sesión por cuenta), que son
 * los que de verdad garantizan algo; esto solo evita que alguien martille los
 * endpoints públicos.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { consumir, clientIp, limitFor } from '@/lib/security/rate-limit';
import { securityHeaders, type Entorno } from '@/lib/security/headers';


export function middleware(request: NextRequest): NextResponse {
  const ruta = request.nextUrl.pathname;
  const limite = limitFor(ruta);

  if (limite) {
    const resultado = consumir(`${clientIp(request.headers)}:${limite.patron.source}`, limite.maximo, limite.ventana);

    if (!resultado.allowed) {
      return new NextResponse('Demasiadas peticiones. Espera un momento.', {
        status: 429,
        headers: {
          'retry-after': String(resultado.retryAfterSeconds),
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
