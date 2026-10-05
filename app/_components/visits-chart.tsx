import type { WeeklyVisits } from '@/lib/dashboard/queries';

/**
 * Visitas por semana.
 *
 * Una sola serie, así que no lleva leyenda: el título la nombra. Las barras se
 * anclan a la línea base, llevan extremo redondeado y separación entre ellas, y
 * los ejes quedan recesivos — el dato manda, no la grilla.
 *
 * El valor se muestra al pasar el cursor y, además, cada barra lleva su cifra en
 * el texto accesible: el color del dorado queda bajo 3:1 en claro si se usa el
 * tono de marca, así que la lectura nunca depende solo del color.
 */
export function VisitsChart({ data }: { data: readonly WeeklyVisits[] }) {
  const max = Math.max(...data.map((d) => d.visits), 1);
  const total = data.reduce((n, d) => n + d.visits, 0);

  const mes = (d: Date) =>
    d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  return (
    <figure
      className="chart"
      role="img"
      aria-label={`Visitas por semana en las últimas ${data.length} semanas: ${total} en total. ${data
        .map((d) => `${mes(d.week)}: ${d.visits}`)
        .join('; ')}.`}
    >
      <div className="chart-plot">
        {data.map((d, i) => {
          const esUltima = i === data.length - 1;
          return (
            <div key={d.week.toISOString()} className="chart-col">
              <span className="chart-value">{d.visits}</span>
              <div
                className={esUltima ? 'chart-bar chart-bar--now' : 'chart-bar'}
                style={{ height: `${Math.max((d.visits / max) * 100, d.visits > 0 ? 4 : 1.5)}%` }}
              />
              <span className="chart-tick">{esUltima ? 'Esta semana' : mes(d.week)}</span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}
