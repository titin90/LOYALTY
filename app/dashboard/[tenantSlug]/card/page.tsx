import { requireSession } from '@/lib/actions/auth';
import { publishedCardDesign, listRewards } from '@/lib/dashboard/queries';
import { parseCardDesign } from '@/lib/wallet/design';
import { CardEditor } from './editor';

export const dynamic = 'force-dynamic';

export default async function TarjetaPage() {
  const session = await requireSession();
  const [config, lista] = await Promise.all([
    publishedCardDesign(session.userId),
    listRewards(session.userId),
  ]);

  const primerPremio = lista.find((p) => p.active) ?? null;

  return (
    <>
      <header>
        <h1>Tarjeta</h1>
        <p>Así se ve en el teléfono de tus clientes. Al publicar, las tarjetas ya entregadas se actualizan solas.</p>
      </header>


      <CardEditor
        inicial={parseCardDesign(config)}
        business={session.tenantSlug}
        reward={primerPremio?.name ?? null}
        threshold={primerPremio?.threshold ?? null}
      />
    </>
  );
}
