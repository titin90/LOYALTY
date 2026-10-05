/**
 * Siembra una base de prueba con datos realistas.
 *
 * Para qué: probar el panel a mano con tablas llenas, mostrar el producto en una
 * demo de venta, y ver estados que con dos filas no aparecen — la lista de
 * clientes en riesgo, un cliente listo para canjear, el historial de alguien que
 * lleva un año viniendo.
 *
 *   pnpm seed
 *
 * Es DESTRUCTIVO: vacía las tablas antes de sembrar. Por eso se niega a correr
 * contra cualquier base que no parezca local.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { unsafeAdminDb } from '../lib/db/client';

const url = process.env.DATABASE_URL ?? '';
const esLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);

if (!esLocal && process.env.PERMITIR_SIEMBRA_REMOTA !== 'si') {
  console.error(
    'DATABASE_URL no apunta a una base local y la siembra BORRA todo.\n' +
      'Si de verdad es lo que quieres, exporta PERMITIR_SIEMBRA_REMOTA=si.',
  );
  process.exit(1);
}

const db = unsafeAdminDb('platform-job');

/** Generador determinista: la misma siembra produce siempre los mismos datos. */
let semilla = 20260912;
const aleatorio = (): number => {
  semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
  return semilla / 0x7fffffff;
};
const entre = (min: number, max: number): number => min + Math.floor(aleatorio() * (max - min + 1));
const alguno = <T>(items: readonly T[]): T => items[entre(0, items.length - 1)]!;

const NOMBRES = [
  'Ana', 'Camila', 'Javiera', 'Constanza', 'Valentina', 'Antonia', 'Isidora', 'Josefa',
  'Matías', 'Benjamín', 'Vicente', 'Martín', 'Agustín', 'Tomás', 'Diego', 'Joaquín',
  'Catalina', 'Fernanda', 'Emilia', 'Amanda', 'Sebastián', 'Cristóbal', 'Ignacio', 'Lucas',
];
const APELLIDOS = [
  'González', 'Muñoz', 'Rojas', 'Díaz', 'Pérez', 'Soto', 'Contreras', 'Silva',
  'Martínez', 'Sepúlveda', 'Morales', 'Rodríguez', 'López', 'Fuentes', 'Hernández', 'Torres',
];

interface PlantillaNegocio {
  slug: string;
  nombre: string;
  correo: string;
  pin: string;
  premio: string;
  umbral: number;
  unidad: string;
  fondo: string;
  acento: string;
  clientes: number;
}

const NEGOCIOS: PlantillaNegocio[] = [
  {
    slug: 'barberia-don-luis', nombre: 'Barbería Don Luis', correo: 'luis@ejemplo.cl',
    pin: '4321', premio: 'un corte gratis', umbral: 6, unidad: 'CORTES',
    fondo: '#171412', acento: '#B8955A', clientes: 38,
  },
  {
    slug: 'cafe-esquina', nombre: 'Café de la Esquina', correo: 'sofia@ejemplo.cl',
    pin: '1188', premio: 'un café grande', umbral: 10, unidad: 'CAFÉS',
    fondo: '#20303A', acento: '#C99A5B', clientes: 52,
  },
  {
    slug: 'nails-estudio', nombre: 'Nails Estudio', correo: 'pau@ejemplo.cl',
    pin: '7070', premio: '50% en tu manicure', umbral: 5, unidad: 'VISITAS',
    fondo: '#2B1B2A', acento: '#D8A0B6', clientes: 31,
  },
];

const CLAVE_DEMO = 'demo-clave-1234';

console.log('Vaciando las tablas…');
await db.execute(sql`truncate table tenants restart identity cascade`);

let telefonoBase = 911000000;

for (const plantilla of NEGOCIOS) {
  const [tenant] = (await db.execute(sql`
    insert into tenants (slug, name, plan) values (${plantilla.slug}, ${plantilla.nombre}, 'basic')
    returning id
  `)) as unknown as { id: string }[];
  const tenantId = tenant!.id;

  await db.execute(sql`
    insert into tenant_settings (tenant_id, welcome_bonus_points, referral_bonus_points,
                                 earn_cooldown_minutes, google_review_url)
    values (${tenantId}, 1, 2, 240, ${`https://g.page/r/${plantilla.slug}/review`})
  `);

  const [duenio] = (await db.execute(sql`
    insert into tenant_members (tenant_id, role, name, pin_hash, email, password_hash)
    values (${tenantId}, 'owner', 'Dueño', app.hash_pin(${plantilla.pin}),
            ${plantilla.correo}, app.hash_pin(${CLAVE_DEMO}))
    returning id, user_id
  `)) as unknown as { id: string; user_id: string }[];

  await db.execute(sql`
    insert into tenant_members (tenant_id, role, name, pin_hash)
    values (${tenantId}, 'staff', 'Ayudante', app.hash_pin('5555'))
  `);

  await db.execute(sql`insert into devices (tenant_id, name) values (${tenantId}, 'Mostrador')`);

  const [premio] = (await db.execute(sql`
    insert into rewards (tenant_id, name, threshold) values (${tenantId}, ${plantilla.premio}, ${plantilla.umbral})
    returning id
  `)) as unknown as { id: string }[];

  await db.execute(sql`
    insert into card_designs (tenant_id, version, config, published_at)
    values (${tenantId}, 1, ${JSON.stringify({
      background: plantilla.fondo,
      foreground: '#F5F1E8',
      label: plantilla.acento,
      unitLabel: plantilla.unidad,
      backTitle: 'Cómo funciona',
    })}::jsonb, now())
  `);

  let enRiesgo = 0;
  let listosParaCanjear = 0;

  for (let i = 0; i < plantilla.clientes; i += 1) {
    const nombre = `${alguno(NOMBRES)} ${alguno(APELLIDOS)}`;
    telefonoBase += entre(1, 900);
    const telefono = `+56${telefonoBase}`;

    // Cuatro perfiles, para que el panel muestre estados distintos de verdad.
    const perfil = i % 10 === 0 ? 'nuevo' : i % 7 === 0 ? 'riesgo' : i % 5 === 0 ? 'fiel' : 'normal';

    const cadencia = perfil === 'fiel' ? entre(7, 12) : entre(14, 30);
    const visitas =
      perfil === 'nuevo' ? entre(0, 1) : perfil === 'fiel' ? entre(8, 20) : entre(3, 9);
    const diasDesdeUltima =
      perfil === 'riesgo' ? cadencia * entre(3, 5) : entre(1, Math.max(cadencia - 2, 2));

    const antiguedad = diasDesdeUltima + cadencia * visitas + entre(0, 20);

    const [cliente] = (await db.execute(sql`
      insert into customers (tenant_id, name, phone_e164, created_at)
      values (${tenantId}, ${nombre}, ${telefono}, now() - make_interval(days => ${antiguedad}))
      returning id
    `)) as unknown as { id: string }[];

    await db.execute(sql`
      insert into consents (tenant_id, customer_id, purpose, version, granted_at)
      values (${tenantId}, ${cliente!.id}, 'loyalty', '2026-09-v1',
              now() - make_interval(days => ${antiguedad}))
    `);

    const serial = crypto.randomUUID().replace(/-/g, '');
    const [tarjeta] = (await db.execute(sql`
      insert into cards (tenant_id, customer_id, serial, created_at)
      values (${tenantId}, ${cliente!.id}, ${serial}, now() - make_interval(days => ${antiguedad}))
      returning id
    `)) as unknown as { id: string }[];

    await db.execute(sql`
      insert into point_events (tenant_id, card_id, delta, kind, idempotency_key, created_at)
      values (${tenantId}, ${tarjeta!.id}, 1, 'welcome_bonus', ${'w:' + tarjeta!.id},
              now() - make_interval(days => ${antiguedad}))
    `);

    for (let v = 0; v < visitas; v += 1) {
      const dias = diasDesdeUltima + cadencia * v;
      await db.execute(sql`
        insert into point_events (tenant_id, card_id, delta, kind, idempotency_key, created_at)
        values (${tenantId}, ${tarjeta!.id}, 1, 'earn', ${`e:${tarjeta!.id}:${v}`},
                now() - make_interval(days => ${dias}))
      `);
    }

    // Algunos ya canjearon: así la tabla de canjes no queda vacía.
    if (visitas >= plantilla.umbral && aleatorio() < 0.5) {
      const [evento] = (await db.execute(sql`
        insert into point_events (tenant_id, card_id, delta, kind, idempotency_key, created_at)
        values (${tenantId}, ${tarjeta!.id}, ${-plantilla.umbral}, 'redeem',
                ${`r:${tarjeta!.id}`}, now() - make_interval(days => ${entre(1, 30)}))
        returning id
      `)) as unknown as { id: string }[];

      await db.execute(sql`
        insert into redemptions (tenant_id, card_id, reward_id, staff_id, point_event_id)
        values (${tenantId}, ${tarjeta!.id}, ${premio!.id}, ${duenio!.id}, ${evento!.id})
      `);
    }

    if (perfil === 'riesgo' && visitas >= 3) enRiesgo += 1;

    const [saldo] = (await db.execute(sql`
      select points_balance from cards where id = ${tarjeta!.id}
    `)) as unknown as { points_balance: number }[];
    if (saldo!.points_balance >= plantilla.umbral) listosParaCanjear += 1;
  }

  // Una solicitud ARCO abierta, para ver la sección poblada.
  await db.execute(sql`
    insert into dsr_requests (tenant_id, customer_id, kind, due_at)
    select ${tenantId}, id, 'access', now() + interval '12 days'
    from customers where tenant_id = ${tenantId} limit 1
  `);

  console.log(
    `  ${plantilla.nombre.padEnd(22)} ${String(plantilla.clientes).padStart(3)} clientes · ` +
      `${enRiesgo} en riesgo · ${listosParaCanjear} listos para canjear`,
  );
}

console.log('\nListo. Entra al panel con cualquiera de estos:\n');
for (const n of NEGOCIOS) {
  console.log(`  ${n.correo.padEnd(20)} ${CLAVE_DEMO}   →  /dashboard/${n.slug}   (PIN del local: ${n.pin})`);
}
console.log('');
process.exit(0);
