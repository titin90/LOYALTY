import { requireSession } from '@/lib/actions/auth';
import { dashboardSummary, recentLedger } from '@/lib/dashboard/queries';

export const dynamic = 'force-dynamic';

const EVENT_LABEL: Record<string, string> = {
  earn: 'Visita',
  redeem: 'Canje',
  welcome_bonus: 'Bono de bienvenida',
  referral: 'Bono por referido',
  adjust: 'Ajuste',
  expire: 'Vencimiento',
};

export default async function SummaryPage() {
  const session = await requireSession();
  const [summary, ledger] = await Promise.all([
    dashboardSummary(session.userId),
    recentLedger(session.userId, 12),
  ]);

  return (
    <>
      <header>
        <h1>Resumen</h1>
      </header>

      <dl className="figures">
        <Figure n={summary.customers} label="Clientes" />
        <Figure n={summary.visitsThisMonth} label="Visitas este mes" gold />
        <Figure n={summary.redemptionsThisMonth} label="Canjes este mes" />
        <Figure n={summary.newCustomersThisMonth} label="Nuevos este mes" />
      </dl>

      {summary.scansThisWeek === 0 && (
        <div className="notice notice--alert">
          <h2>Nadie marcó visitas esta semana</h2>
          <p>
            Si el escáner dejó de usarse, tus clientes verán su tarjeta congelada y la
            abandonarán. Revisa que el equipo del mostrador siga emparejado.
          </p>
        </div>
      )}

      <section className="section">
        <h2>Últimos movimientos</h2>

        {ledger.length === 0 ? (
          <p className="soft">
            Todavía no hay movimientos. Aparecerán en cuanto marques la primera visita.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Cuándo</th>
                  <th>Cliente</th>
                  <th>Qué pasó</th>
                  <th className="num">Puntos</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((entry, i) => (
                  <tr key={i}>
                    <td className="soft">
                      {entry.at.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })}
                    </td>
                    <td>{entry.customer}</td>
                    <td>{EVENT_LABEL[entry.kind] ?? entry.kind}</td>
                    <td className="num">{entry.delta > 0 ? `+${entry.delta}` : entry.delta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Figure({ n, label, gold = false }: { n: number; label: string; gold?: boolean }) {
  return (
    <div className="figure">
      <dd className={gold ? 'numero figure-n figure-n--gold' : 'numero figure-n'}>{n}</dd>
      <dt className="figure-label">{label}</dt>
    </div>
  );
}
