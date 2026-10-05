import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/actions/auth';
import { tenantSettings } from '@/lib/dashboard/queries';
import { SettingsForm } from './form';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await requireSession();
  const settings = await tenantSettings(session.userId);

  if (!settings) notFound();

  return (
    <>
      <header>
        <h1>Ajustes</h1>
        <p>
          Cómo funciona tu programa. Los cambios valen desde el próximo marcaje; las
          visitas ya registradas no se recalculan.
        </p>
      </header>

      <SettingsForm settings={settings} />
    </>
  );
}
