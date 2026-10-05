'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { saveCardDesign, type DashboardState } from '@/lib/actions/dashboard';
import type { CardDesign } from '@/lib/wallet/design';

const initialState: DashboardState = { status: 'idle' };

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn" type="submit" disabled={pending}>
      {pending ? 'Publicando…' : 'Publicar diseño'}
    </button>
  );
}

export function CardEditor({
  inicial,
  business,
  reward,
  threshold,
}: {
  inicial: CardDesign;
  business: string;
  reward: string | null;
  threshold: number | null;
}) {
  const [state, formAction] = useActionState(saveCardDesign, initialState);
  const [diseno, setDiseno] = useState(inicial);

  const actualizar = (campo: keyof CardDesign, valor: string) =>
    setDiseno((actual) => ({ ...actual, [campo]: valor }));

  const saldoEjemplo = 3;
  const faltan = threshold === null ? null : Math.max(threshold - saldoEjemplo, 0);

  return (
    <div className="editor">
      <div className="preview">
        {/* Vista previa: la misma estructura de campos que lleva el pase real. */}
        <div
          className="pass"
          style={{ background: diseno.background, color: diseno.foreground }}
        >
          <p className="pass-logo" style={{ color: diseno.label }}>
            {diseno.logoText || business}
          </p>

          <div className="pass-row">
            <span className="pass-unit" style={{ color: diseno.label }}>
              {diseno.unitLabel}
            </span>
            <span className="numero pass-n">{saldoEjemplo}</span>
          </div>

          <div className="pass-code" aria-hidden />

          <p className="pass-unit" style={{ color: diseno.label }}>
            PRÓXIMO PREMIO
          </p>
          <p className="pass-next">
            {reward === null
              ? 'Sigue sumando visitas'
              : faltan === 0
                ? `¡Ya puedes canjear ${reward}!`
                : `Te ${faltan === 1 ? 'falta' : 'faltan'} ${faltan} ${faltan === 1 ? 'visita' : 'visitas'} para ${reward}`}
          </p>
        </div>
      </div>

      <form action={formAction} className="editor-fields form-narrow">
        <label className="field">
          <span>Texto del logo</span>
          <input
            name="logoText"
            type="text"
            maxLength={40}
            value={diseno.logoText ?? ''}
            placeholder={business}
            onChange={(e) => actualizar('logoText', e.target.value)}
          />
        </label>

        <label className="field">
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

        <Color etiqueta="Fondo" name="background" valor={diseno.background} onChange={actualizar} />
        <Color etiqueta="Texto" name="foreground" valor={diseno.foreground} onChange={actualizar} />
        <Color etiqueta="Acento" name="label" valor={diseno.label} onChange={actualizar} />

        <p className="soft" style={{ fontSize: '0.8125rem' }}>
          El acento se usa en etiquetas y bordes. Cubrir la tarjeta entera de dorado es lo
          que la hace ver recargada.
        </p>

        <Boton />

        {state.message && (
          <p className={state.status === 'error' ? 'msg-error' : 'exito'} role="status">
            {state.message}
          </p>
        )}
      </form>
    </div>
  );
}

function Color({
  etiqueta,
  name,
  valor,
  onChange,
}: {
  etiqueta: string;
  name: keyof CardDesign;
  valor: string;
  onChange: (campo: keyof CardDesign, valor: string) => void;
}) {
  return (
    <label className="field field-color">
      <span>{etiqueta}</span>
      <span className="color-row">
        <input
          type="color"
          value={valor}
          onChange={(e) => onChange(name, e.target.value)}
          aria-label={`${etiqueta}: selector de color`}
        />
        <input
          name={name}
          type="text"
          value={valor}
          pattern="#[0-9a-fA-F]{6}"
          onChange={(e) => onChange(name, e.target.value)}
          required
        />
      </span>
    </label>
  );
}
