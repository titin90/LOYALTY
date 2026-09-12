/**
 * Aplica las migraciones pendientes. Solo hacia adelante (CLAUDE.md regla 7).
 * No hay `down`: revertir es escribir una migración nueva.
 */
import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL no está definida. Copia .env.example a .env.');
  process.exit(1);
}

if (/supabase\.co|amazonaws|\.prod\./.test(url) && process.env.ALLOW_REMOTE_MIGRATE !== 'yes') {
  console.error(
    'DATABASE_URL apunta a una base remota. Exporta ALLOW_REMOTE_MIGRATE=yes si es intencional.',
  );
  process.exit(1);
}

const client = postgres(url, { max: 1, prepare: false });

await migrate(drizzle(client), { migrationsFolder: './drizzle/migrations' });
console.log('Migraciones aplicadas.');
await client.end();
