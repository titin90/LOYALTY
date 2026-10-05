import { requireSession } from '@/lib/actions/auth';
import { listRewards } from '@/lib/dashboard/queries';
import { toggleReward } from '@/lib/actions/dashboard';
import { RewardForm } from './form';

export const dynamic = 'force-dynamic';

export default async function PremiosPage() {
  const session = await requireSession();
  const lista = await listRewards(session.userId);

  return (
    <>
      <header>
        <h1>Premios</h1>
        <p>El premio activo con el umbral más bajo es el que tus clientes ven en su tarjeta.</p>
      </header>


      {lista.length > 0 && (
        <div className="table-scroll">
          <table className="data">
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
                  <td className="soft">{p.active ? 'Activo' : 'Pausado'}</td>
                  <td className="num">
                    <form action={toggleReward}>
                      <input type="hidden" name="id" value={p.id} />
                      <button type="submit" className="btn-quiet">
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

      <h2 >Agregar reward</h2>
      <RewardForm />
    </>
  );
}
