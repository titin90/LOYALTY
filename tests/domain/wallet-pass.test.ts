import { describe, it, expect } from 'vitest';
import { inflateSync } from 'fflate';
import { solidPng } from '@/lib/wallet/apple/png';
import { buildPassJson, progressText } from '@/lib/wallet/apple/pass';
import { parseCardDesign, hexToRgbCss, MARCA } from '@/lib/wallet/design';

describe('solidPng', () => {
  const png = solidPng(29, '#B8955A');

  it('empieza con la firma PNG', () => {
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('declara las dimensiones pedidas en el IHDR', () => {
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(29); // ancho
    expect(view.getUint32(20)).toBe(29); // alto
  });

  it('los píxeles llevan el color pedido', () => {
    // IDAT viene después de la firma (8) + IHDR (12 + 13).
    const start = 8 + 25;
    const view = new DataView(png.buffer, png.byteOffset);
    const length = view.getUint32(start);
    const data = png.subarray(start + 8, start + 8 + length);
    const raw = inflateSync(data);

    expect(raw[0]).toBe(0); // byte de filtro de la primera fila
    expect([raw[1], raw[2], raw[3]]).toEqual([0xb8, 0x95, 0x5a]);
  });

  it('termina con el chunk IEND', () => {
    expect(Buffer.from(png.subarray(png.length - 8, png.length - 4)).toString()).toBe('IEND');
  });

  it('un tamaño distinto produce un archivo distinto', () => {
    expect(solidPng(58, '#B8955A').length).not.toBe(png.length);
  });
});

describe('parseCardDesign', () => {
  it('sin configuración usa la paleta de marca', () => {
    const design = parseCardDesign(undefined);
    expect(design.background).toBe(MARCA.negroCalido);
    expect(design.label).toBe(MARCA.dorado);
    expect(design.unitLabel).toBe('VISITAS');
  });

  it('respeta lo que el negocio configuró', () => {
    const design = parseCardDesign({ background: '#001122', unitLabel: 'CAFÉS' });
    expect(design.background).toBe('#001122');
    expect(design.unitLabel).toBe('CAFÉS');
  });

  it('una configuración rota cae a la marca en vez de romper la emisión', () => {
    const design = parseCardDesign({ background: 'azul marino', unitLabel: '' });
    expect(design.background).toBe(MARCA.negroCalido);
  });
});

describe('hexToRgbCss', () => {
  it('Apple espera rgb(), no hexadecimal', () => {
    expect(hexToRgbCss('#171412')).toBe('rgb(23,20,18)');
    expect(hexToRgbCss('#FFFFFF')).toBe('rgb(255,255,255)');
    expect(hexToRgbCss('#000000')).toBe('rgb(0,0,0)');
  });
});

describe('progressText', () => {
  it.each([
    [3, 'un corte gratis', 'Te faltan 3 visitas para un corte gratis'],
    [1, 'un corte gratis', 'Te falta 1 visita para un corte gratis'],
    [0, 'un corte gratis', '¡Ya puedes canjear un corte gratis!'],
    [null, 'un corte gratis', '¡Ya puedes canjear un corte gratis!'],
    [3, null, 'Sigue sumando visitas'],
  ])('con %s puntos restantes y premio %s', (faltan, premio, esperado) => {
    expect(progressText(faltan, premio)).toBe(esperado);
  });
});

describe('buildPassJson', () => {
  const input = {
    serial: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    authenticationToken: 'token-secreto',
    organizationName: 'Barbería Don Luis',
    customerName: 'Ana Pérez',
    balance: 3,
    pointsToNextReward: 2,
    rewardName: 'un corte gratis',
    design: parseCardDesign(undefined),
    passTypeIdentifier: 'pass.cl.ejemplo.loyalty',
    teamIdentifier: 'ABCDE12345',
    webServiceUrl: 'https://app.ejemplo.cl/api/v1',
  };

  const pass = buildPassJson(input) as Record<string, unknown>;
  const storeCard = pass.storeCard as Record<string, { key: string; value: unknown; changeMessage?: string }[]>;

  it('declara el identificador y el equipo', () => {
    expect(pass.passTypeIdentifier).toBe('pass.cl.ejemplo.loyalty');
    expect(pass.teamIdentifier).toBe('ABCDE12345');
    expect(pass.formatVersion).toBe(1);
  });

  it('el QR lleva el serial, que es la credencial de la tarjeta', () => {
    const barcodes = pass.barcodes as { message: string; format: string }[];
    expect(barcodes[0]!.message).toBe(input.serial);
    expect(barcodes[0]!.format).toBe('PKBarcodeFormatQR');
  });

  it('TODO campo que cambia lleva changeMessage con %@', () => {
    // Sin esto no hay notificación en pantalla bloqueada, que es el canal de
    // retención del producto.
    for (const campo of [...storeCard.headerFields!, ...storeCard.secondaryFields!]) {
      expect(campo.changeMessage, `campo ${campo.key}`).toBeDefined();
      expect(campo.changeMessage, `campo ${campo.key}`).toContain('%@');
    }
  });

  it('apunta al web service para recibir actualizaciones', () => {
    expect(pass.webServiceURL).toBe('https://app.ejemplo.cl/api/v1');
    expect(pass.authenticationToken).toBe('token-secreto');
  });

  it('convierte los colores a rgb()', () => {
    expect(pass.backgroundColor).toBe('rgb(23,20,18)');
    expect(pass.labelColor).toBe('rgb(184,149,90)');
  });

  it('marca el pase como no compartible: es nominativo', () => {
    expect(pass.sharingProhibited).toBe(true);
  });

  it('muestra el saldo y el progreso', () => {
    expect(storeCard.headerFields![0]!.value).toBe(3);
    expect(storeCard.secondaryFields![0]!.value).toBe('Te faltan 2 visitas para un corte gratis');
  });
});
