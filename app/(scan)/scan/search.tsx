'use client';

import { useState } from 'react';
import { searchCustomers } from '@/lib/actions/scan';
import type { FoundCustomer } from '@/lib/scanning';

/**
 * Respaldo del escáner: el cliente olvidó el teléfono, borró el pase o la cámara
 * no lee. Sin esto, el encargado se queda sin salida y deja de marcar — que es
 * exactamente como muere el producto.
 */
export function Buscador({
  obtenerPin,
  onElegir,
  onCerrar,
}: {
  /** La búsqueda exige PIN igual que marcar: expone nombres de clientes. */
  obtenerPin: () => string | null;
  onElegir: (serial: string) => void;
  onCerrar: () => void;
}) {
  const [consulta, setConsulta] = useState('');
  const [resultados, setResultados] = useState<FoundCustomer[] | null>(null);
  const [buscando, setBuscando] = useState(false);

  const buscar = async (valor: string) => {
    setConsulta(valor);
    const digitos = valor.replace(/\D/g, '');

    if (digitos.length < 4) {
      setResultados(null);
      return;
    }

    const pin = obtenerPin();
    if (pin === null) {
      setResultados([]);
      return;
    }

    setBuscando(true);
    try {
      setResultados(await searchCustomers(valor, pin));
    } finally {
      setBuscando(false);
    }
  };

  return (
    <div className="scan-sheet scan-sheet--solid scan-sheet--top">
      <p style={{ margin: 0, fontWeight: 600 }}>Buscar por teléfono</p>
      <p className="soft" style={{ margin: '0.25rem 0 1rem', fontSize: '0.8125rem' }}>
        Escribe al menos los últimos 4 dígitos.
      </p>

      <input
        className="scan-input"
        type="tel"
        inputMode="numeric"
        autoComplete="off"
        value={consulta}
        onChange={(e) => void buscar(e.target.value)}
        placeholder="1234"
        aria-label="Últimos dígitos del teléfono"
        autoFocus
      />

      <div className="scan-results">
        {buscando && <p className="soft">Buscando…</p>}

        {!buscando && resultados !== null && resultados.length === 0 && (
          <p className="soft">Ningún cliente con esos dígitos.</p>
        )}

        {!buscando &&
          resultados?.map((customer) => (
            <button
              key={customer.serial}
              type="button"
              className="scan-result"
              onClick={() => onElegir(customer.serial)}
            >
              <span>
                <strong>{customer.name}</strong>
                <span className="soft"> {customer.phoneSuffix}</span>
              </span>
              <span className="numero">{customer.balance}</span>
            </button>
          ))}
      </div>

      <button type="button" className="scan-btn scan-btn--quiet" onClick={onCerrar}>
        Volver a la cámara
      </button>
    </div>
  );
}
