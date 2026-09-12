/**
 * Empaquetado y firma del `.pkpass`.
 *
 * Un pase es un ZIP con:
 *   pass.json      — el contenido
 *   icon.png       — obligatorio; sin él, Apple rechaza el pase en silencio
 *   manifest.json  — SHA-1 de cada archivo del paquete
 *   signature      — PKCS#7 separada del manifest, firmada con el certificado
 *                    Pass Type ID y encadenada al intermedio WWDR de Apple
 *
 * Apple exige SHA-1 en el manifest. No es una decisión nuestra ni es negociable:
 * es el formato. La firma sí usa SHA-256.
 */
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import forge from 'node-forge';

/** `forge.pki.oids` está tipado como índice abierto: se resuelve una vez y se
 *  falla temprano si un OID esperado no existe. */
function oid(name: string): string {
  const value = forge.pki.oids[name];
  if (!value) throw new Error(`OID desconocido en node-forge: ${name}`);
  return value;
}

export interface PassCertificates {
  /** Certificado Pass Type ID en PEM. */
  readonly signerCertPem: string;
  /** Clave privada del certificado, en PEM. */
  readonly signerKeyPem: string;
  /** Intermedio Apple Worldwide Developer Relations, en PEM. */
  readonly wwdrCertPem: string;
}

export type PassFiles = Readonly<Record<string, Uint8Array>>;

export function buildManifest(files: PassFiles): Record<string, string> {
  const manifest: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) {
    manifest[name] = createHash('sha1').update(bytes).digest('hex');
  }
  return manifest;
}

/** Firma PKCS#7 separada, en DER — lo que Apple espera en el archivo `signature`. */
export function signManifest(manifest: Uint8Array, certs: PassCertificates): Uint8Array {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(Buffer.from(manifest).toString('binary'));

  const signerCert = forge.pki.certificateFromPem(certs.signerCertPem);
  p7.addCertificate(signerCert);
  p7.addCertificate(forge.pki.certificateFromPem(certs.wwdrCertPem));

  p7.addSigner({
    key: forge.pki.privateKeyFromPem(certs.signerKeyPem),
    certificate: signerCert,
    digestAlgorithm: oid('sha256'),
    authenticatedAttributes: [
      { type: oid('contentType'), value: oid('data') },
      { type: oid('messageDigest') },
      { type: oid('signingTime') },
    ],
  });

  p7.sign({ detached: true });
  return Uint8Array.from(
    Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary'),
  );
}

export function buildPkPass(files: PassFiles, certs: PassCertificates): Uint8Array {
  if (!('pass.json' in files)) throw new Error('El paquete no incluye pass.json');
  if (!('icon.png' in files)) throw new Error('El paquete no incluye icon.png');

  const manifest = Buffer.from(JSON.stringify(buildManifest(files)), 'utf8');

  return zipSync(
    {
      ...Object.fromEntries(Object.entries(files)),
      'manifest.json': Uint8Array.from(manifest),
      signature: signManifest(Uint8Array.from(manifest), certs),
    },
    { level: 6 },
  );
}
