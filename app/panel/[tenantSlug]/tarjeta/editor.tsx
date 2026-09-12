'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { guardarDiseno, type PanelState } from '@/lib/actions/panel';
import type { CardDesign } from '@/lib/wallet/design';

const initialState: PanelState = { status: 'idle' };

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button className="boton" type="submit" disabled={pending}>
      {pending ? 'Publicando…' : 'Publicar diseño'}
    </button>
  );
}

export function EditorTarjeta({
  inicial,
  negocio,
  premio,
  umbral,
}: {
  inicial: CardDesign;
  negocio: string;
  premio: string | null;
  umbral: number | null;
}) {
  const [state, formAction] = useActionState(guardarDiseno, initialState);
  const [diseno, setDiseno] = useState(inicial);

  const actualizar = (campo: keyof CardDesign, valor: string) =>
    setDiseno((actual) => ({ ...actual, [campo]: valor }));

  const saldoEjemplo = 3;
  const faltan = umbral === null ? null : Math.max(umbral - saldoEjemplo, 0);

  return (
    <div className="editor-tarjeta">
      <div className="editor-vista">
        {/* Vista previa: la misma estructura de campos que lleva el pase real. */}
        <div
          className="pase"
          style={{ background: diseno.background, color: diseno.foreground }}
        >
          <p className="pase-logo" style={{ color: diseno.label }}>
            {diseno.logoText || negocio}
          </p>

          <div className="pase-cabecera">
            <span className="pase-etiqueta" style={{ color: diseno.label }}>
              {diseno.unitLabel}
            </span>
            <span className="numero pase-valor">{saldoEjemplo}</span>
          </div>

          <div className="pase-qr" aria-hidden />

          <p className="pase-etiqueta" style={{ color: diseno.label }}>
            PRÓXIMO PREMIO
          </p>
          <p className="pase-progreso">
            {premio === null
              ? 'Sigue sumando visitas'
              : faltan === 0
                ? `¡Ya puedes canjear ${premio}!`
                : `Te ${faltan === 1 ? 'falta' : 'faltan'} ${faltan} ${faltan === 1 ? 'visita' : 'visitas'} para ${premio}`}
          </p>
        </div>
      </div>

      <form action={formAction} className="editor-campos">
        <label className="campo">
          <span>Texto del logo</span>
          <input
            name="logoText"
            type="text"
            maxLength={40}
            value={diseno.logoText ?? ''}
            placeholder={negocio}
            onChange={(e) => actualizar('logoText', e.target.value)}
          />
        </label>

        <label className="campo">
          <span>Qué acumulan tus clientes</span>
          <input
            name="unitLabel"
            type="text"
            maxLength={16}
            value={diseno.unitLabel}
            onChange={(e) => actualizar('unitLabel', e.target.value.toUpperCase())}
            required
          />
        </label>

        <Color etiqueta="Fondo" nombre="background" valor={diseno.background} onChange={actualizar} />
        <Color etiqueta="Texto" nombre="foreground" valor={diseno.foreground} onChange={actualizar} />
        <Color etiqueta="Acento" nombre="label" valor={diseno.label} onChange={actualizar} />

        <p className="secundario" style={{ fontSize: '0.8125rem' }}>
          El acento se usa en etiquetas y bordes. Cubrir la tarjeta entera de dorado es lo
          que la hace ver recargada.
        </p>

        <Boton />

        {state.message && (
          <p className={state.status === 'error' ? 'error' : 'exito'} role="status">
            {state.message}
          </p>
        )}
      </form>
    </div>
  );
}

function Color({
  etiqueta,
  nombre,
  valor,
  onChange,
}: {
  etiqueta: string;
  nombre: keyof CardDesign;
  valor: string;
  onChange: (campo: keyof CardDesign, valor: string) => void;
}) {
  return (
    <label className="campo campo-color">
      <span>{etiqueta}</span>
      <span className="campo-color-fila">
        <input
          type="color"
          value={valor}
          onChange={(e) => onChange(nombre, e.target.value)}
          aria-label={`${etiqueta}: selector de color`}
        />
        <input
          name={nombre}
          type="text"
          value={valor}
          pattern="#[0-9a-fA-F]{6}"
          onChange={(e) => onChange(nombre, e.target.value)}
          required
        />
      </span>
    </label>
  );
}
