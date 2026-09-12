/**
 * Lógica de puntos. Funciones puras: sin red, sin base de datos.
 *
 * El saldo real lo mantiene un trigger en Postgres; esto es la misma aritmética
 * del lado de la aplicación, para calcular progreso y validar antes de escribir.
 */
export type PointEventKind =
  | 'earn'
  | 'redeem'
  | 'welcome_bonus'
  | 'referral'
  | 'adjust'
  | 'expire';

export interface PointEvent {
  readonly delta: number;
  readonly kind: PointEventKind;
  readonly createdAt: Date;
}

export interface Reward {
  readonly id: string;
  readonly name: string;
  readonly threshold: number;
  readonly active: boolean;
}

export function computeBalance(events: readonly PointEvent[]): number {
  return events.reduce((total, e) => total + e.delta, 0);
}

/** El próximo premio alcanzable: el umbral activo más bajo por encima del saldo. */
export function nextReward(balance: number, rewards: readonly Reward[]): Reward | null {
  return rewards
    .filter((r) => r.active && r.threshold > balance)
    .reduce<Reward | null>(
      (best, r) => (best === null || r.threshold < best.threshold ? r : best),
      null,
    );
}

export function pointsToNextReward(balance: number, rewards: readonly Reward[]): number | null {
  const next = nextReward(balance, rewards);
  return next === null ? null : next.threshold - balance;
}

/** Premios que el cliente ya puede canjear ahora mismo. */
export function redeemableRewards(balance: number, rewards: readonly Reward[]): Reward[] {
  return rewards
    .filter((r) => r.active && r.threshold <= balance)
    .sort((a, b) => b.threshold - a.threshold);
}

export function canRedeem(balance: number, reward: Reward): boolean {
  return reward.active && balance >= reward.threshold;
}

export interface CooldownCheck {
  readonly allowed: boolean;
  /** Minutos que faltan para poder volver a sumar. 0 si ya se puede. */
  readonly remainingMinutes: number;
}

/**
 * Antifraude mínimo: una tarjeta no puede sumar dos visitas dentro de la ventana
 * configurada por el negocio. Se valida también en la base de datos; esto permite
 * dar un mensaje útil en el escáner antes de intentar el insert.
 */
export function checkEarnCooldown(
  lastEarnAt: Date | null,
  cooldownMinutes: number,
  now: Date,
): CooldownCheck {
  if (lastEarnAt === null || cooldownMinutes <= 0) {
    return { allowed: true, remainingMinutes: 0 };
  }

  const elapsedMs = now.getTime() - lastEarnAt.getTime();
  const remainingMs = cooldownMinutes * 60_000 - elapsedMs;

  return remainingMs <= 0
    ? { allowed: true, remainingMinutes: 0 }
    : { allowed: false, remainingMinutes: Math.ceil(remainingMs / 60_000) };
}
