/**
 * Configuración de las wallets, leída del entorno.
 *
 * Ambas plataformas dependen de trámites externos —el certificado Pass Type ID
 * de Apple y la aprobación del issuer account de Google—, así que la aplicación
 * tiene que funcionar sin ellas: si falta la configuración, la plataforma queda
 * declarada como no disponible y la interfaz lo dice, en vez de reventar.
 */
import forge from 'node-forge';
import type { PassCertificates } from '@/lib/wallet/apple/pkpass';
import { parseServiceAccount, type ServiceAccount } from '@/lib/wallet/google/jwt';

export interface AppleConfig {
  readonly passTypeIdentifier: string;
  readonly teamIdentifier: string;
  readonly certificates: PassCertificates;
}

export interface GoogleConfig {
  readonly issuerId: string;
  readonly account: ServiceAccount;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : undefined;
}

export function appUrl(): string {
  return env('APP_URL') ?? 'http://localhost:3000';
}

/** Convierte el `.p12` que entrega Apple al par PEM que usa la firma. */
export function p12ToPem(p12Base64: string, password: string): {
  certPem: string;
  keyPem: string;
} {
  const der = forge.util.decode64(p12Base64);
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), password);

  const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag!]?.[0];
  const keyBag = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
    forge.pki.oids.pkcs8ShroudedKeyBag!
  ]?.[0];

  if (!certBag?.cert || !keyBag?.key) {
    throw new Error('El .p12 de Apple no contiene certificado y clave privada');
  }

  return {
    certPem: forge.pki.certificateToPem(certBag.cert),
    keyPem: forge.pki.privateKeyToPem(keyBag.key as forge.pki.rsa.PrivateKey),
  };
}

let appleCache: AppleConfig | null | undefined;

export function appleConfig(): AppleConfig | null {
  if (appleCache !== undefined) return appleCache;

  const passTypeIdentifier = env('APPLE_PASS_TYPE_ID');
  const teamIdentifier = env('APPLE_TEAM_ID');
  const p12 = env('APPLE_PASS_CERT_P12_BASE64');
  const wwdr = env('APPLE_WWDR_CERT_PEM');

  if (!passTypeIdentifier || !teamIdentifier || !p12 || !wwdr) {
    appleCache = null;
    return null;
  }

  try {
    const { certPem, keyPem } = p12ToPem(p12, env('APPLE_PASS_CERT_PASSWORD') ?? '');
    appleCache = {
      passTypeIdentifier,
      teamIdentifier,
      certificates: {
        signerCertPem: certPem,
        signerKeyPem: keyPem,
        wwdrCertPem: Buffer.from(wwdr, 'base64').toString('utf8').includes('CERTIFICATE')
          ? Buffer.from(wwdr, 'base64').toString('utf8')
          : wwdr,
      },
    };
  } catch (error) {
    // Nunca el detalle: podría arrastrar material del certificado a un log.
    console.error('[wallet] certificado de Apple ilegible', {
      tipo: error instanceof Error ? error.name : 'desconocido',
    });
    appleCache = null;
  }

  return appleCache;
}

let googleCache: GoogleConfig | null | undefined;

export function googleConfig(): GoogleConfig | null {
  if (googleCache !== undefined) return googleCache;

  const issuerId = env('GOOGLE_WALLET_ISSUER_ID');
  const accountJson = env('GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64');

  if (!issuerId || !accountJson) {
    googleCache = null;
    return null;
  }

  try {
    googleCache = {
      issuerId,
      account: parseServiceAccount(Buffer.from(accountJson, 'base64').toString('utf8')),
    };
  } catch (error) {
    console.error('[wallet] service account de Google ilegible', {
      tipo: error instanceof Error ? error.name : 'desconocido',
    });
    googleCache = null;
  }

  return googleCache;
}

export interface WalletAvailability {
  readonly apple: boolean;
  readonly google: boolean;
}

export function walletAvailability(): WalletAvailability {
  return { apple: appleConfig() !== null, google: googleConfig() !== null };
}

/** Solo para tests: la configuración se cachea por proceso. */
export function resetWalletConfigCache(): void {
  appleCache = undefined;
  googleCache = undefined;
}
