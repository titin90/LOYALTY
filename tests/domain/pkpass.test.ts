import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { buildManifest, buildPkPass, signManifest } from '@/lib/wallet/apple/pkpass';
import { solidPng } from '@/lib/wallet/apple/png';
import { testCertificates } from '../fixtures/certs';

const passJson = Buffer.from(JSON.stringify({ formatVersion: 1, serialNumber: 'abc' }), 'utf8');
const icon = solidPng(29, '#171412');

const files = {
  'pass.json': Uint8Array.from(passJson),
  'icon.png': icon,
};

let certs: ReturnType<typeof testCertificates>;

beforeAll(() => {
  certs = testCertificates();
}, 60_000);

describe('buildManifest', () => {
  it('lista el SHA-1 de cada archivo — Apple exige SHA-1 aquí', () => {
    const manifest = buildManifest(files);
    expect(manifest['pass.json']).toBe(createHash('sha1').update(passJson).digest('hex'));
    expect(manifest['icon.png']).toBe(createHash('sha1').update(icon).digest('hex'));
  });

  it('un byte distinto cambia el hash', () => {
    const otro = buildManifest({ ...files, 'pass.json': Uint8Array.from(Buffer.from('{}')) });
    expect(otro['pass.json']).not.toBe(buildManifest(files)['pass.json']);
  });
});

describe('buildPkPass', () => {
  it('produce un ZIP con los cuatro archivos que Apple espera', () => {
    const pkpass = buildPkPass(files, certs.certs);
    const entries = Object.keys(unzipSync(pkpass)).sort();
    expect(entries).toEqual(['icon.png', 'manifest.json', 'pass.json', 'signature']);
  });

  it('el manifest del paquete coincide con el contenido real', () => {
    const contents = unzipSync(buildPkPass(files, certs.certs));
    const manifest = JSON.parse(Buffer.from(contents['manifest.json']!).toString('utf8')) as Record<
      string,
      string
    >;
    expect(manifest['pass.json']).toBe(
      createHash('sha1').update(contents['pass.json']!).digest('hex'),
    );
  });

  it('rechaza un paquete sin pass.json', () => {
    expect(() => buildPkPass({ 'icon.png': icon }, certs.certs)).toThrow(/pass\.json/);
  });

  it('rechaza un paquete sin icon.png: Apple lo descarta en silencio', () => {
    expect(() => buildPkPass({ 'pass.json': files['pass.json'] }, certs.certs)).toThrow(/icon\.png/);
  });
});

describe('firma PKCS#7', () => {
  it('openssl valida la firma contra el manifest', () => {
    const contents = unzipSync(buildPkPass(files, certs.certs));
    const dir = mkdtempSync(join(tmpdir(), 'pkpass-'));

    writeFileSync(join(dir, 'signature'), Buffer.from(contents['signature']!));
    writeFileSync(join(dir, 'manifest.json'), Buffer.from(contents['manifest.json']!));
    writeFileSync(join(dir, 'ca.pem'), certs.caPem);

    // Verificación con una herramienta independiente: si esto pasa, la firma
    // tiene la forma que Apple espera y no solo la que nosotros creemos.
    const salida = execFileSync(
      'openssl',
      ['smime', '-verify', '-inform', 'DER', '-in', join(dir, 'signature'),
       '-content', join(dir, 'manifest.json'), '-CAfile', join(dir, 'ca.pem'), '-purpose', 'any'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(salida).toContain('pass.json');
  });

  it('openssl RECHAZA la firma si el manifest fue alterado', () => {
    const contents = unzipSync(buildPkPass(files, certs.certs));
    const dir = mkdtempSync(join(tmpdir(), 'pkpass-mal-'));

    writeFileSync(join(dir, 'signature'), Buffer.from(contents['signature']!));
    writeFileSync(join(dir, 'manifest.json'), '{"pass.json":"0000000000000000000000000000000000000000"}');
    writeFileSync(join(dir, 'ca.pem'), certs.caPem);

    expect(() =>
      execFileSync(
        'openssl',
        ['smime', '-verify', '-inform', 'DER', '-in', join(dir, 'signature'),
         '-content', join(dir, 'manifest.json'), '-CAfile', join(dir, 'ca.pem'), '-purpose', 'any'],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      ),
    ).toThrow();
  });

  it('la firma es separada: no lleva el manifest dentro', () => {
    const manifest = Buffer.from('{"pass.json":"abc"}', 'utf8');
    const firma = Buffer.from(signManifest(Uint8Array.from(manifest), certs.certs));
    expect(firma.includes(manifest)).toBe(false);
  });
});
