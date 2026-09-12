/**
 * Descarga del `.pkpass`.
 *
 * Autorización: además del serial en la URL, se exige la cookie que dejó el
 * registro. Así, quien escanee el QR de otra persona no puede descargar su pase
 * —que lleva su nombre— desde su propio navegador.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { passPayload, issueApplePass } from '@/lib/wallet/issue';
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

  const pkpass = await issueApplePass(payload);
  if (!pkpass) {
    return NextResponse.json({ error: 'Apple Wallet no está configurado' }, { status: 503 });
  }

  return new NextResponse(pkpass as unknown as BodyInit, {
    headers: {
      'content-type': 'application/vnd.apple.pkpass',
      'content-disposition': `attachment; filename="${payload.tenant_slug}.pkpass"`,
      'cache-control': 'no-store',
    },
  });
}
