import { requireSession } from '@/lib/actions/auth';
import { listDevices } from '@/lib/dashboard/queries';
import { revokeDevice } from '@/lib/actions/dashboard';
import { DeviceForm } from './form';

export const dynamic = 'force-dynamic';

export default async function EquiposPage() {
  const session = await requireSession();
  const lista = await listDevices(session.userId);

  return (
    <>
      <header>
        <h1>Equipos</h1>
        <p>Cada teléfono o tablet que marca visitas es un equipo. Revocar uno lo deja fuera en el siguiente escaneo, aunque siga abierto.</p>
      </header>


      {lista.length > 0 && (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Device</th>
                <th>Última vez</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}</td>
                  <td className="soft">
                    {e.lastSeen
                      ? e.lastSeen.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })
                      : 'Nunca'}
                  </td>
                  <td className="soft">
                    {e.revoked ? 'Revocado' : e.locked ? 'Bloqueado por PIN' : 'Activo'}
                  </td>
                  <td className="num">
                    {!e.revoked && (
                      <form action={revokeDevice}>
                        <input type="hidden" name="id" value={e.id} />
                        <button type="submit" className="btn-quiet">
                          Revocar
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

      <h2 >Agregar un equipo</h2>
      <DeviceForm />
    </>
  );
}
