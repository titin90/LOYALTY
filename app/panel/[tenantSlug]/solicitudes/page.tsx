import { requireSession } from '@/lib/actions/auth';
import { solicitudes } from '@/lib/panel/dsr';
import { resolverSolicitudAccion } from '@/lib/actions/panel';

export const dynamic = 'force-dynamic';

const TIPOS: Record<string, string> = {
  access: 'Acceso a sus datos',
  rectification: 'Corrección',
  deletion: 'Eliminación',
  objection: 'Oposición',
  portability: 'Portabilidad',
};

export default async function SolicitudesPage() {
  const session = await requireSession();
  const lista = await solicitudes(session.userId);
  const vencidas = lista.filter((s) => s.vencida).length;

  return (
    <>
      <p className="secundario" style={{ marginTop: 0 }}>
        Cuando un cliente te pide acceder a sus datos o eliminarlos, tienes 30 días para
        responder. Aquí llevas la cuenta.
      </p>

      {vencidas > 0 && (
        <p className="aviso">
          {vencidas === 1
            ? 'Hay 1 solicitud fuera de plazo.'
            : `Hay ${vencidas} solicitudes fuera de plazo.`}{' '}
          Responderlas tarde es un incumplimiento de la Ley 21.719.
        </p>
      )}

      {lista.length === 0 ? (
        <p className="secundario">No hay solicitudes registradas.</p>
      ) : (
        <div className="tabla-envoltorio">
          <table className="tabla">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Qué pide</th>
                <th>Vence</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((s) => (
                <tr key={s.id}>
                  <td>{s.cliente ?? 'Cliente eliminado'}</td>
                  <td>{TIPOS[s.tipo] ?? s.tipo}</td>
                  <td className={s.vencida ? 'error' : 'secundario'}>
                    {s.venceEl.toLocaleDateString('es-CL', { dateStyle: 'medium' })}
                  </td>
                  <td className="secundario">{s.estado === 'resolved' ? 'Resuelta' : 'Abierta'}</td>
                  <td className="num">
                    {s.estado !== 'resolved' && (
                      <form action={resolverSolicitudAccion}>
                        <input type="hidden" name="id" value={s.id} />
                        <button type="submit" className="boton-menor">
                          Marcar resuelta
                        </button>
                      </form>
                    )}
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
