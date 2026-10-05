/**
 * Capturas de la aplicación en local, para poder MIRAR el diseño en vez de
 * suponerlo. Usa el Chrome ya instalado; no descarga ningún navegador.
 *
 *   pnpm shots            escritorio y teléfono, claro y oscuro
 */
import 'dotenv/config';
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { signIn } from '../lib/auth/login';
import { issueSession, sessionSecret } from '../lib/auth/session';

const BASE = 'http://127.0.0.1:3000';
const OUT = '/tmp/shots';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const session = await signIn({ email: 'sofia@ejemplo.cl', password: 'demo-clave-1234' });
if (!session.ok) {
  console.error('No se pudo iniciar sesión. ¿Corriste `pnpm seed`?');
  process.exit(1);
}

const rutas = [
  ['join', '/join/cafe-esquina'],
  ['summary', '/dashboard/cafe-esquina'],
  ['customers', '/dashboard/cafe-esquina/customers'],
  ['at-risk', '/dashboard/cafe-esquina/at-risk'],
  ['card', '/dashboard/cafe-esquina/card'],
  ['settings', '/dashboard/cafe-esquina/settings'],
] as const;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME });

for (const [tema, ancho, alto, etiqueta] of [
  ['dark', 1280, 900, 'desktop'],
  ['light', 1280, 900, 'desktop-light'],
  ['dark', 390, 844, 'phone'],
] as const) {
  const context = await browser.newContext({
    viewport: { width: ancho, height: alto },
    colorScheme: tema,
    deviceScaleFactor: 2,
  });
  await context.addCookies([
    {
      name: 'panel_session',
      value: issueSession(session.session, sessionSecret()),
      domain: '127.0.0.1',
      path: '/',
    },
  ]);

  const page = await context.newPage();
  for (const [nombre, ruta] of rutas) {
    await page.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${OUT}/${etiqueta}-${nombre}.png`, fullPage: true });
  }
  await context.close();
}

await browser.close();
console.log(`Capturas en ${OUT}`);
process.exit(0);
