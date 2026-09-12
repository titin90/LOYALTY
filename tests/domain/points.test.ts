import { describe, it, expect } from 'vitest';
import {
  computeBalance,
  nextReward,
  pointsToNextReward,
  redeemableRewards,
  canRedeem,
  checkEarnCooldown,
  type PointEvent,
  type Reward,
} from '@/lib/domain/points';

const at = (iso: string) => new Date(iso);
const ev = (delta: number, kind: PointEvent['kind'], iso = '2026-01-01T00:00:00Z'): PointEvent => ({
  delta,
  kind,
  createdAt: at(iso),
});

const reward = (id: string, threshold: number, active = true): Reward => ({
  id,
  name: `Premio ${id}`,
  threshold,
  active,
});

describe('computeBalance', () => {
  it('suma el ledger completo', () => {
    expect(
      computeBalance([ev(1, 'welcome_bonus'), ev(1, 'earn'), ev(2, 'referral'), ev(-3, 'redeem')]),
    ).toBe(1);
  });

  it('un ledger vacío vale cero', () => {
    expect(computeBalance([])).toBe(0);
  });

  it('los ajustes negativos restan', () => {
    expect(computeBalance([ev(5, 'earn'), ev(-2, 'adjust')])).toBe(3);
  });
});

describe('nextReward', () => {
  const rewards = [reward('a', 5), reward('b', 10), reward('c', 3, false)];

  it('elige el umbral activo más bajo por encima del saldo', () => {
    expect(nextReward(0, rewards)?.id).toBe('a');
    expect(nextReward(5, rewards)?.id).toBe('b');
  });

  it('ignora premios inactivos', () => {
    expect(nextReward(0, rewards)?.id).not.toBe('c');
  });

  it('devuelve null si ya superó todos los umbrales', () => {
    expect(nextReward(10, rewards)).toBeNull();
  });
});

describe('pointsToNextReward', () => {
  it('calcula lo que falta', () => {
    expect(pointsToNextReward(3, [reward('a', 10)])).toBe(7);
  });

  it('null cuando no queda premio por alcanzar', () => {
    expect(pointsToNextReward(10, [reward('a', 10)])).toBeNull();
  });
});

describe('redeemableRewards', () => {
  it('lista lo canjeable, del mayor al menor', () => {
    const got = redeemableRewards(10, [reward('a', 5), reward('b', 10), reward('c', 20)]);
    expect(got.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('excluye inactivos aunque alcance el saldo', () => {
    expect(redeemableRewards(10, [reward('a', 5, false)])).toEqual([]);
  });
});

describe('canRedeem', () => {
  it('permite exactamente en el umbral', () => {
    expect(canRedeem(10, reward('a', 10))).toBe(true);
  });

  it('rechaza un punto por debajo', () => {
    expect(canRedeem(9, reward('a', 10))).toBe(false);
  });

  it('rechaza premios inactivos', () => {
    expect(canRedeem(99, reward('a', 10, false))).toBe(false);
  });
});

describe('checkEarnCooldown', () => {
  const now = at('2026-01-01T12:00:00Z');

  it('permite la primera visita de la tarjeta', () => {
    expect(checkEarnCooldown(null, 240, now)).toEqual({ allowed: true, remainingMinutes: 0 });
  });

  it('bloquea dentro de la ventana e informa cuánto falta', () => {
    expect(checkEarnCooldown(at('2026-01-01T11:00:00Z'), 240, now)).toEqual({
      allowed: false,
      remainingMinutes: 180,
    });
  });

  it('permite justo al cumplirse la ventana', () => {
    expect(checkEarnCooldown(at('2026-01-01T08:00:00Z'), 240, now)).toEqual({
      allowed: true,
      remainingMinutes: 0,
    });
  });

  it('un cooldown de cero desactiva la restricción', () => {
    expect(checkEarnCooldown(at('2026-01-01T11:59:00Z'), 0, now).allowed).toBe(true);
  });
});
