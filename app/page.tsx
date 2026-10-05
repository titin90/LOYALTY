import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { withAnonSession } from '@/lib/db/client';
import { walletAvailability } from '@/lib/wallet/config';

export const dynamic = 'force-dynamic';

/**
 * Índice. Tres públicos distintos llegan aquí:
 *
 *  - El dueño del negocio, que necesita el panel.
 *  - El encargado del local, cuyo equipo se empareja DESDE el panel.
 *  - El cliente, que en realidad nunca llega a esta página: entra por el enlace
 *    de su negocio, `/join/[negocio]`.
 *
 * En desarrollo lista los negocios sembrados, para poder entrar de un clic.
 * Esa lista no se muestra en producción.
 */
export default async function Inicio() {
  const esDesarrollo = process.env.NODE_ENV === 'development';
  const wallets = walletAvailability();
  const negocios = esDesarrollo ? await negociosSembrados() : [];

  return (
    <main className="pantalla">
      <div className="tarjeta">
        <p className="secundario" style={{ margin: 0, fontSize: '0.8125rem' }}>
          Tarjetas de fidelización
        </p>
        <h1 style={{ fontSize: '1.6rem', margin: '0.25rem 0 0' }}>Fidelización</h1>

        <hr className="regla-dorada" />

        <p className="secundario" style={{ marginTop: 0 }}>
          Tus clientes guardan su tarjeta en el teléfono y tú marcas sus visitas. Sin
          aplicaciones que instalar.
        </p>

        <div style={{ display: 'grid', gap: '0.6rem', marginTop: '1.5rem' }}>
          <Link className="boton" href="/login">
            Entrar al panel
          </Link>
        </div>

        <p className="secundario" style={{ fontSize: '0.8125rem' }}>
          El escáner del local se empareja desde <strong>Panel → Equipos</strong>. Tus clientes
          se registran en el enlace de tu negocio, no en esta página.
        </p>

        {esDesarrollo && (
          <>
            <hr style={{ border: 0, borderTop: '1px solid var(--borde)', margin: '1.5rem 0 1rem' }} />
            <p className="secundario" style={{ margin: 0, fontSize: '0.75rem', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Solo en desarrollo
            </p>

            {negocios.length === 0 ? (
              <p className="secundario" style={{ fontSize: '0.8125rem' }}>
                No hay negocios en la base. Corre <code>pnpm seed</code> para sembrar tres
                negocios de prueba con sus clientes.
              </p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: '0.75rem 0 0', display: 'grid', gap: '0.4rem' }}>
                {negocios.map((n) => (
                  <li key={n.slug} style={{ fontSize: '0.875rem' }}>
                    <strong>{n.name}</strong>
                    <br />
                    <Link href={`/join/${n.slug}`}>registro del cliente</Link>
                    {' · '}
                    <Link href={`/dashboard/${n.slug}`}>panel</Link>
                  </li>
                ))}
              </ul>
            )}

            <p className="secundario" style={{ fontSize: '0.8125rem', marginBottom: 0 }}>
              Wallets configuradas — Apple: {wallets.apple ? 'sí' : 'no'} · Google:{' '}
              {wallets.google ? 'sí' : 'no'}
            </p>
          </>
        )}
      </div>
    </main>
  );
}

async function negociosSembrados(): Promise<{ slug: string; name: string }[]> {
  try {
    return await withAnonSession(async (tx) => {
      const filas = (await tx.execute(
        sql`select slug, name from public.tenant_public order by name`,
      )) as unknown as { slug: string; name: string }[];
      return filas;
    });
  } catch {
    // Sin base de datos levantada, la página tiene que seguir cargando.
    return [];
  }
}
