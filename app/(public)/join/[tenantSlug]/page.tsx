import { notFound } from 'next/navigation';
import { getPublicTenant } from '@/lib/db/public-queries';
import { RegisterForm } from './register-form';

export const dynamic = 'force-dynamic';

export default async function RegisterPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await getPublicTenant(tenantSlug);

  if (!tenant) notFound();

  const primerPremio = tenant.rewards[0];

  return (
    <main className="screen">
      <div className="sheet card-object">
        <p className="soft" style={{ margin: 0, fontSize: '0.8125rem' }}>
          Tarjeta de fidelización
        </p>
        <h1 style={{ fontSize: '1.6rem', margin: '0.25rem 0 0' }}>{tenant.name}</h1>

        <hr className="rule-gold" />

        {primerPremio ? (
          <p className="soft" style={{ marginTop: 0 }}>
            Junta <strong>{primerPremio.threshold}</strong> visitas y llévate{' '}
            <strong>{primerPremio.name}</strong>.
            {tenant.welcomeBonusPoints > 0 && (
              <>
                {' '}
                Empiezas con{' '}
                <strong>
                  {tenant.welcomeBonusPoints}{' '}
                  {tenant.welcomeBonusPoints === 1 ? 'punto' : 'puntos'}
                </strong>{' '}
                de regalo.
              </>
            )}
          </p>
        ) : (
          <p className="soft" style={{ marginTop: 0 }}>
            Registra tu tarjeta y empieza a juntar visitas.
          </p>
        )}

        <RegisterForm tenantSlug={tenant.slug} />
      </div>
    </main>
  );
}
