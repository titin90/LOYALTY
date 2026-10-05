import Link from 'next/link';
import { requireSession } from '@/lib/actions/auth';
import {
  dashboardSummary,
  recentLedger,
  weeklyVisits,
  atRiskCustomers,
} from '@/lib/dashboard/queries';
import { VisitsChart } from '@/app/_components/visits-chart';

export const dynamic = 'force-dynamic';

const EVENT_LABEL: Record<string, string> = {
  earn: 'Visita',
  redeem: 'Canje',
  welcome_bonus: 'Bienvenida',
  referral: 'Referido',
  adjust: 'Ajuste',
  expire: 'Vencimiento',
};

export default async function SummaryPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const session = await requireSession();

  const [summary, ledger, weeks, atRisk] = await Promise.all([
    dashboardSummary(session.userId),
    recentLedger(session.userId, 8),
    weeklyVisits(session.userId, 12),
    atRiskCustomers(session.userId),
  ]);

  const thisWeek = weeks.at(-1)?.visits ?? 0;
  const lastWeek = weeks.at(-2)?.visits ?? 0;
  const delta = thisWeek - lastWeek;

  const base = `/dashboard/${tenantSlug}`;

  return (
    <>
      {/* La alarma va primero: si nadie marca, nada de lo demás importa. */}
      {summary.scansThisWeek === 0 && (
        <div className="notice notice--alert">
          <h2>Nadie marcó visitas esta semana</h2>
          <p>
            Si el escáner dejó de usarse, tus clientes verán su tarjeta congelada y la
            abandonarán. <Link href={`${base}/devices`}>Revisa los equipos</Link>.
          </p>
        </div>
      )}

      <section className="hero">
        <div className="hero-head">
          <div>
            <p className="hero-n numero">{thisWeek}</p>
            <h1 className="hero-label">
              {thisWeek === 1 ? 'visita esta semana' : 'visitas esta semana'}
            </h1>
          </div>
          <p className={delta >= 0 ? 'trend trend--up' : 'trend trend--down'}>
            {delta === 0
              ? 'igual que la semana pasada'
              : `${delta > 0 ? '+' : ''}${delta} frente a la semana pasada`}
          </p>
        </div>

        <VisitsChart data={weeks} />
      </section>

      <dl className="figures">
        <Figure n={summary.customers} label="Clientes" />
        <Figure n={summary.newCustomersThisMonth} label="Nuevos este mes" />
        <Figure n={summary.redemptionsThisMonth} label="Canjes este mes" />
        <Figure n={atRisk.length} label="En riesgo" alert={atRisk.length > 0} />
      </dl>

      <div className="panels">
        <section className="panel">
          <div className="panel-head">
            <h2>Necesitan atención</h2>
            {atRisk.length > 5 && <Link href={`${base}/at-risk`}>Ver los {atRisk.length}</Link>}
          </div>

          {atRisk.length === 0 ? (
            <p className="soft">
              Nadie lleva más del doble de su ritmo sin venir. Hacen falta tres visitas para
              conocer el ritmo de una persona.
            </p>
          ) : (
            <ul className="mini-list">
              {atRisk.slice(0, 5).map((c) => (
                <li key={c.id}>
                  <Link href={`${base}/customers/${c.id}`}>{c.name}</Link>
                  <span className="soft">
                    {Math.round(c.risk.daysSinceLastVisit ?? 0)} días
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Última actividad</h2>
            <Link href={`${base}/customers`}>Ver clientes</Link>
          </div>

          {ledger.length === 0 ? (
            <p className="soft">
              Todavía no hay movimientos. Aparecerán en cuanto marques la primera visita.
            </p>
          ) : (
            <ul className="mini-list">
              {ledger.map((entry, i) => (
                <li key={i}>
                  <span className="mini-main">{entry.customer}</span>
                  <span className="soft">
                    {EVENT_LABEL[entry.kind] ?? entry.kind}{' '}
                    <span className="numero">{entry.delta > 0 ? `+${entry.delta}` : entry.delta}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function Figure({ n, label, alert = false }: { n: number; label: string; alert?: boolean }) {
  return (
    <div className="figure">
      <dd className={alert ? 'numero figure-n figure-n--alert' : 'numero figure-n'}>{n}</dd>
      <dt className="figure-label">{label}</dt>
    </div>
  );
}
