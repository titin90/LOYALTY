'use server';

import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withUserSession } from '@/lib/db/client';
import { requireSession } from '@/lib/actions/auth';
import { cardDesignSchema } from '@/lib/wallet/design';
import { issueToken, deviceSecret } from '@/lib/device/token';
import { appUrl } from '@/lib/wallet/config';

export interface PanelState {
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

export async function crearPremio(_previous: PanelState, formData: FormData): Promise<PanelState> {
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

  revalidatePath(`/panel/${session.tenantSlug}/premios`);
  return { status: 'ok', message: 'Premio creado.' };
}

export async function alternarPremio(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get('id') ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;

  await withUserSession(session.userId, (tx) =>
    tx.execute(sql`update rewards set active = not active where id = ${id}::uuid`),
  );

  revalidatePath(`/panel/${session.tenantSlug}/premios`);
}

export async function guardarDiseno(_previous: PanelState, formData: FormData): Promise<PanelState> {
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

  revalidatePath(`/panel/${session.tenantSlug}/tarjeta`);
  return { status: 'ok', message: 'Diseño publicado. Las tarjetas se actualizarán solas.' };
}

export async function crearEquipo(_previous: PanelState, formData: FormData): Promise<PanelState> {
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

  revalidatePath(`/panel/${session.tenantSlug}/equipos`);
  return {
    status: 'ok',
    message: `${appUrl()}/emparejar?t=${token}`,
  };
}

export async function revocarEquipo(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get('id') ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;

  await withUserSession(session.userId, (tx) =>
    tx.execute(sql`update devices set revoked_at = now() where id = ${id}::uuid`),
  );

  revalidatePath(`/panel/${session.tenantSlug}/equipos`);
}
