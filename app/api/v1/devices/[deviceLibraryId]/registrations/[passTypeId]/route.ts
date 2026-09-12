/** Seriales con cambios desde la última consulta del dispositivo. 204 si no hay. */
import { NextResponse, type NextRequest } from 'next/server';
import { updatedSerials } from '@/lib/wallet/apple/web-service';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ deviceLibraryId: string }> },
): Promise<NextResponse> {
  const { deviceLibraryId } = await context.params;
  const since = request.nextUrl.searchParams.get('passesUpdatedSince');

  const result = await updatedSerials(deviceLibraryId, since);
  if (result.serialNumbers.length === 0) return new NextResponse(null, { status: 204 });

  return NextResponse.json(result);
}
