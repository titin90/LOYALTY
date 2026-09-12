import { notFound, redirect } from 'next/navigation';
import { getPublicTenant } from '@/lib/db/public-queries';
import { readCardCookie } from '@/lib/actions/register';

export const dynamic = 'force-dynamic';

export default async function ListoPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const [tenant, card] = await Promise.all([
    getPublicTenant(tenantSlug),
    readCardCookie(tenantSlug),
  ]);

  if (!tenant) notFound();
  if (!card) redirect(`/r/${tenantSlug}`);

  return (
    <main className="pantalla">
      <div className="tarjeta" style={{ textAlign: 'center' }}>
        <p className="secundario" style={{ margin: 0, fontSize: '0.8125rem' }}>
          {tenant.name}
        </p>
        <h1 style={{ fontSize: '1.5rem', margin: '0.4rem 0 0' }}>Tu tarjeta está lista</h1>

        <hr className="regla-dorada" style={{ margin: '1.5rem auto' }} />

        <p className="secundario">
          Guárdala en tu teléfono para tenerla siempre a mano. No necesitas instalar
          ninguna aplicación.
        </p>

        {/* Fase 1b: los botones reales necesitan el certificado de Apple y el
            issuer account de Google, ambos en trámite. */}
        <div style={{ display: 'grid', gap: '0.6rem', marginTop: '1.5rem' }}>
          <button className="boton" type="button" disabled>
            Agregar a Apple Wallet
          </button>
          <button className="boton" type="button" disabled>
            Agregar a Google Wallet
          </button>
        </div>

        <p className="secundario" style={{ fontSize: '0.8125rem', marginBottom: 0 }}>
          Muestra tu tarjeta en el local para sumar cada visita.
        </p>
      </div>
    </main>
  );
}
