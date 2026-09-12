'use client';

import { useEffect } from 'react';
import type { ScanOutcome } from '@/lib/scanning';

/** Cuánto se muestra el resultado antes de volver a la cámara sola. */
const AUTOCIERRE_MS = 3500;

export function Resultado({
  outcome,
  onCerrar,
}: {
  outcome: ScanOutcome;
  onCerrar: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onCerrar, AUTOCIERRE_MS);
    return () => window.clearTimeout(timer);
  }, [onCerrar]);

  if (!outcome.ok) {
    return (
      <button type="button" className="escaner-overlay escaner-overlay--solido" onClick={onCerrar}>
        <p className="resultado-titulo" style={{ color: 'var(--error)' }}>
          {outcome.message}
        </p>
        <p className="secundario">Toca para continuar</p>
      </button>
    );
  }

  const { customerName, earned, balance, pointsToNextReward, duplicate } = outcome.result;

  return (
    <button type="button" className="escaner-overlay escaner-overlay--solido" onClick={onCerrar}>
      <p className="secundario" style={{ margin: 0 }}>
        {duplicate ? 'Ya estaba marcada' : '¡Visita marcada!'}
      </p>
      <p className="resultado-titulo">{customerName}</p>

      <p className="numero resultado-puntos">
        {balance}
        <span className="secundario" style={{ fontSize: '1rem', fontWeight: 400 }}>
          {balance === 1 ? ' punto' : ' puntos'}
        </span>
      </p>

      {!duplicate && earned > 0 && (
        <p className="secundario" style={{ margin: 0 }}>
          +{earned} en esta visita
        </p>
      )}

      <hr className="regla-dorada" style={{ margin: '1.25rem auto' }} />

      <p className="secundario" style={{ margin: 0 }}>
        {pointsToNextReward === null
          ? '¡Ya puede canjear su premio!'
          : `Le ${pointsToNextReward === 1 ? 'falta' : 'faltan'} ${pointsToNextReward} para el premio`}
      </p>
    </button>
  );
}
