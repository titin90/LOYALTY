import { requireSession } from '@/lib/actions/auth';
import { disenoVigente, premios } from '@/lib/panel/queries';
import { parseCardDesign } from '@/lib/wallet/design';
import { EditorTarjeta } from './editor';

export const dynamic = 'force-dynamic';

export default async function TarjetaPage() {
  const session = await requireSession();
  const [config, lista] = await Promise.all([
    disenoVigente(session.userId),
    premios(session.userId),
  ]);

  const primerPremio = lista.find((p) => p.activo) ?? null;

  return (
    <>
      <p className="secundario" style={{ marginTop: 0 }}>
        Así se ve la tarjeta en el teléfono de tus clientes. Al publicar, las tarjetas ya
        entregadas se actualizan solas.
      </p>

      <EditorTarjeta
        inicial={parseCardDesign(config)}
        negocio={session.tenantSlug}
        premio={primerPremio?.nombre ?? null}
        umbral={primerPremio?.umbral ?? null}
      />
    </>
  );
}
