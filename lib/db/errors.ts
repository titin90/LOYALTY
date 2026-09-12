/**
 * Los errores de Postgres llegan envueltos en `DrizzleQueryError`, cuyo `message`
 * es **el texto de la consulta con sus parámetros**. Para esta aplicación eso
 * incluye nombres y teléfonos de clientes.
 *
 * Consecuencias, ambas cubiertas por tests:
 *  - El mensaje real del `RAISE` está en la cadena de `cause`, no en `message`.
 *  - El `message` del envoltorio NUNCA debe llegar a un log (CLAUDE.md regla 10).
 */
export function rootCauseMessage(error: unknown): string {
  let current: unknown = error;

  for (let depth = 0; depth < 10; depth += 1) {
    const cause: unknown = current instanceof Error ? current.cause : undefined;
    if (cause === undefined || cause === null) break;
    current = cause;
  }

  return current instanceof Error ? current.message : String(current);
}

/** SQLSTATE del error de Postgres, si viene. */
export function sqlState(error: unknown): string | undefined {
  let current: unknown = error;

  for (let depth = 0; depth < 10; depth += 1) {
    if (current !== null && typeof current === 'object' && 'code' in current) {
      const code = (current as { code: unknown }).code;
      if (typeof code === 'string') return code;
    }
    const cause: unknown = current instanceof Error ? current.cause : undefined;
    if (cause === undefined || cause === null) break;
    current = cause;
  }

  return undefined;
}
