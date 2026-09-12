/**
 * Marcador de posición de la Fase 0. La Fase 1 reemplaza esto por el registro
 * del cliente, el panel del negocio y la PWA del escáner.
 */
export default function Home() {
  return (
    <main style={{ padding: '3rem 1.5rem', maxWidth: '38rem', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0 }}>Fidelización</h1>
      <p style={{ color: 'var(--texto-secundario)', lineHeight: 1.6 }}>
        Fase 0 — fundaciones. Esquema, aislamiento por negocio y CI en su lugar.
      </p>
      <hr style={{ border: 0, borderTop: `2px solid var(--acento)`, width: '3rem', margin: '2rem 0 0' }} />
    </main>
  );
}
