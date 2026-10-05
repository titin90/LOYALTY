/**
 * Marcas de tarjeta perforada.
 *
 * Una tarjeta de fidelización fue siempre un cartón al que se le hacen hoyos, y
 * ese es el instrumento del rubro. Dibujar el progreso con marcas en vez de con
 * una barra se lee de un vistazo desde el otro lado del mostrador, que es la
 * distancia real de uso.
 *
 * Con umbrales grandes se cae a un número: veinte marcas ya no se cuentan.
 */
const MAX_MARCAS = 12;

export function Punches({
  balance,
  threshold,
}: {
  balance: number;
  threshold: number | null;
}) {
  if (threshold === null || threshold > MAX_MARCAS) {
    return (
      <span className="numero" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {balance}
        {threshold !== null && <span className="faint"> / {threshold}</span>}
      </span>
    );
  }

  const llenas = Math.min(balance, threshold);
  const listo = balance >= threshold;

  return (
    <span
      className={listo ? 'punches punches--ready' : 'punches'}
      role="img"
      aria-label={`${balance} de ${threshold} visitas`}
    >
      {Array.from({ length: threshold }, (_, i) => (
        <span key={i} className={i < llenas ? 'punch punch--filled' : 'punch'} />
      ))}
    </span>
  );
}
