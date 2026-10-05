'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { extractSerial } from '@/lib/domain/serial';
import { submitScan } from '@/lib/actions/scan';
import { enqueue, dequeue, pending } from '@/lib/scanner/offline-queue';
import type { ScanOutcome } from '@/lib/scanning';
import { PinPad } from './pin-pad';
import { Buscador } from './search';
import { Resultado } from './result';

type Estado =
  | 'iniciando'
  | 'sin-camara'
  | 'pin'
  | 'escaneando'
  | 'buscando'
  | 'enviando'
  | 'resultado';

/** El mismo código no se vuelve a leer durante este tiempo. */
const REPETICION_MS = 4000;

export function Scanner() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ultimoRef = useRef<{ serial: string; at: number } | null>(null);

  /** El PIN vive SOLO en memoria durante el turno: nunca en cookie, localStorage
   *  ni IndexedDB. Recargar la página lo vuelve a pedir, a propósito. */
  const pinRef = useRef<string | null>(null);

  const [estado, setEstado] = useState<Estado>('iniciando');
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [ultimoSerial, setUltimoSerial] = useState('');
  const [enCola, setEnCola] = useState(0);
  const [enLinea, setEnLinea] = useState(true);

  const refrescarCola = useCallback(async () => {
    try {
      setEnCola((await pending()).length);
    } catch {
      // IndexedDB puede no estar disponible (modo privado): la cola es un extra.
    }
  }, []);

  /** Envía un marcaje; si la red falla, lo deja en la cola para reintentar. */
  const enviar = useCallback(
    async (serial: string, idempotencyKey: string, desdeCola: boolean) => {
      const pin = pinRef.current;
      if (pin === null) {
        setEstado('pin');
        return;
      }

      try {
        const result = await submitScan(serial, pin, idempotencyKey);

        if (!result.ok && (result.failure === 'bad_pin' || result.failure === 'locked')) {
          pinRef.current = null;
        }
        if (result.ok || result.failure !== 'unknown') {
          await dequeue(idempotencyKey).catch(() => {});
        }

        if (!desdeCola) {
          setUltimoSerial(serial);
          setOutcome(result);
          setEstado('resultado');
        }
      } catch {
        // Sin red: queda pendiente. Reenviarlo es seguro por la clave de idempotencia.
        await enqueue({ idempotencyKey, serial, queuedAt: Date.now() }).catch(() => {});
        if (!desdeCola) {
          setOutcome({
            ok: false,
            failure: 'unknown',
            message: 'Sin conexión. Se enviará solo al volver la señal.',
          });
          setEstado('resultado');
        }
      } finally {
        void refrescarCola();
      }
    },
    [refrescarCola],
  );

  const vaciarCola = useCallback(async () => {
    if (pinRef.current === null) return;
    for (const item of await pending().catch(() => [])) {
      await enviar(item.serial, item.idempotencyKey, true);
    }
  }, [enviar]);

  // Cámara
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelado = false;

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelado) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setEstado((actual) => (actual === 'iniciando' ? 'pin' : actual));
      } catch {
        setEstado('sin-camara');
      }
    })();

    return () => {
      cancelado = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Conectividad
  useEffect(() => {
    const actualizar = () => {
      setEnLinea(navigator.onLine);
      if (navigator.onLine) void vaciarCola();
    };
    actualizar();
    window.addEventListener('online', actualizar);
    window.addEventListener('offline', actualizar);
    return () => {
      window.removeEventListener('online', actualizar);
      window.removeEventListener('offline', actualizar);
    };
  }, [vaciarCola]);

  // Bucle de lectura
  useEffect(() => {
    if (estado !== 'escaneando') return;

    let activo = true;
    const timer = window.setInterval(() => {
      void (async () => {
        if (!activo) return;
        const texto = await leerCodigo(videoRef.current, canvasRef.current);
        if (!activo || texto === null) return;

        const serial = extractSerial(texto);
        if (serial === null) return;

        const ultimo = ultimoRef.current;
        if (ultimo && ultimo.serial === serial && Date.now() - ultimo.at < REPETICION_MS) return;
        ultimoRef.current = { serial, at: Date.now() };

        setEstado('enviando');
        await enviar(serial, crypto.randomUUID(), false);
      })();
    }, 250);

    return () => {
      activo = false;
      window.clearInterval(timer);
    };
  }, [estado, enviar]);

  if (estado === 'sin-camara') {
    return (
      <main className="pantalla">
        <div className="tarjeta" style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', margin: 0 }}>Sin acceso a la cámara</h1>
          <hr className="regla-dorada" style={{ margin: '1.25rem auto' }} />
          <p className="secundario">
            Autoriza la cámara en los ajustes del navegador. Mientras tanto puedes marcar
            buscando por teléfono.
          </p>
          <button type="button" className="boton" onClick={() => setEstado('pin')}>
            Buscar por teléfono
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="escaner">
      <video ref={videoRef} className="escaner-video" playsInline muted />
      <canvas ref={canvasRef} hidden />

      <div className="escaner-marco" aria-hidden />

      <header className="escaner-barra">
        <span>{enLinea ? 'Listo para escanear' : 'Sin conexión'}</span>
        <span className="escaner-barra-derecha">
          {enCola > 0 && <span className="escaner-pendientes">{enCola} por enviar</span>}
          {estado === 'escaneando' && (
            <button type="button" className="escaner-buscar" onClick={() => setEstado('buscando')}>
              Buscar por teléfono
            </button>
          )}
        </span>
      </header>

      {estado === 'pin' && (
        <PinPad
          onListo={(pin) => {
            pinRef.current = pin;
            setEstado('escaneando');
            void vaciarCola();
          }}
        />
      )}

      {estado === 'buscando' && (
        <Buscador
          obtenerPin={() => pinRef.current}
          onCerrar={() => setEstado('escaneando')}
          onElegir={(serial) => {
            setEstado('enviando');
            void enviar(serial, crypto.randomUUID(), false);
          }}
        />
      )}

      {estado === 'enviando' && <div className="escaner-overlay">Marcando…</div>}

      {estado === 'resultado' && outcome && (
        <Resultado
          outcome={outcome}
          serial={ultimoSerial}
          obtenerPin={() => pinRef.current}
          onCerrar={() => {
            setOutcome(null);
            setEstado(pinRef.current === null ? 'pin' : 'escaneando');
          }}
        />
      )}
    </main>
  );
}

/**
 * Lee un QR del fotograma actual.
 *
 * Safari no implementa BarcodeDetector, así que hay dos caminos: el nativo donde
 * existe (más rápido y sin descargar nada) y zxing-wasm como respaldo, servido
 * desde nuestro propio dominio y no desde un CDN.
 */
async function leerCodigo(
  video: HTMLVideoElement | null,
  canvas: HTMLCanvasElement | null,
): Promise<string | null> {
  if (!video || !canvas || video.readyState < 2) return null;

  const ancho = video.videoWidth;
  const alto = video.videoHeight;
  if (ancho === 0 || alto === 0) return null;

  const detector = await detectorNativo();
  if (detector) {
    try {
      const codes = (await detector.detect(video)) as { rawValue: string }[];
      return codes[0]?.rawValue ?? null;
    } catch {
      return null;
    }
  }

  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, ancho, alto);

  try {
    const { readBarcodes } = await cargarZxing();
    const results = await readBarcodes(ctx.getImageData(0, 0, ancho, alto), {
      formats: ['QRCode'],
      tryHarder: false,
      maxNumberOfSymbols: 1,
    });
    return results[0]?.text ?? null;
  } catch {
    return null;
  }
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

let detectorPromesa: Promise<BarcodeDetectorLike | null> | null = null;

function detectorNativo(): Promise<BarcodeDetectorLike | null> {
  detectorPromesa ??= (async () => {
    const ctor = (
      globalThis as unknown as {
        BarcodeDetector?: {
          new (options: { formats: string[] }): BarcodeDetectorLike;
          getSupportedFormats?: () => Promise<string[]>;
        };
      }
    ).BarcodeDetector;

    if (!ctor) return null;
    try {
      const formats = (await ctor.getSupportedFormats?.()) ?? [];
      if (!formats.includes('qr_code')) return null;
      return new ctor({ formats: ['qr_code'] });
    } catch {
      return null;
    }
  })();
  return detectorPromesa;
}

let zxingPromesa: Promise<typeof import('zxing-wasm/reader')> | null = null;

function cargarZxing(): Promise<typeof import('zxing-wasm/reader')> {
  zxingPromesa ??= (async () => {
    const mod = await import('zxing-wasm/reader');
    mod.prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith('.wasm') ? '/zxing_reader.wasm' : `${prefix}${path}`,
      },
    });
    return mod;
  })();
  return zxingPromesa;
}
