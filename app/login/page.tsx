import { redirect } from 'next/navigation';
import { currentSession } from '@/lib/actions/auth';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function EntrarPage() {
  const session = await currentSession();
  if (session) redirect(`/dashboard/${session.tenantSlug}`);

  return (
    <main className="screen">
      <div className="sheet card-object">
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Entrar</h1>
        <p className="soft" style={{ marginTop: '0.35rem' }}>
          Panel de tu negocio.
        </p>
        <hr className="rule-gold" />
        <LoginForm />
      </div>
    </main>
  );
}
