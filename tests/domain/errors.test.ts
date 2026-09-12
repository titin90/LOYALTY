import { describe, it, expect } from 'vitest';
import { rootCauseMessage, sqlState } from '@/lib/db/errors';

/** Reproduce cómo Drizzle envuelve un error de postgres.js. */
function wrapped(inner: Error): Error {
  const outer = new Error('Failed query: select ... params: +56911112222');
  outer.cause = inner;
  return outer;
}

describe('rootCauseMessage', () => {
  it('llega al mensaje real bajo el envoltorio de Drizzle', () => {
    expect(rootCauseMessage(wrapped(new Error('Negocio no encontrado')))).toBe(
      'Negocio no encontrado',
    );
  });

  it('nunca devuelve el texto de la consulta, que lleva los datos del cliente', () => {
    expect(rootCauseMessage(wrapped(new Error('Telefono invalido')))).not.toMatch(/\+569/);
  });

  it('atraviesa varios niveles de cause', () => {
    const a = new Error('raíz');
    const b = new Error('medio');
    b.cause = a;
    expect(rootCauseMessage(wrapped(b))).toBe('raíz');
  });

  it('funciona con un error sin cause', () => {
    expect(rootCauseMessage(new Error('suelto'))).toBe('suelto');
  });

  it('no se cuelga con una cadena de cause circular', () => {
    const a = new Error('a');
    const b = new Error('b');
    a.cause = b;
    b.cause = a;
    expect(() => rootCauseMessage(a)).not.toThrow();
  });

  it('tolera valores que no son Error', () => {
    expect(rootCauseMessage('texto plano')).toBe('texto plano');
    expect(rootCauseMessage(null)).toBe('null');
  });
});

describe('sqlState', () => {
  it('encuentra el código aunque esté en la causa', () => {
    const inner = Object.assign(new Error('violación'), { code: '23514' });
    expect(sqlState(wrapped(inner))).toBe('23514');
  });

  it('undefined cuando no hay código', () => {
    expect(sqlState(new Error('sin código'))).toBeUndefined();
  });
});
