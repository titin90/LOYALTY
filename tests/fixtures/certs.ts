/**
 * Certificados de prueba.
 *
 * Reemplazan al par real de Apple (certificado Pass Type ID + intermedio WWDR),
 * que no se puede tener en el repo ni en CI. La cadena tiene la misma forma, así
 * que el empaquetado y la firma se ejercitan de verdad; lo único que cambia en
 * producción son las variables de entorno con los certificados auténticos.
 */
import forge from 'node-forge';
import type { PassCertificates } from '@/lib/wallet/apple/pkpass';

function makeCert(
  commonName: string,
  issuer?: { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey },
): {
  certPem: string;
  keyPem: string;
  cert: forge.pki.Certificate;
  key: forge.pki.rsa.PrivateKey;
} {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);

  const subject = [{ name: 'commonName', value: commonName }];
  cert.setSubject(subject);
  cert.setIssuer(issuer ? issuer.cert.subject.attributes : subject);
  cert.setExtensions([{ name: 'basicConstraints', cA: issuer === undefined }]);

  cert.sign(issuer ? issuer.key : keys.privateKey, forge.md.sha256.create());

  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    cert,
    key: keys.privateKey,
  };
}

/** Empaqueta el par en un `.p12` con clave, igual que el que entrega Apple. */
export function testP12(password: string): string {
  const { signer } = raw();
  const asn1 = forge.pkcs12.toPkcs12Asn1(signer.key, [signer.cert], password, {
    algorithm: '3des',
  });
  return forge.util.encode64(forge.asn1.toDer(asn1).getBytes());
}

let cached: { certs: PassCertificates; caPem: string } | null = null;
let rawCached: { ca: ReturnType<typeof makeCert>; signer: ReturnType<typeof makeCert> } | null = null;

function raw() {
  rawCached ??= (() => {
    const ca = makeCert('Autoridad de prueba (hace de WWDR)');
    return { ca, signer: makeCert('Pass Type ID de prueba', { cert: ca.cert, key: ca.key }) };
  })();
  return rawCached;
}

/** Generar RSA de 2048 es lento: se reutiliza dentro del mismo proceso de test. */
export function testCertificates(): { certs: PassCertificates; caPem: string } {
  if (cached) return cached;

  const { ca, signer } = raw();

  cached = {
    certs: {
      signerCertPem: signer.certPem,
      signerKeyPem: signer.keyPem,
      wwdrCertPem: ca.certPem,
    },
    caPem: ca.certPem,
  };
  return cached;
}
