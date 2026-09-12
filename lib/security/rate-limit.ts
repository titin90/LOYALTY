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

export interface LimiteResultado {
  readonly permitido: boolean;
  readonly restantes: number;
  readonly reiniciaEnSegundos: number;
}

export function consumir(
  clave: string,
  maximo: number,
  ventanaSegundos: number,
  ahora: number = Date.now(),
): LimiteResultado {
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
    return { permitido: true, restantes: maximo - 1, reiniciaEnSegundos: ventanaSegundos };
  }

  actual.cuenta += 1;

  return {
    permitido: actual.cuenta <= maximo,
    restantes: Math.max(maximo - actual.cuenta, 0),
    reiniciaEnSegundos: Math.ceil((actual.reiniciaEn - ahora) / 1000),
  };
}

/** Solo para tests. */
export function reiniciarLimites(): void {
  cubetas.clear();
}

/**
 * IP del cliente. Detrás de un proxy, `x-forwarded-for` es la única fuente, y
 * se toma la PRIMERA entrada: las siguientes las puede escribir quien llama.
 */
export function ipDe(headers: Headers): string {
  const reenviada = headers.get('x-forwarded-for');
  if (reenviada) {
    const primera = reenviada.split(',')[0]?.trim();
    if (primera) return primera;
  }
  return headers.get('x-real-ip') ?? 'desconocida';
}
