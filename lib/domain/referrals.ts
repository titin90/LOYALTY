/**
 * Reglas del programa de referidos.
 *
 * Invariante del producto (CLAUDE.md regla 12): el bono al referente se paga con
 * el PRIMER `earn` real del referido, nunca por registrarse. Esa sola regla
 * elimina el abuso por cuentas falsas sin infraestructura antifraude.
 *
 * Modelo cerrado: monto fijo de puntos, configurable por negocio.
 */
export type ReferralStatus = 'pending' | 'paid' | 'void';

export interface ReferralDecisionInput {
  readonly referrerCustomerId: string;
  readonly referredCustomerId: string;
  readonly status: ReferralStatus;
  /** ¿Es este el primer evento `earn` de la tarjeta del referido? */
  readonly isFirstEarn: boolean;
  readonly bonusPoints: number;
}

export type ReferralDecision =
  | { pay: true; points: number }
  | { pay: false; reason: 'already_settled' | 'not_first_earn' | 'self_referral' | 'no_bonus' };

export function decideReferralPayout(input: ReferralDecisionInput): ReferralDecision {
  if (input.referrerCustomerId === input.referredCustomerId) {
    return { pay: false, reason: 'self_referral' };
  }
  if (input.status !== 'pending') {
    return { pay: false, reason: 'already_settled' };
  }
  if (!input.isFirstEarn) {
    return { pay: false, reason: 'not_first_earn' };
  }
  if (input.bonusPoints <= 0) {
    return { pay: false, reason: 'no_bonus' };
  }
  return { pay: true, points: input.bonusPoints };
}

/** Anti auto-referido por teléfono, antes de que exista el cliente en la base. */
export function isSelfReferral(referrerPhone: string, newCustomerPhone: string): boolean {
  return referrerPhone === newCustomerPhone;
}
