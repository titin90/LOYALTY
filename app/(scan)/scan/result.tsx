'use client';

import { useEffect, useState } from 'react';
import { submitRedeem } from '@/lib/actions/scan';
import type { ScanOutcome, RedeemableReward } from '@/lib/scanning';

/** Cuánto se muestra el resultado antes de volver a la cámara sola. */
const AUTOCIERRE_MS = 3500;

export function Resultado({
  outcome,
  serial,
  obtenerPin,
  onCerrar,
}: {
  outcome: ScanOutcome;
  serial: string;
  /** Getter y no valor: el PIN vive en un ref y leerlo durante el render no es
   *  seguro en React. Se consulta dentro del manejador del toque. */
  obtenerPin: () => string | null;
  onCerrar: () => void;
}) {
  const [canjeando, setCanjeando] = useState<string | null>(null);
  const [canjeado, setCanjeado] = useState<string | null>(null);
  const [errorCanje, setErrorCanje] = useState<string | null>(null);

  const hayPremios = outcome.ok && outcome.result.redeemable.length > 0;
  // Con un premio por cobrar el cierre no puede ser automático: el encargado
  // tiene que decidir, y 3 segundos no alcanzan.
  const autocierre = !hayPremios && canjeado === null;

  useEffect(() => {
    if (!autocierre) return;
    const timer = window.setTimeout(onCerrar, AUTOCIERRE_MS);
    return () => window.clearTimeout(timer);
  }, [autocierre, onCerrar]);

  const canjear = async (reward: RedeemableReward) => {
    const pin = obtenerPin();
    if (pin === null || canjeando !== null) return;

    setCanjeando(reward.id);
    setErrorCanje(null);

    try {
      const resultado = await submitRedeem(serial, reward.id, pin, crypto.randomUUID());
      if (resultado.ok) {
        setCanjeado(reward.name);
      } else {
        setErrorCanje(resultado.message);
      }
    } catch {
      setErrorCanje('Sin conexión. El canje no se registró: vuelve a intentarlo.');
    } finally {
      setCanjeando(null);
    }
  };

  if (!outcome.ok) {
    return (
      <div className="scan-sheet scan-sheet--solid">
        <p className="scan-title" style={{ color: 'var(--error)' }}>
          {outcome.message}
        </p>
        <button type="button" className="scan-btn" onClick={onCerrar}>
          Continuar
        </button>
      </div>
    );
  }

  const { customerName, earned, balance, pointsToNextReward, duplicate, redeemable } = outcome.result;

  if (canjeado !== null) {
    return (
      <div className="scan-sheet scan-sheet--solid">
        <p className="soft" style={{ margin: 0 }}>
          Canje registrado
        </p>
        <p className="scan-title">{canjeado}</p>
        <p className="soft">Entrégale su reward a {customerName}.</p>
        <button type="button" className="scan-btn" onClick={onCerrar}>
          Listo
        </button>
      </div>
    );
  }

  return (
    <div className="scan-sheet scan-sheet--solid">
      <p className="soft" style={{ margin: 0 }}>
        {duplicate ? 'Ya estaba marcada' : '¡Visita marcada!'}
      </p>
      <p className="scan-title">{customerName}</p>

      <p className="numero scan-n">
        {balance}
        <span className="soft" style={{ fontSize: '1rem', fontWeight: 400 }}>
          {balance === 1 ? ' punto' : ' puntos'}
        </span>
      </p>

      {!duplicate && earned > 0 && (
        <p className="soft" style={{ margin: 0 }}>
          +{earned} en esta visita
        </p>
      )}

      <hr className="rule-gold" style={{ margin: '1.25rem auto' }} />

      {redeemable.length > 0 ? (
        <>
          <p style={{ margin: 0, fontWeight: 600 }}>
            {redeemable.length === 1 ? 'Puede canjear:' : 'Puede canjear:'}
          </p>
          <div className="redeem-list">
            {redeemable.map((reward) => (
              <button
                key={reward.id}
                type="button"
                className="redeem-btn"
                disabled={canjeando !== null}
                onClick={() => void canjear(reward)}
              >
                {canjeando === reward.id ? 'Canjeando…' : `${reward.name} · ${reward.threshold} pts`}
              </button>
            ))}
          </div>
          {errorCanje && (
            <p className="msg-error" role="alert">
              {errorCanje}
            </p>
          )}
          <button type="button" className="scan-btn scan-btn--quiet" onClick={onCerrar}>
            Ahora no
          </button>
        </>
      ) : (
        <p className="soft" style={{ margin: 0 }}>
          {pointsToNextReward === null
            ? 'Sigue sumando visitas'
            : `Le ${pointsToNextReward === 1 ? 'falta' : 'faltan'} ${pointsToNextReward} para el premio`}
        </p>
      )}
    </div>
  );
}
