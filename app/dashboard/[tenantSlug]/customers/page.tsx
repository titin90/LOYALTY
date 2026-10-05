import Link from 'next/link';
import { requireSession } from '@/lib/actions/auth';
import { customers, listRewards } from '@/lib/dashboard/queries';
import { Punches } from '@/app/_components/punches';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = '' } = await searchParams;
  const session = await requireSession();
  const [rows, rewards] = await Promise.all([
    customers(session.userId, q),
    listRewards(session.userId),
  ]);

  // El umbral de referencia es el premio activo más bajo: es el que ve el cliente.
  const threshold =
    rewards.filter((r) => r.active).sort((a, b) => a.threshold - b.threshold)[0]?.threshold ?? null;

  return (
    <>
      <header>
        <h1>Clientes</h1>
        <p>
          {rows.length === 0 && q === ''
            ? 'Aún no hay nadie registrado.'
            : `${rows.length} ${rows.length === 1 ? 'persona' : 'personas'}, de la visita más reciente a la más antigua.`}
        </p>
      </header>

      <form className="search" method="get" role="search">
        <input
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Buscar por nombre o teléfono"
          aria-label="Buscar cliente"
        />
        <button type="submit" className="btn-quiet">
          Buscar
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="soft">
          {q
            ? `Nadie coincide con “${q}”. Prueba con los últimos dígitos del teléfono.`
            : 'Comparte el enlace de registro de tu negocio para que empiecen a sumar visitas.'}
        </p>
      ) : (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Progreso</th>
                <th className="num">Visitas</th>
                <th>Última visita</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`customers/${c.id}`}>{c.name}</Link>
                    <br />
                    <span className="faint">{c.phoneFormatted}</span>
                  </td>
                  <td>
                    <Punches balance={c.balance} threshold={threshold} />
                  </td>
                  <td className="num">{c.visits}</td>
                  <td className="soft">
                    {c.lastVisit
                      ? c.lastVisit.toLocaleDateString('es-CL', { dateStyle: 'medium' })
                      : 'Sin visitas'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
