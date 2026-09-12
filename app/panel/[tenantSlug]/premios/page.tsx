import { requireSession } from '@/lib/actions/auth';
import { premios } from '@/lib/panel/queries';
import { alternarPremio } from '@/lib/actions/panel';
import { FormularioPremio } from './formulario';

export const dynamic = 'force-dynamic';

export default async function PremiosPage() {
  const session = await requireSession();
  const lista = await premios(session.userId);

  return (
    <>
      <p className="secundario" style={{ marginTop: 0 }}>
        El premio activo con el umbral más bajo es el que ven tus clientes en la tarjeta.
      </p>

      {lista.length > 0 && (
        <div className="tabla-envoltorio">
          <table className="tabla">
            <thead>
              <tr>
                <th>Premio</th>
                <th className="num">Visitas</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id}>
                  <td>{p.nombre}</td>
                  <td className="num numero">{p.umbral}</td>
                  <td className="secundario">{p.activo ? 'Activo' : 'Pausado'}</td>
                  <td className="num">
                    <form action={alternarPremio}>
                      <input type="hidden" name="id" value={p.id} />
                      <button type="submit" className="boton-menor">
                        {p.activo ? 'Pausar' : 'Activar'}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="seccion-titulo">Agregar premio</h2>
      <FormularioPremio />
    </>
  );
}
