import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireSession, logout } from '@/lib/actions/auth';

export const dynamic = 'force-dynamic';

const SECTIONS = [
  { href: '', label: 'Resumen' },
  { href: '/customers', label: 'Clientes' },
  { href: '/at-risk', label: 'En riesgo' },
  { href: '/rewards', label: 'Premios' },
  { href: '/card', label: 'Tarjeta' },
  { href: '/devices', label: 'Equipos' },
  { href: '/privacy-requests', label: 'Datos personales' },
];

export default async function DashboardLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const session = await requireSession();

  // La sesión lleva su propio negocio: entrar al panel de otro no es cuestión de
  // cambiar la URL. Aun si se colara, RLS no devolvería ninguna fila.
  if (session.tenantSlug !== tenantSlug) notFound();

  const base = `/dashboard/${tenantSlug}`;

  return (
    <div className="shell">
      <aside className="side">
        <div className="side-head">
          <p className="side-name">{session.tenantSlug}</p>
        </div>

        <nav className="side-nav" aria-label="Secciones">
          {SECTIONS.map((s) => (
            <Link key={s.href} href={`${base}${s.href}`}>
              {s.label}
            </Link>
          ))}
        </nav>

        <div className="side-foot">
          <p className="side-who">{session.name}</p>
          <form action={logout}>
            <button type="submit" className="signout">
              Salir
            </button>
          </form>
        </div>
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}
