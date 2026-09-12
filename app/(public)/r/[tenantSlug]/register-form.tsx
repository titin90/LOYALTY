'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { registerCustomer, type RegisterState } from '@/lib/actions/register';
import { CONSENT_TEXT } from '@/lib/consent';

const initialState: RegisterState = { status: 'idle' };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="boton" type="submit" disabled={pending}>
      {pending ? 'Creando tu tarjeta…' : 'Crear mi tarjeta'}
    </button>
  );
}

export function RegisterForm({ tenantSlug }: { tenantSlug: string }) {
  const [state, formAction] = useActionState(registerCustomer, initialState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />

      <label className="campo">
        <span>Tu nombre</span>
        <input
          name="name"
          type="text"
          autoComplete="given-name"
          enterKeyHint="next"
          required
          aria-invalid={errors.name !== undefined}
        />
        {errors.name && <p className="error">{errors.name}</p>}
      </label>

      <label className="campo">
        <span>Tu celular</span>
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+56 9 1234 5678"
          enterKeyHint="next"
          required
          aria-invalid={errors.phone !== undefined}
        />
        {errors.phone && <p className="error">{errors.phone}</p>}
      </label>

      <label className="campo">
        <span>
          ¿Te invitó alguien? <span style={{ color: 'var(--texto-secundario)' }}>(opcional)</span>
        </span>
        <input
          name="referralCode"
          type="tel"
          inputMode="tel"
          placeholder="Su celular"
          enterKeyHint="done"
        />
      </label>

      <label className="consentimiento">
        <input name="consent" type="checkbox" required />
        <span>{CONSENT_TEXT}</span>
      </label>
      {errors.consent && <p className="error" style={{ marginTop: '-0.75rem' }}>{errors.consent}</p>}

      <SubmitButton />

      {state.message && (
        <p className="error" role="alert" style={{ textAlign: 'center', marginTop: '0.75rem' }}>
          {state.message}
        </p>
      )}
    </form>
  );
}
