import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/actions/auth';
import { exportCustomer } from '@/lib/dashboard/dsr';
import { formatChileanPhone } from '@/lib/domain/phone';
import { recordPrivacyRequestAction } from '@/lib/actions/dashboard';
import { EraseForm } from './erase-form';

export const dynamic = 'force-dynamic';

const ETIQUETAS: Record<string, string> = {
  earn: 'Visita',
  redeem: 'Canje',
  welcome_bonus: 'Bono de bienvenida',
  referral: 'Bono por referido',
  adjust: 'Ajuste',
  expire: 'Vencimiento',
};

export default async function FichaCliente({
  params,
}: {
  params: Promise<{ tenantSlug: string; customerId: string }>;
}) {
  const { tenantSlug, customerId } = await params;
  const session = await requireSession();
  const datos = await exportCustomer(session.userId, customerId);

  if (!datos) notFound();

  return (
    <>
      <h2 style={{ fontSize: '1.35rem', margin: '0 0 0.25rem' }}>{datos.subject.name}</h2>
      <p className="secundario" style={{ margin: 0 }}>
        {formatChileanPhone(datos.subject.phone)} · customer since{' '}
        {new Date(datos.subject.customerSince).toLocaleDateString('es-CL', { dateStyle: 'medium' })}
      </p>

      <div className="tarjetas-metrica" style={{ marginTop: '1.5rem' }}>
        <div className="metrica">
          <p className="numero metrica-valor">{datos.card?.balance ?? 0}</p>
          <p className="secundario metrica-etiqueta">Puntos</p>
        </div>
        <div className="metrica">
          <p className="numero metrica-valor">
            {datos.ledger.filter((m) => m.tipo === 'earn').length}
          </p>
          <p className="secundario metrica-etiqueta">Visitas</p>
        </div>
        <div className="metrica">
          <p className="numero metrica-valor">{datos.redemptions.length}</p>
          <p className="secundario metrica-etiqueta">Canjes</p>
        </div>
      </div>

      <h2 className="seccion-titulo">Movimientos</h2>
      <div className="tabla-envoltorio">
        <table className="tabla">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Qué pasó</th>
              <th className="num">Puntos</th>
            </tr>
          </thead>
          <tbody>
            {datos.ledger.map((m, i) => (
              <tr key={i}>
                <td className="secundario">
                  {new Date(m.date).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}
                </td>
                <td>{ETIQUETAS[m.tipo] ?? m.tipo}</td>
                <td className="num">{m.points > 0 ? `+${m.points}` : m.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="seccion-titulo">Derechos del subject</h2>
      <p className="secundario" style={{ marginTop: 0 }}>
        Si esta persona te pide acceder a sus datos o eliminarlos, tienes 30 días para
        responder. Registra la solicitud para no perder el plazo de vista.
      </p>

      <div className="acciones-arco">
        <a className="boton-menor" href={`/api/dashboard/exportar/${customerId}`}>
          Descargar sus datos
        </a>

        <form action={recordPrivacyRequestAction}>
          <input type="hidden" name="customerId" value={customerId} />
          <input type="hidden" name="tipo" value="access" />
          <button type="submit" className="boton-menor">
            Registrar solicitud de acceso
          </button>
        </form>

        <form action={recordPrivacyRequestAction}>
          <input type="hidden" name="customerId" value={customerId} />
          <input type="hidden" name="tipo" value="deletion" />
          <button type="submit" className="boton-menor">
            Registrar solicitud de eliminación
          </button>
        </form>
      </div>

      <EraseForm customerId={customerId} tenantSlug={tenantSlug} />
    </>
  );
}
