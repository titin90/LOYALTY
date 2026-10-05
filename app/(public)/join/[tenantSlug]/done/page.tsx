import { notFound, redirect } from 'next/navigation';
import { getPublicTenant } from '@/lib/db/public-queries';
import { readCardCookie } from '@/lib/actions/register';
import { walletAvailability } from '@/lib/wallet/config';

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
  if (!card) redirect(`/join/${tenantSlug}`);

  const wallets = walletAvailability();
  const ninguna = !wallets.apple && !wallets.google;

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

        <div style={{ display: 'grid', gap: '0.6rem', marginTop: '1.5rem' }}>
          {wallets.apple && (
            <a className="boton" href={`/api/wallet/apple/${card.serial}`}>
              Agregar a Apple Wallet
            </a>
          )}
          {wallets.google && (
            <a className="boton" href={`/api/wallet/google/${card.serial}`}>
              Agregar a Google Wallet
            </a>
          )}
        </div>

        {ninguna && (
          <p className="secundario" style={{ fontSize: '0.8125rem' }}>
            La tarjeta digital estará disponible muy pronto. Mientras tanto, en el local
            te encuentran por tu teléfono.
          </p>
        )}

        <p className="secundario" style={{ fontSize: '0.8125rem', marginBottom: 0 }}>
          Muestra tu tarjeta en el local para sumar cada visita.
        </p>
      </div>
    </main>
  );
}
