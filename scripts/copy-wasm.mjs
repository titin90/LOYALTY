/**
 * Copia el wasm del decodificador a /public.
 *
 * zxing-wasm lo descarga de un CDN por defecto. El escáner tiene que funcionar en
 * el mostrador de un local con conexión mala o con el CDN bloqueado, así que se
 * sirve desde el propio dominio.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

// El paquete exporta el .wasm como subpath: se resuelve directo en vez de
// deducir la carpeta desde el entry, que cambia entre la build esm y la cjs.
const source = require.resolve('zxing-wasm/reader/zxing_reader.wasm');
await mkdir('public', { recursive: true });
await copyFile(source, join('public', 'zxing_reader.wasm'));
console.log('[copy-wasm] zxing_reader.wasm copiado a /public');
