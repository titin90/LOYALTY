import { requireSession } from '@/lib/actions/auth';
import { publishedCardDesign, premios } from '@/lib/dashboard/queries';
import { parseCardDesign } from '@/lib/wallet/design';
import { CardEditor } from './editor';

export const dynamic = 'force-dynamic';

export default async function TarjetaPage() {
  const session = await requireSession();
  const [config, lista] = await Promise.all([
    publishedCardDesign(session.userId),
    premios(session.userId),
  ]);

  const primerPremio = lista.find((p) => p.active) ?? null;

  return (
    <>
      <p className="secundario" style={{ marginTop: 0 }}>
        Así se ve la card en el teléfono de tus customers. Al publicar, las tarjetas ya
        entregadas se actualizan solas.
      </p>

      <CardEditor
        inicial={parseCardDesign(config)}
        business={session.tenantSlug}
        reward={primerPremio?.name ?? null}
        threshold={primerPremio?.threshold ?? null}
      />
    </>
  );
}
