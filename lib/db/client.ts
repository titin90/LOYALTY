/**
 * Única puerta de acceso a la base de datos.
 *
 * El eslint del repo prohíbe importar `postgres` fuera de este archivo: una
 * conexión suelta se salta el control de tenant y anula toda la arquitectura de
 * aislamiento.
 *
 * Modelo: la aplicación se conecta como el rol `authenticated` y publica el JWT
 * del usuario en el GUC `request.jwt.claims` dentro de la transacción. A partir de
 * ahí es Postgres, vía RLS, quien decide qué filas existen — no el código.
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import * as schema from './schema';

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL no está definida');
  return url;
}

const client = postgres(connectionString(), {
  max: Number(process.env.DB_POOL_MAX ?? 10),
  prepare: false, // requerido detrás del pooler de Supabase
});

const root = drizzle(client, { schema, casing: 'snake_case' });

export type Database = typeof root;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Ejecuta `fn` bajo la identidad del usuario: rol `authenticated` + claims del JWT.
 * Todas las políticas RLS aplican dentro. Es la forma normal de leer y escribir.
 */
export async function withUserSession<T>(
  userId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return root.transaction(async (tx) => {
    await tx.execute(sql`select set_config('role', 'authenticated', true)`);
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId })}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Ejecuta `fn` sin usuario: rol `anon`. No ve ninguna fila — solo sirve para
 * invocar las funciones `app.*` de la superficie pública (registro, pases Apple).
 */
export async function withAnonSession<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return root.transaction(async (tx) => {
    await tx.execute(sql`select set_config('role', 'anon', true)`);
    return fn(tx);
  });
}

/**
 * Conexión sin RLS. Solo para migraciones, jobs de plataforma y la suite de
 * aislamiento. Nunca en código que atienda una petición de usuario
 * (CLAUDE.md regla 3).
 */
export function unsafeAdminDb(reason: 'migration' | 'platform-job' | 'test'): Database {
  if (process.env.NODE_ENV === 'production' && reason === 'test') {
    throw new Error('unsafeAdminDb("test") no puede usarse en producción');
  }
  return root;
}

export { schema };
