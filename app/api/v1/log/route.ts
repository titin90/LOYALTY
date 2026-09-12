/**
 * Bitácora de los dispositivos de Apple. Es el único canal para saber por qué un
 * pase fue rechazado, así que conviene tenerlo aunque solo escriba en el log.
 */
import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { logs } = (await request.json()) as { logs?: string[] };
    for (const linea of (logs ?? []).slice(0, 20)) {
      console.warn('[apple-wallet]', linea);
    }
  } catch {
    // Un cuerpo ilegible no merece error: Apple no hace nada con la respuesta.
  }
  return new NextResponse(null, { status: 200 });
}
