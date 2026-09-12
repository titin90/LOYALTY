import { describe, it, expect } from 'vitest';
import { assessRisk, medianIntervalDays, shouldPromptReview } from '@/lib/domain/risk';

const d = (iso: string) => new Date(iso);

describe('medianIntervalDays', () => {
  it('null con menos de tres visitas: no hay cadencia confiable', () => {
    expect(medianIntervalDays([d('2026-01-01T00:00:00Z'), d('2026-01-15T00:00:00Z')])).toBeNull();
  });

  it('calcula la mediana de los intervalos', () => {
    const visits = [
      d('2026-01-01T00:00:00Z'),
      d('2026-01-15T00:00:00Z'),
      d('2026-01-29T00:00:00Z'),
      d('2026-02-12T00:00:00Z'),
    ];
    expect(medianIntervalDays(visits)).toBe(14);
  });

  it('una ausencia larga no arrastra la mediana como haría el promedio', () => {
    const visits = [
      d('2026-01-01T00:00:00Z'),
      d('2026-01-08T00:00:00Z'),
      d('2026-01-15T00:00:00Z'),
      d('2026-06-15T00:00:00Z'),
    ];
    expect(medianIntervalDays(visits)).toBeLessThan(20);
  });

  it('no depende del orden de entrada', () => {
    const a = [d('2026-01-29T00:00:00Z'), d('2026-01-01T00:00:00Z'), d('2026-01-15T00:00:00Z')];
    expect(medianIntervalDays(a)).toBe(14);
  });
});

describe('assessRisk', () => {
  const every14 = [
    d('2026-01-01T00:00:00Z'),
    d('2026-01-15T00:00:00Z'),
    d('2026-01-29T00:00:00Z'),
  ];

  it('marca en riesgo al superar su cadencia por el multiplicador', () => {
    const r = assessRisk(every14, 2, d('2026-03-05T00:00:00Z'));
    expect(r.atRisk).toBe(true);
    expect(r.reason).toBe('at_risk');
    expect(r.cadenceDays).toBe(14);
  });

  it('no marca a quien sigue dentro de su ritmo', () => {
    const r = assessRisk(every14, 2, d('2026-02-10T00:00:00Z'));
    expect(r.atRisk).toBe(false);
    expect(r.reason).toBe('on_schedule');
  });

  it('un cliente de cadencia larga no es riesgo solo por pasar 30 días', () => {
    const every60 = [
      d('2026-01-01T00:00:00Z'),
      d('2026-03-02T00:00:00Z'),
      d('2026-05-01T00:00:00Z'),
    ];
    expect(assessRisk(every60, 2, d('2026-06-01T00:00:00Z')).atRisk).toBe(false);
  });

  it('no molesta a clientes con menos de tres visitas', () => {
    const r = assessRisk([d('2026-01-01T00:00:00Z')], 2, d('2026-06-01T00:00:00Z'));
    expect(r.atRisk).toBe(false);
    expect(r.reason).toBe('too_few_visits');
  });

  it('sin visitas no hay riesgo que evaluar', () => {
    expect(assessRisk([], 2, d('2026-06-01T00:00:00Z')).reason).toBe('never_visited');
  });
});

describe('shouldPromptReview', () => {
  const now = d('2026-06-01T00:00:00Z');
  const base = {
    visitCount: 5,
    minVisits: 3,
    lastPromptAt: null,
    cooldownDays: 90,
    justRedeemed: false,
    now,
  };

  it('pide la primera reseña a partir de la visita mínima', () => {
    expect(shouldPromptReview(base)).toBe(true);
  });

  it('no pide antes de la visita mínima', () => {
    expect(shouldPromptReview({ ...base, visitCount: 2 })).toBe(false);
  });

  it('un canje habilita la solicitud aunque tenga pocas visitas', () => {
    expect(shouldPromptReview({ ...base, visitCount: 1, justRedeemed: true })).toBe(true);
  });

  it('respeta el tope de 90 días: no pedir en cada evento', () => {
    expect(shouldPromptReview({ ...base, lastPromptAt: d('2026-05-01T00:00:00Z') })).toBe(false);
  });

  it('vuelve a permitir pasada la ventana', () => {
    expect(shouldPromptReview({ ...base, lastPromptAt: d('2026-01-01T00:00:00Z') })).toBe(true);
  });
});
