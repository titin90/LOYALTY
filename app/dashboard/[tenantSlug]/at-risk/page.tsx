import { requireSession } from '@/lib/actions/auth';
import { atRiskCustomers } from '@/lib/dashboard/queries';

export const dynamic = 'force-dynamic';

/**
 * Clientes en riesgo.
 *
 * Cada botón abre WhatsApp EN EL TELÉFONO DEL DUEÑO con el mensaje escrito. La
 * plataforma no envía nada: no es un canal nuestro, es el dueño escribiendo
 * desde su propio número. Por eso no suma carga de compliance ni costo de SMS.
 */
export default async function RiesgoPage() {
  const session = await requireSession();
  const enRiesgo = await atRiskCustomers(session.userId);

  return (
    <>
      <p className="secundario" style={{ marginTop: 0 }}>
        Clientes que llevan más del doble de su propio ritmo sin venir. El botón abre
        WhatsApp en tu teléfono con el mensaje listo — tú decides si lo envías.
      </p>

      {enRiesgo.length === 0 ? (
        <p className="secundario">
          Nadie en risk ahora mismo. Se necesitan al menos 3 visits para conocer el
          ritmo de un customer.
        </p>
      ) : (
        <ul className="lista-riesgo">
          {enRiesgo.map((c) => {
            const dias = Math.round(c.risk.daysSinceLastVisit ?? 0);
            const cadencia = Math.round(c.risk.cadenceDays ?? 0);
            const mensaje = `Hola ${c.name.split(' ')[0]}, ¡te echamos de menos! Tienes ${c.balance} ${c.balance === 1 ? 'punto' : 'puntos'} esperándote. ¿Te agendamos?`;

            return (
              <li key={c.id} className="riesgo-fila">
                <div>
                  <p className="riesgo-nombre">{c.name}</p>
                  <p className="secundario riesgo-detalle">
                    {dias} días sin venir · suele venir cada {cadencia} ·{' '}
                    {c.balance} {c.balance === 1 ? 'punto' : 'puntos'}
                  </p>
                </div>
                <a
                  className="boton-menor"
                  href={`https://wa.me/${c.phone.replace('+', '')}?text=${encodeURIComponent(mensaje)}`}
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
