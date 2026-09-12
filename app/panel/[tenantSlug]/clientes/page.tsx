import { requireSession } from '@/lib/actions/auth';
import { clientes } from '@/lib/panel/queries';

export const dynamic = 'force-dynamic';

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = '' } = await searchParams;
  const session = await requireSession();
  const filas = await clientes(session.userId, q);

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
                  <td>{c.nombre}</td>
                  <td className="secundario">{c.telefonoLegible}</td>
                  <td className="num numero">{c.saldo}</td>
                  <td className="num">{c.visitas}</td>
                  <td className="secundario">
                    {c.ultimaVisita
                      ? c.ultimaVisita.toLocaleDateString('es-CL', { dateStyle: 'medium' })
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
