import { describe, it, expect } from 'vitest';
import { extractSerial } from '@/lib/domain/serial';
import { shouldRetry } from '@/lib/scanner/offline-queue';

const serial = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('extractSerial', () => {
  it('acepta el serial pelado', () => {
    expect(extractSerial(serial)).toBe(serial);
  });

  it('normaliza mayúsculas', () => {
    expect(extractSerial(serial.toUpperCase())).toBe(serial);
  });

  it('ignora espacios alrededor', () => {
    expect(extractSerial(`  ${serial}  `)).toBe(serial);
  });

  it('lo saca de una URL con el serial al final', () => {
    expect(extractSerial(`https://app.cl/p/${serial}`)).toBe(serial);
  });

  it('lo saca de un parámetro de consulta', () => {
    expect(extractSerial(`https://app.cl/tarjeta?s=${serial}`)).toBe(serial);
  });

  it.each([
    ['', 'vacío'],
    ['   ', 'solo espacios'],
    ['hola mundo', 'texto cualquiera'],
    ['https://otro-sitio.cl/promo', 'URL sin serial'],
    ['a1b2c3', 'demasiado corto'],
    [`${serial}ff`, 'demasiado largo'],
    ['g1b2c3d4e5f60718293a4b5c6d7e8f90', 'carácter no hexadecimal'],
    ['1234567890123456789012345678901234', 'código de barras cualquiera'],
  ])('rechaza %j (%s)', (input) => {
    expect(extractSerial(input)).toBeNull();
  });
});

describe('qué marcajes se conservan en la cola', () => {
  /**
   * Un fracaso del PIN o del equipo no dice nada sobre la visita: la persona SÍ
   * vino. Borrar la fila ahí perdía visitas reales en silencio.
   */
  it.each(['bad_pin', 'locked', 'device_revoked', 'unknown'])(
    'con %s el marcaje se conserva para reintentarlo',
    (failure) => {
      expect(shouldRetry(failure)).toBe(true);
    },
  );

  it.each(['card_not_here', 'card_blocked', 'too_soon'])(
    'con %s el veredicto es definitivo y se descarta',
    (failure) => {
      expect(shouldRetry(failure)).toBe(false);
    },
  );
});
