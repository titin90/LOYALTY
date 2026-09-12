import { sql } from 'drizzle-orm';
import { withAnonSession } from './client';

export interface PublicReward {
  readonly id: string;
  readonly name: string;
  readonly threshold: number;
}

export interface PublicTenant {
  readonly slug: string;
  readonly name: string;
  readonly welcomeBonusPoints: number;
  readonly rewards: readonly PublicReward[];
}

interface TenantPublicRow {
  [key: string]: unknown;
  slug: string;
  name: string;
  welcome_bonus_points: number;
  rewards: PublicReward[];
}

/**
 * Datos públicos del negocio para la página de registro. Lee `tenant_public`,
 * la vista acotada a información que ya es pública (ver migración 0002).
 */
export async function getPublicTenant(slug: string): Promise<PublicTenant | null> {
  const rows = await withAnonSession(async (tx) => {
    const result = await tx.execute<TenantPublicRow>(
      sql`select slug, name, welcome_bonus_points, rewards
          from public.tenant_public where slug = ${slug}`,
    );
    return result as unknown as TenantPublicRow[];
  });

  const row = rows[0];
  if (!row) return null;

  return {
    slug: row.slug,
    name: row.name,
    welcomeBonusPoints: row.welcome_bonus_points,
    rewards: row.rewards,
  };
}
