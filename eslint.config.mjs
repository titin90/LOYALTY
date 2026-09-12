import coreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'drizzle/**', 'next-env.d.ts'] },
  ...coreWebVitals,
  ...nextTypescript,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Una conexión suelta a Postgres se salta el control de tenant y anula
      // toda la arquitectura de aislamiento (CLAUDE.md regla 3).
      'no-restricted-imports': ['error', {
        paths: [{
          name: 'postgres',
          message: 'Usa los helpers de lib/db/client.ts en vez de abrir una conexión propia.',
        }],
      }],
    },
  },
  {
    // Los helpers de tests necesitan la conexión directa para sembrar datos.
    files: ['tests/**/*.ts', 'scripts/**/*.ts', 'lib/db/client.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
];

export default config;
