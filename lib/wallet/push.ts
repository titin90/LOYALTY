/**
 * Avisa a las wallets de que una tarjeta cambió.
 *
 * Es el canal de retención del producto: sin aplicación instalada y sin costo de
 * SMS, el cliente ve "Ahora tienes 4 visitas" en su pantalla bloqueada.
 *
 * Nunca interrumpe un marcaje: si el aviso falla, la visita ya quedó registrada
 * y el pase se pondrá al día la próxima vez que el teléfono consulte.
 */
import { sql } from 'drizzle-orm';
import { unsafeAdminDb } from '@/lib/db/client';
import { pushPassUpdate, type ApnsConfig } from '@/lib/wallet/apple/apns';
import { appleConfig, googleConfig } from '@/lib/wallet/config';
import { accessToken } from '@/lib/wallet/google/jwt';
import { passPayload } from '@/lib/wallet/issue';
import { progressText } from '@/lib/wallet/apple/pass';
import { parseCardDesign } from '@/lib/wallet/design';

function apnsConfig(): ApnsConfig | null {
  const apple = appleConfig();
  const keyP8 = process.env.APPLE_APNS_KEY_P8_BASE64;
  const keyId = process.env.APPLE_APNS_KEY_ID;

  if (!apple || !keyP8 || !keyId) return null;

  return {
    keyP8: Buffer.from(keyP8, 'base64').toString('utf8'),
    keyId,
    teamId: apple.teamIdentifier,
    topic: apple.passTypeIdentifier,
  };
}

async function pushApple(cardId: string): Promise<void> {
  const config = apnsConfig();
  if (!config) return;

  const db = unsafeAdminDb('platform-job');
  const targets = (await db.execute(
    sql`select push_token, pass_id from app.apple_push_targets(${cardId}::uuid)`,
  )) as unknown as { push_token: string; pass_id: string }[];

  for (const target of targets) {
    const result = await pushPassUpdate(target.push_token, config);

    if (result.ok) {
      await db.execute(sql`select app.mark_pass_pushed(${target.pass_id}::uuid)`);
    } else if (result.gone) {
      // El teléfono ya no tiene el pase: su registro solo acumularía envíos muertos.
      await db.execute(
        sql`delete from public.apple_registrations where push_token = ${target.push_token}`,
      );
    }
  }
}

async function pushGoogle(serial: string): Promise<void> {
  const config = googleConfig();
  if (!config) return;

  const payload = await passPayload(serial);
  if (!payload) return;

  const db = unsafeAdminDb('platform-job');
  const rows = (await db.execute(
    sql`select p.external_id from public.wallet_passes p
        join public.cards c on c.id = p.card_id
        where c.serial = ${serial} and p.platform = 'google'`,
  )) as unknown as { external_id: string }[];

  const objectId = rows[0]?.external_id;
  if (!objectId) return;

  const design = parseCardDesign(payload.design);

  const response = await fetch(
    `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${encodeURIComponent(objectId)}`,
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${await accessToken(config.account)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        loyaltyPoints: { label: design.unitLabel, balance: { int: payload.balance } },
        textModulesData: [
          {
            id: 'progreso',
            header: 'PRÓXIMO PREMIO',
            body: progressText(payload.points_to_next, payload.reward_name),
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    console.error('[wallet] Google rechazó la actualización', { status: response.status });
  }
}

/**
 * Empuja la actualización a ambas plataformas. No lanza nunca: el marcaje ya
 * ocurrió y un fallo del aviso no puede deshacerlo ni bloquear al que escanea.
 */
export async function pushCardUpdate(cardId: string, serial: string): Promise<void> {
  await Promise.allSettled([pushApple(cardId), pushGoogle(serial)]);
}
