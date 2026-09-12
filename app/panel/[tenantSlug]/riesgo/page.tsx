import { requireSession } from '@/lib/actions/auth';
import { clientesEnRiesgo } from '@/lib/panel/queries';

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
  const enRiesgo = await clientesEnRiesgo(session.userId);

  return (
    <>
      <p className="secundario" style={{ marginTop: 0 }}>
        Clientes que llevan más del doble de su propio ritmo sin venir. El botón abre
        WhatsApp en tu teléfono con el mensaje listo — tú decides si lo envías.
      </p>

      {enRiesgo.length === 0 ? (
        <p className="secundario">
          Nadie en riesgo ahora mismo. Se necesitan al menos 3 visitas para conocer el
          ritmo de un cliente.
        </p>
      ) : (
        <ul className="lista-riesgo">
          {enRiesgo.map((c) => {
            const dias = Math.round(c.riesgo.daysSinceLastVisit ?? 0);
            const cadencia = Math.round(c.riesgo.cadenceDays ?? 0);
            const mensaje = `Hola ${c.nombre.split(' ')[0]}, ¡te echamos de menos! Tienes ${c.saldo} ${c.saldo === 1 ? 'punto' : 'puntos'} esperándote. ¿Te agendamos?`;

            return (
              <li key={c.id} className="riesgo-fila">
                <div>
                  <p className="riesgo-nombre">{c.nombre}</p>
                  <p className="secundario riesgo-detalle">
                    {dias} días sin venir · suele venir cada {cadencia} ·{' '}
                    {c.saldo} {c.saldo === 1 ? 'punto' : 'puntos'}
                  </p>
                </div>
                <a
                  className="boton-menor"
                  href={`https://wa.me/${c.telefono.replace('+', '')}?text=${encodeURIComponent(mensaje)}`}
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
