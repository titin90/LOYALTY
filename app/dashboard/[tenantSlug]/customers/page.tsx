import { requireSession } from '@/lib/actions/auth';
import Link from 'next/link';
import { customers } from '@/lib/dashboard/queries';

export const dynamic = 'force-dynamic';

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = '' } = await searchParams;
  const session = await requireSession();
  const filas = await customers(session.userId, q);

  return (
    <>
      <form className="buscador" method="get">
        <input
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Buscar por nombre o teléfono"
          aria-label="Buscar cliente"
        />
        <button type="submit" className="boton-menor">
          Buscar
        </button>
      </form>

      {filas.length === 0 ? (
        <p className="secundario">
          {q ? `Sin resultados para "${q}".` : 'Todavía no hay clientes registrados.'}
        </p>
      ) : (
        <div className="tabla-envoltorio">
          <table className="tabla">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Teléfono</th>
                <th className="num">Puntos</th>
                <th className="num">Visitas</th>
                <th>Última visita</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`customers/${c.id}`}>{c.name}</Link>
                  </td>
                  <td className="secundario">{c.phoneFormatted}</td>
                  <td className="num numero">{c.balance}</td>
                  <td className="num">{c.visits}</td>
                  <td className="secundario">
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
