/**
 * Límite de peticiones por IP.
 *
 * Implementación en memoria del proceso: en serverless cada instancia lleva su
 * propia cuenta, así que el límite real es el configurado multiplicado por el
 * número de instancias. Es una contención, no una garantía — suficiente contra
 * el abuso torpe, insuficiente contra un ataque distribuido.
 *
 * Cuando haya varias instancias en serio, esto se mueve a un almacén compartido
 * (Redis o Postgres). Las defensas que SÍ son garantías viven en la base de
 * datos: el bloqueo del PIN por dispositivo y el del inicio de sesión.
 */
interface Cubeta {
  cuenta: number;
  reiniciaEn: number;
}

const cubetas = new Map<string, Cubeta>();
const MAX_CLAVES = 10_000;

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

export function consumir(
  clave: string,
  maximo: number,
  ventanaSegundos: number,
  ahora: number = Date.now(),
): RateLimitResult {
  // Purga perezosa: sin esto la tabla crece sin techo con IPs de un solo uso.
  if (cubetas.size > MAX_CLAVES) {
    for (const [k, v] of cubetas) {
      if (v.reiniciaEn <= ahora) cubetas.delete(k);
    }
    if (cubetas.size > MAX_CLAVES) cubetas.clear();
  }

  const actual = cubetas.get(clave);

  if (!actual || actual.reiniciaEn <= ahora) {
    cubetas.set(clave, { cuenta: 1, reiniciaEn: ahora + ventanaSegundos * 1000 });
    return { allowed: true, remaining: maximo - 1, retryAfterSeconds: ventanaSegundos };
  }

  actual.cuenta += 1;

  return {
    allowed: actual.cuenta <= maximo,
    remaining: Math.max(maximo - actual.cuenta, 0),
    retryAfterSeconds: Math.ceil((actual.reiniciaEn - ahora) / 1000),
  };
}

/** Solo para tests. */
export function resetRateLimits(): void {
  cubetas.clear();
}

/**
 * IP del cliente. Detrás de un proxy, `x-forwarded-for` es la única fuente, y
 * se toma la PRIMERA entrada: las siguientes las puede escribir quien llama.
 */
export function clientIp(headers: Headers): string {
  const reenviada = headers.get('x-forwarded-for');
  if (reenviada) {
    const primera = reenviada.split(',')[0]?.trim();
    if (primera) return primera;
  }
  return headers.get('x-real-ip') ?? 'desconocida';
}

export interface RouteLimit {
  readonly patron: RegExp;
  readonly maximo: number;
  readonly ventana: number;
}

/**
 * Qué rutas llevan tope por IP.
 *
 * Vive aquí y no en el middleware para que haya tests sobre los PATRONES. Los
 * tests antiguos probaban solo la cubeta, así que cuando el registro se movió de
 * `/r/` a `/join/` el patrón quedó apuntando a la ruta vieja y el flujo más caro
 * que puede disparar un anónimo se quedó sin límite, sin que nada fallara.
 */
export const LIMITES: readonly RouteLimit[] = [
  // El registro crea filas y firma criptografía: es lo más caro que puede
  // disparar alguien sin sesión.
  { patron: /^\/join\//, maximo: 20, ventana: 60 },
  // El escáner: cada búsqueda y cada marcaje cuesta un bcrypt por miembro.
  { patron: /^\/scan/, maximo: 60, ventana: 60 },
  // Iniciar sesión cuesta un bcrypt por intento.
  { patron: /^\/login/, maximo: 15, ventana: 60 },
  // Emitir un pase firma criptografía.
  { patron: /^\/api\/wallet\//, maximo: 30, ventana: 60 },
  // El web service de Apple: generoso, lo llaman los dispositivos.
  { patron: /^\/api\/v1\//, maximo: 120, ventana: 60 },
];

export function limitFor(ruta: string): RouteLimit | undefined {
  return LIMITES.find((l) => l.patron.test(ruta));
}
