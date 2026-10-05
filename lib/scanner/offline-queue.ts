/**
 * Cola de marcajes sin conexión (solo navegador).
 *
 * La conexión en el mostrador de un local se cae. Un marcaje que no sale se
 * guarda en IndexedDB y se reintenta al volver la señal. Es seguro reenviar
 * porque cada marcaje lleva su `idempotencyKey`: Postgres tiene un índice único
 * por (tenant, clave) y reenviar diez veces suma un punto.
 *
 * El PIN NO se guarda: solo vive en memoria durante el turno. Si el equipo se
 * reinicia con marcajes pendientes, se vuelve a pedir antes de reenviarlos.
 */
export interface QueuedScan {
  readonly idempotencyKey: string;
  readonly serial: string;
  readonly queuedAt: number;
}

const DB_NAME = 'loyalty-scanner';
const STORE = 'pending-scans';
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'idempotencyKey' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB no disponible'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = fn(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('fallo de IndexedDB'));
    });
  } finally {
    db.close();
  }
}

export async function enqueue(scan: QueuedScan): Promise<void> {
  await withStore('readwrite', (store) => store.put(scan));
}

export async function dequeue(idempotencyKey: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(idempotencyKey));
}

export async function pending(): Promise<QueuedScan[]> {
  const all = await withStore<QueuedScan[]>('readonly', (store) => store.getAll());
  return all.sort((a, b) => a.queuedAt - b.queuedAt);
}

/** Una navegación fallida y un error del servidor se tratan distinto: solo el
 *  primero merece reintento. */
export function shouldRetry(failure: string): boolean {
  return failure === 'network' || failure === 'unknown';
}
