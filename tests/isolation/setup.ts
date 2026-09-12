import { hasDatabase } from './helpers';

if (!hasDatabase) {
  throw new Error(
    [
      '',
      'La suite de aislamiento necesita un Postgres real con las migraciones aplicadas.',
      '',
      '  1. Levanta una base:  docker run -d -p 54322:5432 -e POSTGRES_PASSWORD=postgres postgres:17',
      '     (o usa un proyecto de Supabase de desarrollo)',
      '  2. export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      '  3. pnpm db:migrate',
      '  4. pnpm test:isolation',
      '',
      'En CI corre automáticamente contra el servicio de Postgres del workflow.',
      '',
    ].join('\n'),
  );
}
