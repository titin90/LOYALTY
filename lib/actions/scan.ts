'use server';

import { cookies } from 'next/headers';
import { verifyDeviceToken, deviceSecret, type DeviceClaims } from '@/lib/device/token';
import { recordScan, redeemReward, type ScanOutcome, type RedeemOutcome } from '@/lib/scanning';

const DEVICE_COOKIE = 'device_token';

/** Credenciales del equipo, o null si no está emparejado o su token ya no vale. */
export async function currentDevice(): Promise<DeviceClaims | null> {
  const token = (await cookies()).get(DEVICE_COOKIE)?.value;
  if (!token) return null;

  const result = verifyDeviceToken(token, 'device', deviceSecret());
  return result.ok ? result.claims : null;
}

export async function submitScan(
  serial: string,
  pin: string,
  idempotencyKey: string,
): Promise<ScanOutcome> {
  const claims = await currentDevice();
  if (!claims) {
    return { ok: false, failure: 'device_revoked', message: 'Este equipo no está emparejado.' };
  }
  return recordScan({ serial, pin, claims, idempotencyKey });
}

export async function submitRedeem(
  serial: string,
  rewardId: string,
  pin: string,
  idempotencyKey: string,
): Promise<RedeemOutcome> {
  const claims = await currentDevice();
  if (!claims) {
    return { ok: false, failure: 'device_revoked', message: 'Este equipo no está emparejado.' };
  }
  return redeemReward({ serial, rewardId, pin, claims, idempotencyKey });
}
