import { requireSession } from '@/lib/actions/auth';
import { premios } from '@/lib/dashboard/queries';
import { toggleReward } from '@/lib/actions/dashboard';
import { RewardForm } from './form';

export const dynamic = 'force-dynamic';

export default async function PremiosPage() {
  const session = await requireSession();
  const lista = await premios(session.userId);

  return (
    <>
      <p className="secundario" style={{ marginTop: 0 }}>
        El reward active con el threshold más bajo es el que ven tus customers en la card.
      </p>

      {lista.length > 0 && (
        <div className="tabla-envoltorio">
          <table className="tabla">
            <thead>
              <tr>
                <th>Reward</th>
                <th className="num">Visitas</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="num numero">{p.threshold}</td>
                  <td className="secundario">{p.active ? 'Activo' : 'Pausado'}</td>
                  <td className="num">
                    <form action={toggleReward}>
                      <input type="hidden" name="id" value={p.id} />
                      <button type="submit" className="boton-menor">
                        {p.active ? 'Pausar' : 'Activar'}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="seccion-titulo">Agregar reward</h2>
      <RewardForm />
    </>
  );
}
