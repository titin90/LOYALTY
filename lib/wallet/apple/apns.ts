/**
 * Notificaciones push a Apple Wallet.
 *
 * El push no lleva contenido: solo le dice al teléfono "este pase cambió". El
 * dispositivo entonces pide la versión nueva al web service, y es ahí —al ver un
 * campo con `changeMessage`— donde muestra el aviso en la pantalla bloqueada.
 *
 * Autenticación por token (JWT ES256 con la llave .p8), no por certificado: el
 * token vale una hora y se reutiliza, que es lo que Apple pide.
 */
import http2 from 'node:http2';
import { SignJWT, importPKCS8 } from 'jose';

export interface ApnsConfig {
  readonly keyP8: string;
  readonly keyId: string;
  readonly teamId: string;
  readonly topic: string;
  readonly host?: string;
}

let cached: { token: string; issuedAt: number } | null = null;

/** Apple rechaza tokens de más de una hora y también renovarlos demasiado seguido. */
async function bearerToken(config: ApnsConfig): Promise<string> {
  const ahora = Math.floor(Date.now() / 1000);
  if (cached && ahora - cached.issuedAt < 45 * 60) return cached.token;

  const key = await importPKCS8(config.keyP8, 'ES256');
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: config.keyId })
    .setIssuer(config.teamId)
    .setIssuedAt(ahora)
    .sign(key);

  cached = { token, issuedAt: ahora };
  return token;
}

export interface PushResult {
  readonly ok: boolean;
  readonly status: number;
  /** Apple responde 410 cuando el dispositivo ya no tiene el pase: hay que
   *  borrar su registro o se acumulan envíos muertos. */
  readonly gone: boolean;
}

export async function pushPassUpdate(
  pushToken: string,
  config: ApnsConfig,
): Promise<PushResult> {
  const host = config.host ?? 'https://api.push.apple.com';
  const authorization = `bearer ${await bearerToken(config)}`;

  return new Promise<PushResult>((resolve) => {
    const client = http2.connect(host);
    const cerrar = (result: PushResult) => {
      client.close();
      resolve(result);
    };

    client.on('error', () => cerrar({ ok: false, status: 0, gone: false }));

    const request = client.request({
      ':method': 'POST',
      ':path': `/3/device/${pushToken}`,
      authorization,
      'apns-topic': config.topic,
      'apns-push-type': 'background',
      'apns-priority': '5',
      'content-type': 'application/json',
    });

    request.setTimeout(10_000, () => {
      request.close();
      cerrar({ ok: false, status: 0, gone: false });
    });

    let status = 0;
    request.on('response', (headers) => {
      status = Number(headers[':status'] ?? 0);
    });
    request.on('error', () => cerrar({ ok: false, status: 0, gone: false }));
    request.on('end', () =>
      cerrar({ ok: status >= 200 && status < 300, status, gone: status === 410 }),
    );

    request.end('{}');
    request.resume();
  });
}

/** Solo para tests. */
export function resetApnsTokenCache(): void {
  cached = null;
}
