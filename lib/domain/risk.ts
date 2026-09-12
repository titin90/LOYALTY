/**
 * Detección de clientes en riesgo para el win-back.
 *
 * Se compara a cada cliente contra SU PROPIA cadencia, no contra un promedio del
 * local: un cliente que viene cada 45 días no está en riesgo a los 30, y uno que
 * viene cada 15 sí lo está. Se usa la mediana de los intervalos porque una sola
 * ausencia larga no debe arrastrar el promedio.
 */
export interface RiskAssessment {
  readonly atRisk: boolean;
  readonly cadenceDays: number | null;
  readonly daysSinceLastVisit: number | null;
  readonly reason: 'at_risk' | 'on_schedule' | 'too_few_visits' | 'never_visited';
}

const DAY_MS = 86_400_000;

export function medianIntervalDays(visits: readonly Date[]): number | null {
  if (visits.length < 3) return null;

  const sorted = [...visits].sort((a, b) => a.getTime() - b.getTime());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    gaps.push((sorted[i]!.getTime() - sorted[i - 1]!.getTime()) / DAY_MS);
  }

  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 0 ? (gaps[mid - 1]! + gaps[mid]!) / 2 : gaps[mid]!;
}

export function assessRisk(
  visits: readonly Date[],
  multiplier: number,
  now: Date,
): RiskAssessment {
  if (visits.length === 0) {
    return { atRisk: false, cadenceDays: null, daysSinceLastVisit: null, reason: 'never_visited' };
  }

  const last = visits.reduce((a, b) => (a.getTime() > b.getTime() ? a : b));
  const daysSince = (now.getTime() - last.getTime()) / DAY_MS;
  const cadence = medianIntervalDays(visits);

  // Con menos de 3 visitas no hay cadencia propia confiable: no se molesta al cliente.
  if (cadence === null) {
    return {
      atRisk: false,
      cadenceDays: null,
      daysSinceLastVisit: daysSince,
      reason: 'too_few_visits',
    };
  }

  const atRisk = daysSince > cadence * multiplier;
  return {
    atRisk,
    cadenceDays: cadence,
    daysSinceLastVisit: daysSince,
    reason: atRisk ? 'at_risk' : 'on_schedule',
  };
}

/**
 * Tope de solicitudes de reseña: una cada N días por cliente, y solo a partir de
 * la visita N. Pedirla en cada evento parece review farming y arriesga la ficha
 * de Google del negocio (CLAUDE.md regla 11).
 */
export function shouldPromptReview(params: {
  readonly visitCount: number;
  readonly minVisits: number;
  readonly lastPromptAt: Date | null;
  readonly cooldownDays: number;
  readonly justRedeemed: boolean;
  readonly now: Date;
}): boolean {
  const { visitCount, minVisits, lastPromptAt, cooldownDays, justRedeemed, now } = params;

  if (!justRedeemed && visitCount < minVisits) return false;
  if (lastPromptAt === null) return true;

  return now.getTime() - lastPromptAt.getTime() >= cooldownDays * DAY_MS;
}
