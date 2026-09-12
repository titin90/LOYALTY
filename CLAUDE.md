# CLAUDE.md — contrato del proyecto

Plataforma de fidelización multi-negocio. El cliente final se registra por web y guarda una tarjeta en Apple/Google Wallet **sin instalar nada**; el local marca visitas desde una PWA; el dueño administra desde un panel web. Multi-tenant con aislamiento estricto por exigencia legal (Ley 21.719, Chile).

**Contexto completo — léelos antes de proponer cambios de diseño:**

- [idea-2-app-fidelizacion.md](idea-2-app-fidelizacion.md) — qué se construye y qué **no**, y por qué.
- [idea-2-arquitectura.md](idea-2-arquitectura.md) — stack, modelo de datos, RLS, wallets, compliance, roadmap.
- [idea-2-identidad-visual.md](idea-2-identidad-visual.md) — paleta, tipografía, tono.

---

## ⛔ Reglas que nunca se rompen

Si una tarea parece exigir romper una de estas, **detente y pregunta**. No la sortees, no la rodees, no la "adaptes".

### Aislamiento entre negocios

1. **Ninguna tabla sin `tenant_id`.** Sin excepciones, ni siquiera donde "obviamente" no hace falta.
2. **Ninguna tabla sin `ENABLE` + `FORCE ROW LEVEL SECURITY`** y su política de aislamiento.
   Única excepción, verificada por la suite: `tenant_members` lleva `ENABLE` sin `FORCE`, porque
   `app.current_tenant_ids()` la consulta y con `FORCE` la política se llamaría a sí misma
   (recursión infinita). Cualquier otra tabla sin `FORCE` rompe el CI.
3. **La `service_role` key de Supabase no se usa en código de aplicación.** Salta RLS por completo.
   Los flujos sin sesión pasan solo por funciones `SECURITY DEFINER` de firma estrecha, y la lista
   está cerrada en `tests/isolation/schema-invariants.test.ts`. **Agregar una exige aprobación
   humana explícita**: el test falla y hay que editarlo a mano, que es justamente el punto.

   Superficie actual (8): `register_customer`, `record_scan`, `redeem_reward`, `pass_payload`,
   `authenticate_member`, `apple_register_device`, `apple_unregister_device`,
   `apple_updated_serials`. Las tres de Apple existen porque sus dispositivos llaman al web
   service sin sesión de usuario, y `authenticate_member` porque iniciar sesión es, por
   definición, una operación previa a tener sesión.

   Antes de agregar una, agota estas salidas: ¿se puede resolver bajo RLS con una sesión de
   usuario? ¿Se puede generalizar una función existente en vez de sumar otra? ¿Basta una vista
   acotada a datos que ya son públicos, como `tenant_public`?

> Una filtración entre tenants es una brecha notificable en 72h bajo la Ley 21.719, con multas de hasta 20.000 UTM. Estas tres reglas son el proyecto entero.

### Ledger de puntos

4. **Nunca `UPDATE cards SET points_balance = ...`.** El saldo lo mantiene un trigger. La única forma de mover puntos es `INSERT INTO point_events`.
5. **Ninguna mutación de puntos sin `idempotency_key`** generada en el cliente. Es lo que hace segura la cola offline del escáner: reenviar el mismo evento diez veces suma un punto.
6. **El ledger es append-only.** No se hace `UPDATE` ni `DELETE` sobre `point_events`. Para corregir, se inserta un evento `adjust`.

### Datos y migraciones

7. **Migraciones solo hacia adelante, versionadas, revisadas por humano.** Nunca ejecutar SQL destructivo (`DROP`, `TRUNCATE`, `DELETE` sin `WHERE`) contra ninguna base que no sea local.
8. **Secretos jamás en el repo.** `.p12` y `.p8` de Apple, service account de Google, keys de Supabase. Si se filtran, un tercero emite tarjetas con nuestra marca.
9. **Datos reales de clientes nunca salen de producción.** Staging y local usan datos anonimizados. Además de mala práctica, ahora es ilegal.
10. **Minimización:** solo nombre y teléfono. No agregar RUT, correo, fecha de nacimiento ni dirección "por si acaso" — cada campo extra es exposición legal sin valor de producto.

### Producto

11. **Nunca dar puntos a cambio de una reseña de Google.** Viola las políticas de Google y le puede costar al negocio su ficha completa.
12. **El bono de referido se paga con el primer `earn` real del referido**, nunca por registrarse. Es la única defensa antifraude del programa.
13. **Nunca mostrar el contador de puntos en cero.** Todo cliente nuevo recibe el bono de bienvenida en el mismo momento del registro.

### Código

14. **Nunca leer ni registrar el `message` de un error de base de datos.** Drizzle envuelve el
    error de Postgres y ese `message` es **el texto de la consulta con sus parámetros** — o sea,
    nombres y teléfonos de clientes. El mensaje real está en la cadena de `cause`: usa
    `rootCauseMessage()` de `lib/db/errors.ts`. Hay un test que falla si un teléfono llega a un log.
15. **Sin `any`, sin `@ts-ignore`, sin `eslint-disable`** salvo con un comentario que explique por qué, en la misma línea.
16. **Toda entrada externa se valida con Zod en el borde**: rutas, server actions, jobs, webhooks, payloads de wallet.
17. **Nunca modificar o saltar un test para que pase.** Si un test falla, o el código está mal o el test estaba mal — y lo segundo se argumenta, no se asume.

---

## Idioma

| Qué | Idioma |
|---|---|
| Identificadores de código (variables, funciones, tipos, archivos) | **Inglés** |
| Tablas, columnas, enums, constraints, funciones SQL | **Inglés** |
| Textos de interfaz | **Español (Chile)** |
| Comentarios, commits, documentación | **Español** |

Sin mezclas. `customer.phone_e164`, nunca `cliente.telefono`.

---

## Stack

```
Next.js (App Router) + TypeScript estricto
Postgres (Supabase) + RLS · Drizzle ORM · Zod
Supabase Auth (staff de locales) · Supabase Storage (logos)
Inngest (jobs) · Vercel (hosting) · Sentry (errores)
```

El cliente final **no tiene cuenta**. Su credencial es el pase en la wallet.

### Comandos

> Se completan al cerrar la Fase 0; hasta entonces el proyecto es solo documentación.

```bash
pnpm dev              # app en local
pnpm db:start         # Supabase local (Docker)
pnpm db:migrate       # aplicar migraciones
pnpm db:generate      # generar migración desde el schema de Drizzle
pnpm test             # unitarios (/lib/domain)
pnpm test:isolation   # suite de acceso cruzado entre tenants
pnpm typecheck
pnpm lint
```

---

## Mapa de carpetas

```
/app
  /(public)/r/[tenantSlug]/   registro del cliente + entrega de la tarjeta
  /(public)/p/[serial]/       re-descarga de tarjeta perdida
  /(panel)/[tenantSlug]/      panel del dueño
  /(scan)/scan/               PWA del escáner
  /api/v1/                    web service de Apple Wallet — protocolo FIJO, no inventar rutas
  /api/google/                callbacks de Google Wallet
/lib
  /db/       schema Drizzle, migraciones, políticas RLS
  /domain/   lógica pura sin I/O: puntos, umbrales, referidos, riesgo
  /wallet/   apple/ (firma .pkpass, APNs) · google/ (JWT, REST)
  /auth/
  /jobs/     funciones Inngest
/tests
  /domain/     cobertura exhaustiva de /lib/domain
  /isolation/  acceso cruzado entre tenants — bloquea el merge
```

**`/lib/domain` no importa red ni base de datos.** Ahí vive la plata del cliente: funciones puras, testeadas exhaustivamente. Si una función de dominio necesita consultar la BD, el diseño está mal — recibe los datos como argumento.

**`/api/v1` implementa el protocolo de Apple Wallet**, que es fijo y lo definen ellos. No renombrar rutas, no "mejorar" la forma de los payloads, no agregar auth de usuario (usa el header `Authorization: ApplePass <token>`).

---

## Base de datos

- Todo lo expresable como invariante va en la BD: `CHECK`, `UNIQUE`, `NOT NULL`, `FOREIGN KEY`. Es lo único que no se puede sortear con un argumento.
- El borrado de clientes es **lógico** (`deleted_at`) para el negocio y **físico** en el job de purga. El ledger conserva los eventos anonimizados para cuadratura.
- Índices: toda query del panel filtra por `tenant_id` primero. Los índices compuestos empiezan por `tenant_id`.
- **Nombra la columna explícitamente cuando el identificador lleva dígitos.** La derivación
  automática de Drizzle parte en el límite del dígito: `phoneE164` produce `phone_e_164`.
  Se escribe `text('phone_e164')`.
- **Suprimir a una persona no puede destruir el ledger.** `cards.customer_id` es nulo y su
  clave foránea es `ON DELETE SET NULL` justamente por eso: en cascada, borrar un cliente
  arrastraba su tarjeta y todas sus visitas. Hay tests que lo fijan.
- **Los documentos de `compliance/` están atados al código por tests.** Si cambias el texto del
  consentimiento, el plazo ARCO o el nombre de una variable de entorno del runbook, el CI cae.
  Actualiza ambos.
- **Los tests de dominio corren sin base de datos** (`tests/domain/setup.ts` borra `DATABASE_URL`).
  Si un módulo de lógica pura empieza a arrastrar el cliente de Postgres, fallan de inmediato.
- Las funciones de trigger también son `SECURITY DEFINER`: revócales `EXECUTE` a `PUBLIC`.
  Postgres lo concede por defecto y la suite exige que la superficie expuesta sean exactamente
  las cuatro RPC.

---

## Testing

- **`/lib/domain`: cobertura exhaustiva.** Puntos, umbrales, referidos, cálculo de riesgo. Un bug ahí le cuesta plata al cliente y nos cuesta la cuenta.
- **`/tests/isolation`:** para cada ruta y cada tabla, intentar acceso cruzado entre tenants y exigir 403/404. Es el test más importante del repo.
- Integración contra **Postgres real**, no mocks.
- Todo PR que agregue una ruta agrega su caso de aislamiento. Sin eso, no entra.

---

## Flujo de trabajo

1. **Una rebanada vertical a la vez**: una feature completa de punta a punta, testeada, mergeada. Nunca 40 archivos de una sola vez — la calidad cae y se pierde la capacidad de revisar.
2. **CI verde es la condición de merge**: typecheck, lint, tests, aislamiento, migraciones, auditoría de dependencias, build.
3. **Revisión humana obligatoria** en todo PR que toque RLS, auth, el ledger o las funciones `SECURITY DEFINER`.
4. Antes de dar una tarea por terminada: typecheck + lint + tests pasan, y si tocaste datos personales, el `audit_log` registra la operación.

---

## Invariantes de producto que mandan sobre el diseño técnico

- **El escáner debe estar a ≤2 taps desde la pantalla de inicio del teléfono del local.** Si son cuatro, el barbero deja de escanear y el negocio muere. Esto gana cualquier discusión de arquitectura de navegación.
- **Búsqueda por teléfono siempre disponible** como respaldo cuando el cliente no tiene el QR a mano.
- **Feedback inmediato en el escaneo**: nombre del cliente, puntos sumados, cuántos le faltan.
- **Cada evento de puntos empuja la actualización a la wallet.** La notificación en pantalla bloqueada es nuestro canal de retención y es gratis — no se omite por "optimizar".

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
