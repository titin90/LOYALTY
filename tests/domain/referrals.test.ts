import { describe, it, expect } from 'vitest';
import { decideReferralPayout, isSelfReferral } from '@/lib/domain/referrals';

const base = {
  referrerCustomerId: 'ana',
  referredCustomerId: 'beto',
  status: 'pending' as const,
  isFirstEarn: true,
  bonusPoints: 2,
};

describe('decideReferralPayout', () => {
  it('paga en el primer earn real del referido', () => {
    expect(decideReferralPayout(base)).toEqual({ pay: true, points: 2 });
  });

  it('NO paga por registrarse: hace falta una visita escaneada', () => {
    expect(decideReferralPayout({ ...base, isFirstEarn: false })).toEqual({
      pay: false,
      reason: 'not_first_earn',
    });
  });

  it('no paga dos veces el mismo referido', () => {
    expect(decideReferralPayout({ ...base, status: 'paid' })).toEqual({
      pay: false,
      reason: 'already_settled',
    });
  });

  it('no paga referidos anulados', () => {
    expect(decideReferralPayout({ ...base, status: 'void' }).pay).toBe(false);
  });

  it('rechaza el auto-referido', () => {
    expect(decideReferralPayout({ ...base, referredCustomerId: 'ana' })).toEqual({
      pay: false,
      reason: 'self_referral',
    });
  });

  it('no genera eventos con bono en cero', () => {
    expect(decideReferralPayout({ ...base, bonusPoints: 0 })).toEqual({
      pay: false,
      reason: 'no_bonus',
    });
  });
});

describe('isSelfReferral', () => {
  it('detecta el mismo teléfono', () => {
    expect(isSelfReferral('+56912345678', '+56912345678')).toBe(true);
    expect(isSelfReferral('+56912345678', '+56987654321')).toBe(false);
  });
});
