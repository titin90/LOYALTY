import { currentDevice } from '@/lib/actions/scan';
import { Scanner } from './scanner';

export const dynamic = 'force-dynamic';

export default async function ScanPage() {
  const device = await currentDevice();

  if (!device) {
    return (
      <main className="pantalla">
        <div className="tarjeta" style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.3rem', margin: 0 }}>Device sin emparejar</h1>
          <hr className="regla-dorada" style={{ margin: '1.25rem auto' }} />
          <p className="secundario">
            Pide el enlace de emparejamiento y ábrelo en este mismo teléfono.
          </p>
        </div>
      </main>
    );
  }

  return <Scanner />;
}
