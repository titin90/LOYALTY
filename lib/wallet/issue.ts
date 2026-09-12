/**
 * Emisión de pases: del serial de una tarjeta al archivo que guarda el cliente.
 *
 * Los datos salen de `app.pass_payload`, que devuelve solo lo que un pase
 * necesita y nunca el teléfono del cliente.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withAnonSession, unsafeAdminDb } from '@/lib/db/client';
import { parseCardDesign } from '@/lib/wallet/design';
import { buildPassJson, progressText } from '@/lib/wallet/apple/pass';
import { buildPkPass } from '@/lib/wallet/apple/pkpass';
import { solidPng } from '@/lib/wallet/apple/png';
import { buildLoyaltyObject } from '@/lib/wallet/google/objects';
import { signSaveJwt, saveUrl } from '@/lib/wallet/google/jwt';
import { appleConfig, googleConfig, appUrl } from '@/lib/wallet/config';

export interface PassPayload {
  serial: string;
  card_id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  customer_name: string;
  balance: number;
  reward_name: string | null;
  points_to_next: number | null;
  design: unknown;
  apple_pass_id: string | null;
}

export async function passPayload(
  serial: string,
  authToken?: string,
): Promise<PassPayload | null> {
  const rows = await withAnonSession(async (tx) => {
    const result = (await tx.execute<{ [k: string]: unknown; r: PassPayload | null }>(
      sql`select app.pass_payload(${serial}, ${authToken ?? null}) as r`,
    )) as unknown as { r: PassPayload | null }[];
    return result;
  });

  return rows[0]?.r ?? null;
}

/**
 * Genera el `.pkpass` y registra el pase con su token de autenticación, que es
 * lo que autoriza al web service de Apple a pedir actualizaciones.
 */
export async function issueApplePass(payload: PassPayload): Promise<Uint8Array | null> {
  const config = appleConfig();
  if (!config) return null;

  const design = parseCardDesign(payload.design);
  const authenticationToken = randomBytes(24).toString('base64url');

  const passJson = buildPassJson({
    serial: payload.serial,
    authenticationToken,
    organizationName: payload.tenant_name,
    customerName: payload.customer_name,
    balance: payload.balance,
    pointsToNextReward: payload.points_to_next,
    rewardName: payload.reward_name,
    design,
    passTypeIdentifier: config.passTypeIdentifier,
    teamIdentifier: config.teamIdentifier,
    webServiceUrl: `${appUrl()}/api/v1`,
  });

  const icon = solidPng(29, design.background);

  const pkpass = buildPkPass(
    {
      'pass.json': Uint8Array.from(Buffer.from(JSON.stringify(passJson), 'utf8')),
      'icon.png': icon,
      'icon@2x.png': solidPng(58, design.background),
      'logo.png': solidPng(50, design.background),
    },
    config.certificates,
  );

  await unsafeAdminDb('platform-job').execute(
    sql`select app.register_wallet_pass(${payload.card_id}::uuid, 'apple',
                                        ${payload.serial}, ${authenticationToken})`,
  );

  return pkpass;
}

export async function googleSaveUrl(payload: PassPayload): Promise<string | null> {
  const config = googleConfig();
  if (!config) return null;

  const design = parseCardDesign(payload.design);

  const object = buildLoyaltyObject({
    issuerId: config.issuerId,
    tenantSlug: payload.tenant_slug,
    serial: payload.serial,
    customerName: payload.customer_name,
    balance: payload.balance,
    progressText: progressText(payload.points_to_next, payload.reward_name),
    design,
  });

  await unsafeAdminDb('platform-job').execute(
    sql`select app.register_wallet_pass(${payload.card_id}::uuid, 'google',
                                        ${String(object.id)}, ${null})`,
  );

  return saveUrl(await signSaveJwt(config.account, object, [appUrl()]));
}
