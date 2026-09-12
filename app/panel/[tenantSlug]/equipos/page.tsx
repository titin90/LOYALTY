import { requireSession } from '@/lib/actions/auth';
import { equipos } from '@/lib/panel/queries';
import { revocarEquipo } from '@/lib/actions/panel';
import { FormularioEquipo } from './formulario';

export const dynamic = 'force-dynamic';

export default async function EquiposPage() {
  const session = await requireSession();
  const lista = await equipos(session.userId);

  return (
    <>
      <p className="secundario" style={{ marginTop: 0 }}>
        Cada teléfono o tablet que marca visitas es un equipo. Revocar uno lo deja fuera
        en el siguiente escaneo, aunque siga abierto.
      </p>

      {lista.length > 0 && (
        <div className="tabla-envoltorio">
          <table className="tabla">
            <thead>
              <tr>
                <th>Equipo</th>
                <th>Última vez</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((e) => (
                <tr key={e.id}>
                  <td>{e.nombre}</td>
                  <td className="secundario">
                    {e.ultimaVez
                      ? e.ultimaVez.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })
                      : 'Nunca'}
                  </td>
                  <td className="secundario">
                    {e.revocado ? 'Revocado' : e.bloqueado ? 'Bloqueado por PIN' : 'Activo'}
                  </td>
                  <td className="num">
                    {!e.revocado && (
                      <form action={revocarEquipo}>
                        <input type="hidden" name="id" value={e.id} />
                        <button type="submit" className="boton-menor">
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

      <h2 className="seccion-titulo">Agregar un equipo</h2>
      <FormularioEquipo />
    </>
  );
}
