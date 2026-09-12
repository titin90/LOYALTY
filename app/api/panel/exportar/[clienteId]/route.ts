/**
 * Exportación de los datos de una persona, en JSON.
 *
 * Cubre los derechos de acceso y de portabilidad: es el archivo que el negocio
 * le entrega a su cliente cuando lo pide.
 */
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/actions/auth';
import { exportarCliente } from '@/lib/panel/dsr';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ clienteId: string }> },
): Promise<NextResponse> {
  const { clienteId } = await context.params;
  const session = await requireSession();

  if (!/^[0-9a-f-]{36}$/i.test(clienteId)) {
    return NextResponse.json({ error: 'cliente inválido' }, { status: 400 });
  }

  const datos = await exportarCliente(session.userId, clienteId);
  if (!datos) return NextResponse.json({ error: 'no encontrado' }, { status: 404 });

  return new NextResponse(JSON.stringify(datos, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="datos-${clienteId}.json"`,
      'cache-control': 'no-store',
    },
  });
}
