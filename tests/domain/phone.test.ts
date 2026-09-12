import { describe, it, expect } from 'vitest';
import { normalizeChileanPhone, formatChileanPhone } from '@/lib/domain/phone';

describe('normalizeChileanPhone', () => {
  it.each([
    ['912345678', '+56912345678'],
    ['+56912345678', '+56912345678'],
    ['56912345678', '+56912345678'],
    ['09 1234 5678', '+56912345678'],
    ['+56 9 1234 5678', '+56912345678'],
    ['(9) 1234-5678', '+56912345678'],
  ])('normaliza %s', (input, expected) => {
    const result = normalizeChileanPhone(input);
    expect(result).toEqual({ ok: true, e164: expected });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['12345678', 'format'],       // fijo, no móvil
    ['9123456789', 'format'],     // un dígito de más
    ['91234567', 'format'],       // un dígito de menos
    ['+1912345678', 'format'],    // otro país
    ['no-es-un-telefono', 'format'],
  ])('rechaza %s', (input, reason) => {
    expect(normalizeChileanPhone(input)).toEqual({ ok: false, reason });
  });
});

describe('formatChileanPhone', () => {
  it('formatea para el panel', () => {
    expect(formatChileanPhone('+56912345678')).toBe('+56 9 1234 5678');
  });

  it('devuelve la entrada si no reconoce el formato', () => {
    expect(formatChileanPhone('+14155550123')).toBe('+14155550123');
  });
});
