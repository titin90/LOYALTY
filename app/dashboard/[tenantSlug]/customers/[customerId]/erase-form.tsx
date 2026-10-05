'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { eraseCustomerAction, type DashboardState } from '@/lib/actions/dashboard';

const initialState: DashboardState = { status: 'idle' };

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-alert" disabled={pending}>
      {pending ? 'Suprimiendo…' : 'Suprimir definitivamente'}
    </button>
  );
}

export function EraseForm({
  customerId,
}: {
  customerId: string;
  tenantSlug: string;
}) {
  const [state, formAction] = useActionState(eraseCustomerAction, initialState);
  const [abierto, setAbierto] = useState(false);

  if (!abierto) {
    return (
      <p style={{ marginTop: '2rem' }}>
        <button type="button" className="link-alert" onClick={() => setAbierto(true)}>
          Suprimir los datos de esta persona
        </button>
      </p>
    );
  }

  return (
    <form action={formAction} className="danger">
      <p style={{ margin: 0, fontWeight: 600 }}>Suprimir los datos de esta persona</p>
      <p className="soft" style={{ marginTop: '0.4rem' }}>
        Se borran su nombre, su teléfono y sus consentimientos, y no se pueden recuperar.
        Su tarjeta queda cerrada. Las visitas y canjes se conservan para la contabilidad
        del negocio, ya sin ninguna referencia a la persona.
      </p>

      <input type="hidden" name="customerId" value={customerId} />

      <label className="field" style={{ maxWidth: '18rem' }}>
        <span>Escribe SUPRIMIR para confirmar</span>
        <input name="confirmacion" type="text" autoComplete="off" required />
      </label>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <Boton />
        <button type="button" className="btn-quiet" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      </div>

      {state.message && (
        <p className="msg-error" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
