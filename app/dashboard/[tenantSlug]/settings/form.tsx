'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { saveSettings, type DashboardState } from '@/lib/actions/dashboard';
import type { TenantSettings } from '@/lib/dashboard/queries';

const initialState: DashboardState = { status: 'idle' };

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn" type="submit" disabled={pending}>
      {pending ? 'Guardando…' : 'Guardar ajustes'}
    </button>
  );
}

export function SettingsForm({ settings }: { settings: TenantSettings }) {
  const [state, formAction] = useActionState(saveSettings, initialState);

  return (
    <form action={formAction} className="form-narrow">
      <section className="section">
        <h2>Puntos</h2>

        <Number
          name="pointsPerVisit"
          label="Puntos por visita"
          hint="Lo que suma cada escaneo."
          value={settings.pointsPerVisit}
          min={1}
          max={100}
        />
        <Number
          name="welcomeBonusPoints"
          label="Bono de bienvenida"
          hint="Se aplica al registrarse. Nunca dejes a alguien viendo un cero."
          value={settings.welcomeBonusPoints}
          min={0}
          max={100}
        />
        <Number
          name="referralBonusPoints"
          label="Bono por traer un amigo"
          hint="Se paga cuando el amigo hace su primera visita real, no al registrarse."
          value={settings.referralBonusPoints}
          min={0}
          max={100}
        />
        <Number
          name="earnCooldownMinutes"
          label="Espera entre visitas, en minutos"
          hint="Evita que una misma tarjeta sume dos veces seguidas. 240 son cuatro horas."
          value={settings.earnCooldownMinutes}
          min={0}
          max={10080}
        />
      </section>

      <section className="section">
        <h2>Clientes en riesgo</h2>

        <Number
          name="riskMultiplier"
          label="Cuántas veces su ritmo"
          hint="Con 2, alguien que viene cada 15 días aparece en riesgo a los 30."
          value={settings.riskMultiplier}
          min={2}
          max={10}
        />
      </section>

      <section className="section">
        <h2>Reseñas de Google</h2>

        <label className="field">
          <span>Enlace para dejar reseña</span>
          <input
            id="googleReviewUrl"
            name="googleReviewUrl"
            type="url"
            inputMode="url"
            placeholder="https://g.page/r/..."
            defaultValue={settings.googleReviewUrl ?? ''}
          />
          <span className="faint">
            Déjalo vacío para no pedir reseñas. Búscalo en tu ficha de Google Business,
            en «Pedir reseñas».
          </span>
        </label>

        <Number
          name="reviewPromptMinVisits"
          label="Pedirla a partir de la visita"
          hint="Antes de eso no se pide, salvo que acabe de canjear un premio."
          value={settings.reviewPromptMinVisits}
          min={1}
          max={50}
        />
        <Number
          name="reviewPromptCooldownDays"
          label="No volver a pedirla en, días"
          hint="Pedirla en cada visita parece compra de reseñas y arriesga tu ficha."
          value={settings.reviewPromptCooldownDays}
          min={7}
          max={365}
        />

        <p className="faint">
          El enlace aparece en la tarjeta del cliente, dentro de su wallet. Nunca se
          ofrecen puntos a cambio: Google lo prohíbe y puede costarte la ficha completa.
        </p>
      </section>

      <SaveButton />

      {state.message && (
        <p className={state.status === 'error' ? 'msg-error' : 'msg-ok'} role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}

function Number({
  name,
  label,
  hint,
  value,
  min,
  max,
}: {
  name: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input id={name} name={name} type="number" defaultValue={value} min={min} max={max} required />
      <span className="faint">{hint}</span>
    </label>
  );
}
