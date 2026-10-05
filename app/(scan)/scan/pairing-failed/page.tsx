const MOTIVOS: Record<string, string> = {
  falta: 'El enlace viene incompleto.',
  vencido: 'Este enlace de emparejamiento ya venció. Pide uno nuevo.',
  invalido: 'Este enlace de emparejamiento no es válido.',
};

export default async function EmparejamientoFallido({
  searchParams,
}: {
  searchParams: Promise<{ motivo?: string }>;
}) {
  const { motivo } = await searchParams;

  return (
    <main className="screen">
      <div className="sheet card-object" style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.3rem', margin: 0 }}>No se pudo emparejar</h1>
        <hr className="rule-gold" style={{ margin: '1.25rem auto' }} />
        <p className="soft">{MOTIVOS[motivo ?? ''] ?? MOTIVOS.invalido}</p>
      </div>
    </main>
  );
}
