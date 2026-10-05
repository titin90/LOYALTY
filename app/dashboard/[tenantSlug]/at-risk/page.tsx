import { requireSession } from '@/lib/actions/auth';
import { atRiskCustomers } from '@/lib/dashboard/queries';

export const dynamic = 'force-dynamic';

/**
 * Clientes en riesgo.
 *
 * Cada botón abre WhatsApp EN EL TELÉFONO DEL DUEÑO con el mensaje escrito. La
 * plataforma no envía nada: no es un canal nuestro, es el dueño escribiendo
 * desde su propio número. Por eso no suma carga de compliance ni costo de SMS.
 *
 * El grosor de la banda izquierda crece con el atraso, así la fila que más urge
 * se ve antes de leer un número.
 */
export default async function AtRiskPage() {
  const session = await requireSession();
  const rows = await atRiskCustomers(session.userId);

  return (
    <>
      <header>
        <h1>En riesgo</h1>
        <p>
          Quienes llevan más del doble de su propio ritmo sin venir. El botón abre WhatsApp
          en tu teléfono con el mensaje listo; tú decides si lo envías.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="soft">
          Nadie en riesgo ahora mismo. Hacen falta al menos tres visitas para conocer el
          ritmo de una persona, así que los clientes nuevos no aparecen aquí.
        </p>
      ) : (
        <ul className="risk-list">
          {rows.map((c) => {
            const days = Math.round(c.risk.daysSinceLastVisit ?? 0);
            const cadence = Math.round(c.risk.cadenceDays ?? 0);
            const overdue = cadence > 0 ? days / cadence : 0;
            const severity = overdue >= 4 ? 'high' : overdue >= 3 ? 'mid' : 'low';

            const firstName = c.name.split(' ')[0] ?? c.name;
            const message =
              `Hola ${firstName}, ¡te echamos de menos! Tienes ${c.balance} ` +
              `${c.balance === 1 ? 'punto' : 'puntos'} esperándote. ¿Te agendamos?`;

            return (
              <li key={c.id} className={`risk-row risk-row--${severity}`}>
                <div className="risk-who">
                  <p className="risk-name">{c.name}</p>
                  <p className="risk-why">
                    {days} días sin venir, y suele venir cada {cadence}.{' '}
                    {c.balance === 1 ? 'Tiene 1 punto' : `Tiene ${c.balance} puntos`}.
                  </p>
                </div>
                <a
                  className="btn-quiet"
                  href={`https://wa.me/${c.phone.replace('+', '')}?text=${encodeURIComponent(message)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  WhatsApp
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
