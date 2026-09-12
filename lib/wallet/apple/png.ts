/**
 * Generador mínimo de PNG de color sólido.
 *
 * Un `.pkpass` no es válido sin `icon.png`, así que cada negocio necesita al
 * menos uno. Generarlo en el momento evita guardar binarios en el repo y permite
 * que un negocio sin logo subido reciba igual una tarjeta con sus colores.
 */
import { deflateSync } from 'fflate';

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);

  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);

  const forCrc = out.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(forCrc));
  return out;
}

/** PNG RGB de `size`×`size` píxeles en un color `#rrggbb`. */
export function solidPng(size: number, hexColor: string): Uint8Array {
  const value = Number.parseInt(hexColor.slice(1), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];

  // Cada fila lleva por delante un byte de filtro (0 = ninguno).
  const raw = new Uint8Array(size * (1 + size * 3));
  for (let y = 0; y < size; y += 1) {
    const start = y * (1 + size * 3);
    raw[start] = 0;
    for (let x = 0; x < size; x += 1) {
      const p = start + 1 + x * 3;
      raw[p] = r!;
      raw[p + 1] = g!;
      raw[p + 2] = b!;
    }
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  ihdr[8] = 8; // profundidad de bits
  ihdr[9] = 2; // color RGB
  // 10, 11, 12 quedan en 0: deflate, sin filtro adicional, sin entrelazado.

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];

  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}
