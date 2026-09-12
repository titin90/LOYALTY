import { describe, it, expect } from 'vitest';
import { extractSerial } from '@/lib/domain/serial';

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
