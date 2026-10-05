'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { registerCard } from '@/lib/registration';

export interface RegisterState {
  readonly status: 'idle' | 'error';
  readonly message?: string;
  readonly fieldErrors?: Record<string, string>;
}

/** El serial ES la credencial de la tarjeta: viaja en cookie httpOnly, nunca en
 *  la URL, donde quedaría en el historial del teléfono y en logs de servidor. */
const CARD_COOKIE = 'card_serial';

export async function registerCustomer(
  _previous: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const slug = String(formData.get('tenantSlug') ?? '');

  const outcome = await registerCard({
    tenantSlug: slug,
    name: String(formData.get('name') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    referralCode: String(formData.get('referralCode') ?? '') || undefined,
    consent: formData.get('consent') === 'on',
  });

  if (!outcome.ok) {
    return outcome.kind === 'validation'
      ? { status: 'error', fieldErrors: outcome.fieldErrors }
      : { status: 'error', message: outcome.message };
  }

  const store = await cookies();
  store.set(CARD_COOKIE, `${slug}:${outcome.serial}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60, // una hora: solo para completar la entrega de la tarjeta
  });

  redirect(`/join/${slug}/done`);
}

export async function readCardCookie(tenantSlug: string): Promise<{ serial: string } | null> {
  const store = await cookies();
  const raw = store.get(CARD_COOKIE)?.value;
  if (!raw) return null;

  const separator = raw.indexOf(':');
  if (separator === -1) return null;

  const slug = raw.slice(0, separator);
  const serial = raw.slice(separator + 1);
  return slug === tenantSlug && serial !== '' ? { serial } : null;
}
