/**
 * Genera un enlace de emparejamiento para el equipo de un local.
 *
 * Provisional: en la Fase 2 este botón vive en el panel del dueño. Hasta
 * entonces se emite desde aquí, que es una operación de plataforma.
 *
 *   pnpm tsx scripts/pair-device.ts <slug-del-negocio> [nombre del equipo]
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { unsafeAdminDb } from '../lib/db/client';
import { issueToken, deviceSecret, PAIR_TOKEN_TTL_SECONDS } from '../lib/device/token';

const [slug, nombre = 'Mostrador'] = process.argv.slice(2);

if (!slug) {
  console.error('Uso: pnpm tsx scripts/pair-device.ts <slug-del-negocio> [nombre del equipo]');
  process.exit(1);
}

const db = unsafeAdminDb('platform-job');

const rows = (await db.execute(
  sql`select t.id as tenant_id,
             (select m.user_id from tenant_members m
               where m.tenant_id = t.id and m.active order by m.created_at limit 1) as user_id
      from tenants t where t.slug = ${slug}`,
)) as unknown as { tenant_id: string; user_id: string | null }[];

const tenant = rows[0];
if (!tenant) {
  console.error(`No existe el negocio "${slug}".`);
  process.exit(1);
}
if (!tenant.user_id) {
  console.error(`El negocio "${slug}" no tiene ningún miembro activo.`);
  process.exit(1);
}

const created = (await db.execute(
  sql`insert into devices (tenant_id, name) values (${tenant.tenant_id}, ${nombre}) returning id`,
)) as unknown as { id: string }[];

const deviceId = created[0]!.id;
const token = issueToken(
  'pair',
  { tenantId: tenant.tenant_id, deviceId, userId: tenant.user_id },
  deviceSecret(),
);

const base = process.env.APP_URL ?? 'http://localhost:3000';
console.log(`\nEquipo "${nombre}" creado para ${slug}.`);
console.log(`Abre este enlace EN EL TELÉFONO DEL LOCAL (vence en ${PAIR_TOKEN_TTL_SECONDS / 60} minutos):\n`);
console.log(`  ${base}/emparejar?t=${token}\n`);
process.exit(0);
