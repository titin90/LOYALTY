'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withUserSession } from '@/lib/db/client';
import { requireSession } from '@/lib/actions/auth';
import { cardDesignSchema } from '@/lib/wallet/design';
import { issueToken, deviceSecret } from '@/lib/device/token';
import { appUrl } from '@/lib/wallet/config';

export interface DashboardState {
  readonly status: 'idle' | 'ok' | 'error';
  readonly message?: string;
}

/**
 * Todas las escrituras del panel corren dentro de `withUserSession`: RLS impide
 * tocar filas de otro negocio aunque llegara un id ajeno en el formulario.
 */

const premioSchema = z.object({
  nombre: z.string().trim().min(2, 'Ponle un nombre al premio').max(60),
  umbral: z.coerce.number().int().min(1, 'El umbral debe ser 1 o más').max(1000),
});

export async function createReward(_previous: DashboardState, formData: FormData): Promise<DashboardState> {
  const session = await requireSession();
  const parsed = premioSchema.safeParse({
    nombre: formData.get('nombre'),
    umbral: formData.get('umbral'),
  });

  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Revisa los datos' };
  }

  await withUserSession(session.userId, (tx) =>
    tx.execute(
      sql`insert into rewards (tenant_id, name, threshold)
          values (${session.tenantId}::uuid, ${parsed.data.nombre}, ${parsed.data.umbral})`,
    ),
  );

  revalidatePath(`/dashboard/${session.tenantSlug}/listRewards`);
  return { status: 'ok', message: 'Reward creado.' };
}

export async function toggleReward(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get('id') ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;

  await withUserSession(session.userId, (tx) =>
    tx.execute(sql`update rewards set active = not active where id = ${id}::uuid`),
  );

  revalidatePath(`/dashboard/${session.tenantSlug}/listRewards`);
}

export async function saveCardDesign(_previous: DashboardState, formData: FormData): Promise<DashboardState> {
  const session = await requireSession();

  const parsed = cardDesignSchema.safeParse({
    background: formData.get('background'),
    foreground: formData.get('foreground'),
    label: formData.get('label'),
    unitLabel: formData.get('unitLabel'),
    logoText: String(formData.get('logoText') ?? '') || undefined,
  });

  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Revisa los colores' };
  }

  await withUserSession(session.userId, (tx) =>
    tx.execute(
      sql`insert into card_designs (tenant_id, version, config, published_at)
          values (
            ${session.tenantId}::uuid,
            coalesce((select max(version) from card_designs), 0) + 1,
            ${JSON.stringify(parsed.data)}::jsonb,
            now()
          )`,
    ),
  );

  revalidatePath(`/dashboard/${session.tenantSlug}/tarjeta`);
  return { status: 'ok', message: 'Diseño publicado. Las tarjetas se actualizarán solas.' };
}

export async function createDevice(_previous: DashboardState, formData: FormData): Promise<DashboardState> {
  const session = await requireSession();
  const nombre = String(formData.get('nombre') ?? '').trim() || 'Mostrador';

  const filas = await withUserSession(session.userId, async (tx) => {
    const result = (await tx.execute(
      sql`insert into devices (tenant_id, name)
          values (${session.tenantId}::uuid, ${nombre}) returning id`,
    )) as unknown as { id: string }[];
    return result;
  });

  const deviceId = filas[0]?.id;
  if (!deviceId) return { status: 'error', message: 'No se pudo crear el equipo.' };

  const token = issueToken(
    'pair',
    { tenantId: session.tenantId, deviceId, userId: session.userId },
    deviceSecret(),
  );

  revalidatePath(`/dashboard/${session.tenantSlug}/listDevices`);
  return {
    status: 'ok',
    message: `${appUrl()}/pair?t=${token}`,
  };
}

export async function revokeDevice(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get('id') ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;

  await withUserSession(session.userId, (tx) =>
    tx.execute(sql`update devices set revoked_at = now() where id = ${id}::uuid`),
  );

  revalidatePath(`/dashboard/${session.tenantSlug}/listDevices`);
}

const settingsSchema = z.object({
  pointsPerVisit: z.coerce.number().int().min(1).max(100),
  welcomeBonusPoints: z.coerce.number().int().min(0).max(100),
  referralBonusPoints: z.coerce.number().int().min(0).max(100),
  earnCooldownMinutes: z.coerce.number().int().min(0).max(10080),
  riskMultiplier: z.coerce.number().int().min(2).max(10),
  reviewPromptMinVisits: z.coerce.number().int().min(1).max(50),
  reviewPromptCooldownDays: z.coerce.number().int().min(7).max(365),
  // Vacío significa "no pedir reseñas": sin enlace el pase no lo muestra.
  googleReviewUrl: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === '' || /^https:\/\/\S+$/.test(v), 'Debe empezar con https://')
    .transform((v) => (v === '' ? null : v)),
});

export async function saveSettings(
  _previous: DashboardState,
  formData: FormData,
): Promise<DashboardState> {
  const session = await requireSession();

  const parsed = settingsSchema.safeParse({
    pointsPerVisit: formData.get('pointsPerVisit'),
    welcomeBonusPoints: formData.get('welcomeBonusPoints'),
    referralBonusPoints: formData.get('referralBonusPoints'),
    earnCooldownMinutes: formData.get('earnCooldownMinutes'),
    riskMultiplier: formData.get('riskMultiplier'),
    reviewPromptMinVisits: formData.get('reviewPromptMinVisits'),
    reviewPromptCooldownDays: formData.get('reviewPromptCooldownDays'),
    googleReviewUrl: formData.get('googleReviewUrl') ?? '',
  });

  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Revisa los valores' };
  }

  const v = parsed.data;

  await withUserSession(session.userId, (tx) =>
    tx.execute(
      sql`update tenant_settings set
            points_per_visit = ${v.pointsPerVisit},
            welcome_bonus_points = ${v.welcomeBonusPoints},
            referral_bonus_points = ${v.referralBonusPoints},
            earn_cooldown_minutes = ${v.earnCooldownMinutes},
            risk_multiplier = ${v.riskMultiplier},
            review_prompt_min_visits = ${v.reviewPromptMinVisits},
            review_prompt_cooldown_days = ${v.reviewPromptCooldownDays},
            google_review_url = ${v.googleReviewUrl}`,
    ),
  );

  revalidatePath(`/dashboard/${session.tenantSlug}/settings`);
  return { status: 'ok', message: 'Ajustes guardados.' };
}

/* ── Derechos ARCO (Ley 21.719) ─────────────────────────────────────────────
   El negocio es el responsable de los datos; estas acciones son la herramienta
   con la que responde a su cliente. Todo bajo RLS con su propia sesión. */

export async function eraseCustomerAction(
  _previous: DashboardState,
  formData: FormData,
): Promise<DashboardState> {
  const session = await requireSession();
  const id = String(formData.get('customerId') ?? '');
  const confirmacion = String(formData.get('confirmacion') ?? '').trim().toUpperCase();

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return { status: 'error', message: 'Cliente inválido.' };
  }

  // La supresión es irreversible: se exige escribirlo, no solo un clic.
  if (confirmacion !== 'SUPRIMIR') {
    return { status: 'error', message: 'Escribe SUPRIMIR para confirmar.' };
  }

  const { eraseCustomer } = await import('@/lib/dashboard/dsr');
  const resultado = await eraseCustomer(session.userId, id);

  if (!resultado.ok) return { status: 'error', message: 'No se encontró ese cliente.' };

  revalidatePath(`/dashboard/${session.tenantSlug}/clientes`);
  redirect(`/dashboard/${session.tenantSlug}/clientes?suprimido=1`);
}

export async function recordPrivacyRequestAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const customerId = String(formData.get('customerId') ?? '');
  const tipo = String(formData.get('tipo') ?? '');

  const tipos = ['access', 'rectification', 'deletion', 'objection', 'portability'] as const;
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) return;
  if (!tipos.includes(tipo as (typeof tipos)[number])) return;

  const { recordPrivacyRequest } = await import('@/lib/dashboard/dsr');
  await recordPrivacyRequest(session.userId, session.tenantId, customerId, tipo as (typeof tipos)[number]);

  revalidatePath(`/dashboard/${session.tenantSlug}/listPrivacyRequests`);
}

export async function resolvePrivacyRequestAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get('id') ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;

  const { resolvePrivacyRequest } = await import('@/lib/dashboard/dsr');
  await resolvePrivacyRequest(session.userId, id);

  revalidatePath(`/dashboard/${session.tenantSlug}/listPrivacyRequests`);
}
