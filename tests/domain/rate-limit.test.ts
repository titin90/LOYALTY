import { describe, it, expect, beforeEach } from 'vitest';
import { consumir, resetRateLimits, clientIp } from '@/lib/security/rate-limit';

const AHORA = 1_800_000_000_000;

beforeEach(() => resetRateLimits());

describe('consumir', () => {
  it('permite hasta el máximo y rechaza el siguiente', () => {
    for (let i = 0; i < 3; i += 1) {
      expect(consumir('ip', 3, 60, AHORA).allowed, `intento ${i + 1}`).toBe(true);
    }
    expect(consumir('ip', 3, 60, AHORA).allowed).toBe(false);
  });

  it('cuenta cada clave por separado', () => {
    consumir('ip-a', 1, 60, AHORA);
    expect(consumir('ip-b', 1, 60, AHORA).allowed).toBe(true);
  });

  it('se reinicia al pasar la ventana', () => {
    consumir('ip', 1, 60, AHORA);
    expect(consumir('ip', 1, 60, AHORA).allowed).toBe(false);
    expect(consumir('ip', 1, 60, AHORA + 60_001).allowed).toBe(true);
  });

  it('informa cuánto falta para poder reintentar', () => {
    consumir('ip', 1, 60, AHORA);
    const resultado = consumir('ip', 1, 60, AHORA + 20_000);
    expect(resultado.allowed).toBe(false);
    expect(resultado.retryAfterSeconds).toBe(40);
  });

  it('no acumula claves sin techo', () => {
    for (let i = 0; i < 10_050; i += 1) {
      consumir(`ip-${i}`, 5, 1, AHORA);
    }
    // Sin la purga, la tabla crecería con cada IP de un solo uso.
    expect(consumir('nueva', 5, 60, AHORA + 5000).allowed).toBe(true);
  });
});

describe('clientIp', () => {
  it('toma la PRIMERA entrada de x-forwarded-for', () => {
    // Las siguientes las puede escribir quien llama: confiar en ellas permite
    // saltarse el límite cambiando una cabecera.
    const headers = new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1, 10.0.0.2' });
    expect(clientIp(headers)).toBe('1.2.3.4');
  });

  it('cae a x-real-ip', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '5.6.7.8' }))).toBe('5.6.7.8');
  });

  it('devuelve un valor estable si no hay ninguna', () => {
    expect(clientIp(new Headers())).toBe('desconocida');
  });
});
