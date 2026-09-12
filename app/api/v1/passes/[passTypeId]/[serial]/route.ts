/** Entrega la versión vigente del pase. Apple lo pide tras recibir un push. */
import { NextResponse, type NextRequest } from 'next/server';
import { applePassToken } from '@/lib/wallet/apple/web-service';
import { passPayload, issueApplePass } from '@/lib/wallet/issue';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ serial: string }> },
): Promise<NextResponse> {
  const { serial } = await context.params;
  const token = applePassToken(request.headers.get('authorization'));
  if (!token) return new NextResponse(null, { status: 401 });

  const payload = await passPayload(serial, token);
  if (!payload) return new NextResponse(null, { status: 401 });

  const pkpass = await issueApplePass(payload);
  if (!pkpass) return new NextResponse(null, { status: 503 });

  return new NextResponse(pkpass as unknown as BodyInit, {
    headers: {
      'content-type': 'application/vnd.apple.pkpass',
      'last-modified': new Date().toUTCString(),
      'cache-control': 'no-store',
    },
  });
}
