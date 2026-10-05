import { requireSession } from '@/lib/actions/auth';
import { resumen, actividad } from '@/lib/dashboard/queries';

export const dynamic = 'force-dynamic';

const ETIQUETAS: Record<string, string> = {
  earn: 'Visita',
  redeem: 'Canje',
  welcome_bonus: 'Bono de bienvenida',
  referral: 'Bono por referido',
  adjust: 'Ajuste',
  expire: 'Vencimiento',
};

export default async function ResumenPage() {
  const session = await requireSession();
  const [datos, ledger] = await Promise.all([
    resumen(session.userId),
    actividad(session.userId),
  ]);

  return (
    <>
      <div className="tarjetas-metrica">
        <Metrica valor={datos.customers} etiqueta="Clientes" />
        <Metrica valor={datos.visitsThisMonth} etiqueta="Visitas este mes" />
        <Metrica valor={datos.redemptionsThisMonth} etiqueta="Canjes este mes" />
        <Metrica valor={datos.newCustomersThisMonth} etiqueta="Nuevos este mes" />
      </div>

      {datos.scansThisWeek === 0 && (
        <p className="aviso">
          No se ha marcado ninguna visita en los últimos 7 días. Si el escáner dejó de
          usarse, los clientes verán su tarjeta congelada y la abandonarán.
        </p>
      )}

      <h2 className="seccion-titulo">Últimos ledger</h2>

      {ledger.length === 0 ? (
        <p className="secundario">Todavía no hay ledger.</p>
      ) : (
        <div className="tabla-envoltorio">
          <table className="tabla">
            <thead>
              <tr>
                <th>Cuándo</th>
                <th>Cliente</th>
                <th>Qué pasó</th>
                <th className="num">Puntos</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((m, i) => (
                <tr key={i}>
                  <td className="secundario">
                    {m.at.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                  <td>{m.customer}</td>
                  <td>{ETIQUETAS[m.tipo] ?? m.tipo}</td>
                  <td className="num">{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Metrica({ valor, etiqueta }: { valor: number; etiqueta: string }) {
  return (
    <div className="metrica">
      <p className="numero metrica-valor">{valor}</p>
      <p className="secundario metrica-etiqueta">{etiqueta}</p>
    </div>
  );
}
