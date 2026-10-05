'use client';

import { useState } from 'react';

/**
 * PIN del empleado. Se pide una vez por turno y se guarda solo en memoria: el
 * ≤2 toques manda, pero el PIN no puede quedar persistido en el teléfono del
 * mostrador, que es compartido.
 */
export function PinPad({ onListo }: { onListo: (pin: string) => void }) {
  const [pin, setPin] = useState('');

  const escribir = (digito: string) => {
    const siguiente = (pin + digito).slice(0, 4);
    setPin(siguiente);
    if (siguiente.length === 4) {
      // Autoenvía al cuarto dígito: un toque menos.
      setTimeout(() => {
        onListo(siguiente);
        setPin('');
      }, 120);
    }
  };

  return (
    <div className="scan-sheet scan-sheet--solid">
      <p className="soft" style={{ margin: 0 }}>
        Tu PIN
      </p>

      <div className="pin-dots" aria-label={`${pin.length} de 4 dígitos`}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={i < pin.length ? 'pin-dot pin-dot--on' : 'pin-dot'} />
        ))}
      </div>

      <div className="pin-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" onClick={() => escribir(d)}>
            {d}
          </button>
        ))}
        <span />
        <button type="button" onClick={() => escribir('0')}>
          0
        </button>
        <button type="button" onClick={() => setPin(pin.slice(0, -1))} aria-label="Borrar">
          ←
        </button>
      </div>
    </div>
  );
}
