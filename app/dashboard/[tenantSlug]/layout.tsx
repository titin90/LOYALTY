import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireSession, logout } from '@/lib/actions/auth';

export const dynamic = 'force-dynamic';

const SECCIONES = [
  { href: '', etiqueta: 'DashboardSummary' },
  { href: '/clientes', etiqueta: 'Clientes' },
  { href: '/riesgo', etiqueta: 'En riesgo' },
  { href: '/premios', etiqueta: 'Premios' },
  { href: '/tarjeta', etiqueta: 'Tarjeta' },
  { href: '/equipos', etiqueta: 'Equipos' },
  { href: '/solicitudes', etiqueta: 'Solicitudes' },
];

export default async function PanelLayout({
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
    <div className="panel">
      <header className="panel-cabecera">
        <div>
          <p className="panel-negocio">{session.tenantSlug}</p>
          <p className="secundario panel-quien">{session.name}</p>
        </div>
        <form action={logout}>
          <button type="submit" className="panel-salir">
            Salir
          </button>
        </form>
      </header>

      <nav className="panel-nav">
        {SECCIONES.map((s) => (
          <Link key={s.href} href={`${base}${s.href}`}>
            {s.etiqueta}
          </Link>
        ))}
      </nav>

      <div className="panel-contenido">{children}</div>
    </div>
  );
}
