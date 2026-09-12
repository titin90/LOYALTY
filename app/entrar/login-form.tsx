'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { login, type LoginState } from '@/lib/actions/auth';

const initialState: LoginState = { status: 'idle' };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="boton" type="submit" disabled={pending}>
      {pending ? 'Entrando…' : 'Entrar'}
    </button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState(login, initialState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} noValidate>
      <label className="campo">
        <span>Correo</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          enterKeyHint="next"
          required
          aria-invalid={errors.email !== undefined}
        />
        {errors.email && <p className="error">{errors.email}</p>}
      </label>

      <label className="campo">
        <span>Contraseña</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          enterKeyHint="done"
          required
          aria-invalid={errors.password !== undefined}
        />
        {errors.password && <p className="error">{errors.password}</p>}
      </label>

      <SubmitButton />

      {state.message && (
        <p className="error" role="alert" style={{ textAlign: 'center', marginTop: '0.75rem' }}>
          {state.message}
        </p>
      )}
    </form>
  );
}
