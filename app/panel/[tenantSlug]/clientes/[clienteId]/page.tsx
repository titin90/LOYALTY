import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/actions/auth';
import { exportarCliente } from '@/lib/panel/dsr';
import { formatChileanPhone } from '@/lib/domain/phone';
import { registrarSolicitudAccion } from '@/lib/actions/panel';
import { FormularioSupresion } from './supresion';

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
  params: Promise<{ tenantSlug: string; clienteId: string }>;
}) {
  const { tenantSlug, clienteId } = await params;
  const session = await requireSession();
  const datos = await exportarCliente(session.userId, clienteId);

  if (!datos) notFound();

  return (
    <>
      <h2 style={{ fontSize: '1.35rem', margin: '0 0 0.25rem' }}>{datos.titular.nombre}</h2>
      <p className="secundario" style={{ margin: 0 }}>
        {formatChileanPhone(datos.titular.telefono)} · cliente desde{' '}
        {new Date(datos.titular.clienteDesde).toLocaleDateString('es-CL', { dateStyle: 'medium' })}
      </p>

      <div className="tarjetas-metrica" style={{ marginTop: '1.5rem' }}>
        <div className="metrica">
          <p className="numero metrica-valor">{datos.tarjeta?.saldo ?? 0}</p>
          <p className="secundario metrica-etiqueta">Puntos</p>
        </div>
        <div className="metrica">
          <p className="numero metrica-valor">
            {datos.movimientos.filter((m) => m.tipo === 'earn').length}
          </p>
          <p className="secundario metrica-etiqueta">Visitas</p>
        </div>
        <div className="metrica">
          <p className="numero metrica-valor">{datos.canjes.length}</p>
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
            {datos.movimientos.map((m, i) => (
              <tr key={i}>
                <td className="secundario">
                  {new Date(m.fecha).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}
                </td>
                <td>{ETIQUETAS[m.tipo] ?? m.tipo}</td>
                <td className="num">{m.puntos > 0 ? `+${m.puntos}` : m.puntos}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="seccion-titulo">Derechos del titular</h2>
      <p className="secundario" style={{ marginTop: 0 }}>
        Si esta persona te pide acceder a sus datos o eliminarlos, tienes 30 días para
        responder. Registra la solicitud para no perder el plazo de vista.
      </p>

      <div className="acciones-arco">
        <a className="boton-menor" href={`/api/panel/exportar/${clienteId}`}>
          Descargar sus datos
        </a>

        <form action={registrarSolicitudAccion}>
          <input type="hidden" name="clienteId" value={clienteId} />
          <input type="hidden" name="tipo" value="access" />
          <button type="submit" className="boton-menor">
            Registrar solicitud de acceso
          </button>
        </form>

        <form action={registrarSolicitudAccion}>
          <input type="hidden" name="clienteId" value={clienteId} />
          <input type="hidden" name="tipo" value="deletion" />
          <button type="submit" className="boton-menor">
            Registrar solicitud de eliminación
          </button>
        </form>
      </div>

      <FormularioSupresion clienteId={clienteId} tenantSlug={tenantSlug} />
    </>
  );
}
