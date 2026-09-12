'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { signIn } from '@/lib/auth/login';
import {
  issueSession,
  verifySession,
  sessionSecret,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  type MemberSession,
} from '@/lib/auth/session';

export interface LoginState {
  readonly status: 'idle' | 'error';
  readonly message?: string;
  readonly fieldErrors?: Record<string, string>;
}

export async function currentSession(): Promise<MemberSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verifySession(token, sessionSecret()) : null;
}

/** Sesión obligatoria: redirige a la entrada si no hay. */
export async function requireSession(): Promise<MemberSession> {
  const session = await currentSession();
  if (!session) redirect('/entrar');
  return session;
}

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const outcome = await signIn({
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
  });

  if (!outcome.ok) {
    return outcome.kind === 'validation'
      ? { status: 'error', fieldErrors: outcome.fieldErrors }
      : { status: 'error', message: outcome.message };
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, issueSession(outcome.session, sessionSecret()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });

  redirect(`/panel/${outcome.session.tenantSlug}`);
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/entrar');
}
