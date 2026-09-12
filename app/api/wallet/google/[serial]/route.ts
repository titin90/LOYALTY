import { NextResponse, type NextRequest } from 'next/server';
import { passPayload, googleSaveUrl } from '@/lib/wallet/issue';
import { serialFromCookie } from '@/lib/wallet/authorize';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ serial: string }> },
): Promise<NextResponse> {
  const { serial } = await context.params;

  if (serialFromCookie(request) !== serial) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 403 });
  }

  const payload = await passPayload(serial);
  if (!payload) return NextResponse.json({ error: 'tarjeta no encontrada' }, { status: 404 });

  const url = await googleSaveUrl(payload);
  if (!url) {
    return NextResponse.json({ error: 'Google Wallet no está configurado' }, { status: 503 });
  }

  return NextResponse.redirect(url);
}
