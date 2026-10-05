import { describe, it, expect } from 'vitest';
import { securityHeaders } from '@/lib/security/headers';

const csp = (ruta: string, entorno: 'development' | 'production') =>
  securityHeaders(ruta, entorno)['content-security-policy']!;

describe('securityHeaders', () => {
  it('en desarrollo permite eval: React lo usa para reconstruir stacks', () => {
    // Sin esto la aplicación no arranca en local, y el error solo aparece en
    // la consola del navegador.
    expect(csp('/', 'development')).toContain("'unsafe-eval'");
  });

  it('en producción NO permite eval', () => {
    expect(csp('/', 'production')).not.toContain("'unsafe-eval'");
  });

  it('en desarrollo permite websocket para el refresco en caliente', () => {
    expect(csp('/', 'development')).toMatch(/connect-src[^;]*ws:/);
  });

  it('en producción el websocket no está permitido', () => {
    expect(csp('/', 'production')).not.toMatch(/connect-src[^;]*ws:/);
  });

  it('wasm sigue permitido en ambos: lo necesita el lector de QR', () => {
    expect(csp('/scan', 'development')).toContain("'wasm-unsafe-eval'");
    expect(csp('/scan', 'production')).toContain("'wasm-unsafe-eval'");
  });

  it('la cámara solo se permite en el escáner', () => {
    expect(securityHeaders('/scan', 'production')['permissions-policy']).toContain('camera=(self)');
    expect(securityHeaders('/', 'production')['permissions-policy']).toContain('camera=()');
    expect(securityHeaders('/dashboard/x', 'production')['permissions-policy']).toContain('camera=()');
  });

  it('HSTS solo en producción: en local el navegador lo recordaría dos años', () => {
    expect(securityHeaders('/', 'production')['strict-transport-security']).toBeDefined();
    expect(securityHeaders('/', 'development')['strict-transport-security']).toBeUndefined();
  });

  it('upgrade-insecure-requests solo en producción: rompería http://localhost', () => {
    expect(csp('/', 'production')).toContain('upgrade-insecure-requests');
    expect(csp('/', 'development')).not.toContain('upgrade-insecure-requests');
  });

  it('las defensas que no dependen del entorno están en ambos', () => {
    for (const entorno of ['development', 'production'] as const) {
      const h = securityHeaders('/', entorno);
      expect(h['x-frame-options']).toBe('DENY');
      expect(h['x-content-type-options']).toBe('nosniff');
      expect(csp('/', entorno)).toContain("frame-ancestors 'none'");
      expect(csp('/', entorno)).toContain("object-src 'none'");
    }
  });

  it('solo Google Wallet como destino externo', () => {
    expect(csp('/', 'production')).toContain('https://walletobjects.googleapis.com');
    expect(csp('/', 'production')).toMatch(/connect-src 'self' https:\/\/walletobjects/);
  });
});
