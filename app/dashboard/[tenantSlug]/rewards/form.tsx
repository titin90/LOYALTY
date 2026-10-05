'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createReward, type DashboardState } from '@/lib/actions/dashboard';

const initialState: DashboardState = { status: 'idle' };

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button className="boton" type="submit" disabled={pending}>
      {pending ? 'Guardando…' : 'Agregar premio'}
    </button>
  );
}

export function RewardForm() {
  const [state, formAction] = useActionState(createReward, initialState);

  return (
    <form action={formAction} className="formulario-estrecho">
      <label className="campo">
        <span>Nombre del premio</span>
        <input name="nombre" type="text" placeholder="un corte gratis" required />
      </label>

      <label className="campo">
        <span>Visitas necesarias</span>
        <input name="umbral" type="number" min={1} max={1000} defaultValue={5} required />
      </label>

      <Boton />

      {state.message && (
        <p className={state.status === 'error' ? 'error' : 'exito'} role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}
