'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createDevice, type DashboardState } from '@/lib/actions/dashboard';

const initialState: DashboardState = { status: 'idle' };

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button className="boton" type="submit" disabled={pending}>
      {pending ? 'Creando…' : 'Crear enlace de emparejamiento'}
    </button>
  );
}

export function DeviceForm() {
  const [state, formAction] = useActionState(createDevice, initialState);

  return (
    <form action={formAction} className="formulario-estrecho">
      <label className="campo">
        <span>Nombre del equipo</span>
        <input name="nombre" type="text" placeholder="Mostrador" />
      </label>

      <Boton />

      {state.status === 'ok' && state.message && (
        <div className="enlace-emparejar" role="status">
          <p className="secundario" style={{ margin: 0 }}>
            Abre este enlace <strong>en el teléfono del local</strong>. Vence en 15 minutos.
          </p>
          <code>{state.message}</code>
        </div>
      )}

      {state.status === 'error' && state.message && (
        <p className="error" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
