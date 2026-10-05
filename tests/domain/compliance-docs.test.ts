/**
 * Los documentos de cumplimiento citan cosas que el código implementa. Si una
 * cambia y la otra no, el documento pasa a ser falso — y es un documento que se
 * firma con clientes y se le muestra a un fiscalizador.
 *
 * Estos tests atan lo uno a lo otro.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CONSENT_TEXT, CONSENT_VERSION } from '@/lib/consent';
import { DSR_DEADLINE_DAYS } from '@/lib/dashboard/dsr';

const leer = (ruta: string) => readFileSync(new URL(`../../${ruta}`, import.meta.url), 'utf8');

/** Quita prefijos de cita y normaliza espacios, para comparar prosa. */
const prosa = (texto: string) =>
  texto
    .split('\n')
    .map((l) => l.replace(/^\s*>\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ');

describe('contrato de encargado', () => {
  const contrato = leer('compliance/contrato-encargado.md');

  it('el anexo cita EXACTAMENTE el consentimiento que ve el cliente', () => {
    expect(prosa(contrato)).toContain(prosa(CONSENT_TEXT));
  });

  it('declara la versión vigente del consentimiento', () => {
    expect(contrato).toContain(CONSENT_VERSION);
  });

  it('advierte que necesita revisión legal', () => {
    expect(contrato.toLowerCase()).toMatch(/revisión legal/);
  });

  it('declara que a Apple y Google NO se les manda el teléfono', () => {
    // Hay un test de integración que lo verifica sobre el pase real emitido.
    expect(prosa(contrato)).toMatch(/no se les transmite el número de teléfono/i);
  });
});

describe('registro de tratamiento', () => {
  const registro = leer('compliance/registro-de-tratamiento.md');

  it('el plazo de respuesta coincide con el que aplica el código', () => {
    expect(registro).toContain(`**${DSR_DEADLINE_DAYS} días**`);
  });

  it('declara los datos que realmente se recogen, y solo esos', () => {
    expect(registro).toContain('Teléfono (E.164)');
    expect(prosa(registro)).toMatch(/No se recogen:.*RUT/);
  });
});

describe('runbook de brecha', () => {
  const runbook = leer('compliance/runbook-brecha.md');

  it('nombra las variables de entorno que hay que rotar, tal como se llaman', () => {
    expect(runbook).toContain('SESSION_SECRET');
    expect(runbook).toContain('DEVICE_TOKEN_SECRET');
  });

  it('fija el plazo legal de 72 horas', () => {
    expect(runbook).toContain('72 horas');
  });
});
