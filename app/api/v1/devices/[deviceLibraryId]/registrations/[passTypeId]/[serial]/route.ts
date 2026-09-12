/**
 * Alta y baja de un dispositivo para recibir actualizaciones de un pase.
 * Protocolo de Apple: los códigos de estado son parte del contrato.
 *   201 registrado · 200 ya estaba · 401 token inválido · 200 en la baja
 */
import { NextResponse, type NextRequest } from 'next/server';
import { applePassToken, registerDevice, unregisterDevice } from '@/lib/wallet/apple/web-service';

export const dynamic = 'force-dynamic';

type Contexto = { params: Promise<{ deviceLibraryId: string; passTypeId: string; serial: string }> };

export async function POST(request: NextRequest, context: Contexto): Promise<NextResponse> {
  const { deviceLibraryId, serial } = await context.params;
  const token = applePassToken(request.headers.get('authorization'));
  if (!token) return new NextResponse(null, { status: 401 });

  let pushToken: string | undefined;
  try {
    pushToken = ((await request.json()) as { pushToken?: string }).pushToken;
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (!pushToken) return new NextResponse(null, { status: 400 });

  const ok = await registerDevice(serial, token, deviceLibraryId, pushToken);
  return new NextResponse(null, { status: ok ? 201 : 401 });
}

export async function DELETE(request: NextRequest, context: Contexto): Promise<NextResponse> {
  const { deviceLibraryId, serial } = await context.params;
  const token = applePassToken(request.headers.get('authorization'));
  if (!token) return new NextResponse(null, { status: 401 });

  const ok = await unregisterDevice(serial, token, deviceLibraryId);
  return new NextResponse(null, { status: ok ? 200 : 401 });
}
