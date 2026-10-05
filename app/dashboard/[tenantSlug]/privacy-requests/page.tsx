import { requireSession } from '@/lib/actions/auth';
import { listPrivacyRequests } from '@/lib/dashboard/dsr';
import { resolvePrivacyRequestAction } from '@/lib/actions/dashboard';

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
  const lista = await listPrivacyRequests(session.userId);
  const vencidas = lista.filter((s) => s.overdue).length;

  return (
    <>
      <header>
        <h1>Datos personales</h1>
        <p>Cuando alguien te pide acceder a sus datos o eliminarlos, tienes 30 días para responder. Aquí llevas la cuenta.</p>
      </header>


      {vencidas > 0 && (
        <p className="notice">
          {vencidas === 1
            ? 'Hay 1 solicitud fuera de plazo.'
            : `Hay ${vencidas} listPrivacyRequests fuera de plazo.`}{' '}
          Responderlas tarde es un incumplimiento de la Ley 21.719.
        </p>
      )}

      {lista.length === 0 ? (
        <p className="soft">No hay listPrivacyRequests registradas.</p>
      ) : (
        <div className="table-scroll">
          <table className="data">
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
                  <td>{s.customer ?? 'Cliente eliminado'}</td>
                  <td>{TIPOS[s.tipo] ?? s.tipo}</td>
                  <td className={s.overdue ? 'msg-error' : 'secundario'}>
                    {s.dueAt.toLocaleDateString('es-CL', { dateStyle: 'medium' })}
                  </td>
                  <td className="soft">{s.estado === 'resolved' ? 'Resuelta' : 'Abierta'}</td>
                  <td className="num">
                    {s.estado !== 'resolved' && (
                      <form action={resolvePrivacyRequestAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <button type="submit" className="btn-quiet">
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
