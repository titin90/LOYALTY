'use client';

import { useState } from 'react';
import { buscarCliente } from '@/lib/actions/scan';
import type { ClienteEncontrado } from '@/lib/scanning';

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
  const [resultados, setResultados] = useState<ClienteEncontrado[] | null>(null);
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
      setResultados(await buscarCliente(valor, pin));
    } finally {
      setBuscando(false);
    }
  };

  return (
    <div className="escaner-overlay escaner-overlay--solido escaner-overlay--arriba">
      <p style={{ margin: 0, fontWeight: 600 }}>Buscar por teléfono</p>
      <p className="secundario" style={{ margin: '0.25rem 0 1rem', fontSize: '0.8125rem' }}>
        Escribe al menos los últimos 4 dígitos.
      </p>

      <input
        className="buscador-escaner"
        type="tel"
        inputMode="numeric"
        autoComplete="off"
        value={consulta}
        onChange={(e) => void buscar(e.target.value)}
        placeholder="1234"
        aria-label="Últimos dígitos del teléfono"
        autoFocus
      />

      <div className="buscador-resultados">
        {buscando && <p className="secundario">Buscando…</p>}

        {!buscando && resultados !== null && resultados.length === 0 && (
          <p className="secundario">Ningún cliente con esos dígitos.</p>
        )}

        {!buscando &&
          resultados?.map((cliente) => (
            <button
              key={cliente.serial}
              type="button"
              className="buscador-resultado"
              onClick={() => onElegir(cliente.serial)}
            >
              <span>
                <strong>{cliente.nombre}</strong>
                <span className="secundario"> {cliente.telefonoParcial}</span>
              </span>
              <span className="numero">{cliente.saldo}</span>
            </button>
          ))}
      </div>

      <button type="button" className="boton-escaner boton-escaner--tenue" onClick={onCerrar}>
        Volver a la cámara
      </button>
    </div>
  );
}
