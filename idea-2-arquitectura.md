# Idea 2 — Arquitectura técnica

*Documento vivo — última actualización: 12 sep 2026. Acompaña a [idea-2-app-fidelizacion.md](idea-2-app-fidelizacion.md) e [idea-2-identidad-visual.md](idea-2-identidad-visual.md).*

## Decisiones cerradas

| Decisión | Elección | Razón corta |
|---|---|---|
| Validador del local | **PWA web** | Sin review de App Store: iteras el flujo cada semana con los primeros locales. Nativo solo cuando haga falta NFC u offline duro (~100 locales). |
| Base de datos + auth | **Supabase (Postgres) + RLS + Drizzle** | El aislamiento por tenant lo impone la base de datos, no el código generado por IA. |
| Alcance MVP | **+ clientes en riesgo y notificaciones vía wallet** | Son el ROI medible que evita el churn de la suscripción en el mes 2. |
| Bono de referido | **Monto fijo, configurable por negocio** | Explicable en una frase, trivial de auditar; cada local elige cuántos puntos. |
| Cliente final | **Nunca instala nada** | Registro web → tarjeta en Apple/Google Wallet → fin del ciclo. |

## Principio rector

> **No confiar en que el código filtre por `tenant_id`. Que lo imponga Postgres.**

El día que se genere un query sin `WHERE tenant_id = ...` se filtran datos de un negocio a otro. Bajo la Ley 21.719 eso es brecha notificable en 72h. Row Level Security no es una capa de defensa extra: es *la* decisión arquitectónica central, y todo lo demás se acomoda a ella.

Corolarios que no se negocian:

- `tenant_id` en **toda** tabla, sin excepciones, incluso donde "obviamente" no hace falta.
- RLS habilitado en **toda** tabla, con política por defecto denegatoria.
- La `service_role` key (que salta RLS) **no se usa en código de aplicación**. Ver "Superficie de bypass" más abajo.

---

## Stack

```
Next.js (App Router) + TypeScript estricto   → panel, registro, PWA del escáner, web service Apple
Postgres (Supabase) + RLS                    → aislamiento impuesto por la BD
Drizzle ORM                                  → queries tipadas + migraciones versionadas
Zod                                          → validación en todo borde de entrada
Supabase Auth                                → staff de los locales (el cliente final no tiene cuenta)
Supabase Storage                             → logos y assets de tarjeta
Inngest                                      → jobs: push a wallets, win-back, digest semanal
Vercel                                       → hosting
Sentry + logs estructurados                  → observabilidad con tenant_id en cada línea
Vercel env / Doppler                         → certificado Apple (.p12, .p8) y service account Google
```

Un lenguaje, un repo, tipos de punta a punta. Construyendo con IA el compilador es quien atrapa lo que nadie va a revisar línea por línea.

**Costo de infra estimado:** < USD 60/mes hasta ~200 locales (Supabase Pro 25, Vercel 20, Sentry free, Inngest free, Apple Developer 99/año).

---

## Estructura del repo

```
/app
  /(public)/r/[tenantSlug]/        registro del cliente + entrega de la tarjeta
  /(public)/p/[serial]/            re-descarga de tarjeta perdida
  /(panel)/[tenantSlug]/           panel del dueño
  /(scan)/scan/                    PWA del escáner (manifest + service worker)
  /api/v1/                         web service de Apple Wallet (protocolo fijo, ver abajo)
  /api/google/                     callbacks de Google Wallet
/lib
  /db/          schema drizzle, migraciones, políticas RLS
  /domain/      LÓGICA PURA sin I/O: puntos, umbrales, referidos, riesgo
  /wallet/      apple/ (firma pkpass, APNs) · google/ (JWT, REST)
  /auth/
  /jobs/        funciones Inngest
/tests
  /domain/      cobertura exhaustiva de /lib/domain
  /isolation/   suite de acceso cruzado entre tenants  ← bloquea el merge
```

`/lib/domain` no importa nada de red ni de base de datos. Es donde vive la plata del cliente y donde los tests son baratos y valen oro.

---

## Modelo de datos

### Las tres decisiones que importan

**1. Los puntos son un ledger append-only, no un número mutable.**

Nunca `UPDATE cards SET points = points + 1`. Un reintento de red con esa sentencia descuadra el programa y pierdes la confianza del dueño el primer mes. El saldo es una proyección que mantiene un trigger, y el ledger es la verdad.

**2. Idempotencia en cada escaneo.** `UNIQUE (tenant_id, idempotency_key)`. Es lo que hace segura la cola offline del escáner: reenviar el mismo evento diez veces suma un punto.

**3. Consentimiento y auditoría son tablas de primera clase**, diseñadas en el esquema inicial — no un sprint de compliance al final.

### Tablas

```sql
-- Negocios y personal
tenants              id, slug, name, plan, status, settings jsonb, created_at
tenant_members       id, tenant_id, user_id, role, pin_hash, name, active
devices              id, tenant_id, name, last_seen_at, revoked_at

-- Clientes (SIEMPRE por tenant — no existe tabla global de personas)
customers            id, tenant_id, name, phone_e164, created_at, deleted_at
                     UNIQUE (tenant_id, phone_e164)
consents             id, tenant_id, customer_id, purpose, version, granted_at, revoked_at

-- Tarjeta
cards                id, tenant_id, customer_id, serial, points_balance,
                     status, created_at             -- 1:1 con customer en v1
card_designs         id, tenant_id, version, config jsonb, published_at
wallet_passes        id, tenant_id, card_id, platform, external_id,
                     auth_token_hash, last_pushed_at
apple_registrations  id, tenant_id, pass_id, device_library_id, push_token

-- Ledger
point_events         id, tenant_id, card_id, delta int, kind, staff_id, device_id,
                     idempotency_key, meta jsonb, created_at
                     UNIQUE (tenant_id, idempotency_key)
                     kind ∈ earn | redeem | welcome_bonus | referral | adjust | expire
rewards              id, tenant_id, name, threshold, active, sort_order
redemptions          id, tenant_id, card_id, reward_id, staff_id, point_event_id, created_at
referrals            id, tenant_id, referrer_customer_id, referred_customer_id,
                     scope, status, rewarded_at
                     scope ∈ intra | cross    -- cross reservado, no se usa en v1

-- Compliance y operación
audit_log            id, tenant_id, actor_type, actor_id, action, target, ip, ua, created_at
dsr_requests         id, tenant_id, customer_id, kind, status, due_at, resolved_at
review_prompts       id, tenant_id, customer_id, sent_at   -- para el tope de 1 cada 90 días
```

### Invariantes en la base de datos, no en el código

```sql
-- El saldo lo mantiene la BD, no la aplicación
CREATE TRIGGER trg_balance AFTER INSERT ON point_events
  FOR EACH ROW EXECUTE FUNCTION apply_point_event();   -- UPDATE cards SET points_balance += NEW.delta

ALTER TABLE cards ADD CONSTRAINT balance_non_negative CHECK (points_balance >= 0);
ALTER TABLE referrals ADD CONSTRAINT no_self_referral
  CHECK (referrer_customer_id <> referred_customer_id);
ALTER TABLE referrals ADD CONSTRAINT one_referral_per_customer
  UNIQUE (tenant_id, referred_customer_id);
```

Todo lo que se pueda expresar como `CHECK`, `UNIQUE`, `NOT NULL` o `FOREIGN KEY` va ahí. Es lo único que la IA no puede saltarse argumentando.

### Extensiones ya previstas (diseñadas, no construidas)

- `point_events.kind` soporta `balance` y `sessions` además de puntos → habilita **membresías prepagadas** (el reposicionamiento a "flujo de caja") sin migrar el ledger.
- `rewards` soporta N premios desde el inicio; la UI de v1 expone **uno solo**.
- `referrals.scope = 'cross'` reserva las **alianzas entre tiendas** (ver abajo).

---

## RLS y superficie de bypass

```sql
-- Qué tenants puede ver el usuario autenticado
CREATE FUNCTION app.current_tenant_ids() RETURNS uuid[] AS $$
  SELECT array_agg(tenant_id) FROM tenant_members
  WHERE user_id = auth.uid() AND active
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Plantilla aplicada a TODAS las tablas
ALTER TABLE <tabla> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <tabla> FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <tabla> FOR ALL TO authenticated
  USING (tenant_id = ANY (app.current_tenant_ids()))
  WITH CHECK (tenant_id = ANY (app.current_tenant_ids()));
```

**Una excepción, encontrada al construir Fase 0:** `tenant_members` lleva `ENABLE` pero no
`FORCE`. Con `FORCE`, evaluar su política invocaría `app.current_tenant_ids()`, que a su vez
consulta `tenant_members` — recursión infinita. Sin `FORCE` solo la salta el dueño de la tabla
(y por lo tanto la función `SECURITY DEFINER`), nunca el rol `authenticated`. La suite de
aislamiento verifica que sea la única tabla en esa situación.

### El footgun de Supabase: la `service_role` key

La `service_role` key salta RLS por completo. Si se usa suelta en código de aplicación, toda la arquitectura de arriba deja de valer.

**Regla:** los flujos públicos (registro del cliente, escaneo, web service de Apple) **no** usan un cliente con `service_role`. Pasan por un conjunto pequeño y cerrado de funciones `SECURITY DEFINER` con firma estrecha:

```
register_customer(tenant_slug, name, phone, referral_code, consent_version)
record_scan(card_serial, staff_pin, device_id, idempotency_key)
redeem_reward(card_serial, reward_id, staff_pin, device_id, idempotency_key)
resolve_apple_pass(serial, auth_token)
```

Así el bypass de RLS queda confinado a **cuatro funciones auditables** en vez de repartido por el código. Cualquier PR que agregue una quinta es revisión humana obligatoria.

---

## Flujos críticos

### Registro del cliente

```
QR del local / link  →  /r/[tenantSlug]
  nombre + teléfono + checkbox de consentimiento (versionado)
  → register_customer()
      crea customer + consent + card
      aplica bono de bienvenida como point_event (NUNCA mostrar el contador en cero)
      si hay código de referido: crea referrals en status 'pending'
  → emite pase Apple + link Save to Google Wallet
  → pantalla con ambos botones, detectando plataforma
```

Sin contraseña, sin correo, sin OTP. **El pase en la wallet es la credencial.** Si lo pierde, `/p/[serial]` lo re-emite — y solo ahí, que es un caso raro, se justifica un OTP por SMS.

Validación de teléfono: formato `+56 9 XXXXXXXX` estricto y confirmación visual en pantalla. Sin verificar, pero sin typos.

### Escaneo (el flujo que decide si el producto vive)

```
PWA abierta en la pantalla de inicio del local
  → cámara (zxing-wasm; Safari NO tiene BarcodeDetector)
  → lee serial del pase
  → PIN de 4 dígitos del empleado
  → record_scan() con idempotency_key generada en el cliente
  → si no hay red: cola en IndexedDB, sincroniza después (seguro por idempotencia)
  → feedback inmediato: nombre, puntos nuevos, "le faltan N para el premio"
  → dispara push a la wallet
```

**≤ 2 taps desde la pantalla de inicio.** Si son cuatro, el barbero deja de escanear y el negocio muere. Esto manda sobre cualquier consideración de diseño.

Respaldo obligatorio: **búsqueda por teléfono** cuando el cliente no tiene el QR a mano (nombre como filtro secundario).

Antifraude: rate limit por tarjeta (máx. 1 `earn` cada N horas, configurable por tenant), PIN por empleado, y `device_id` + `staff_id` en cada evento del ledger.

### Referido

```
registro con código  →  referrals status 'pending'
primer point_event kind 'earn' del referido  →  dispara bono al referente
                                                (monto fijo, configurable por tenant)
                                                status 'paid' + push a la wallet del referente
```

Nunca por registrarse — solo por visita real escaneada. Esta única regla elimina el abuso de cuentas falsas sin infraestructura antifraude.

### Reseñas de Google

Gatillo tras canje o a partir de la 3ª visita, con **tope de una vez cada 90 días por cliente** (tabla `review_prompts`).

⚠️ **Nunca dar puntos a cambio de dejar reseña.** Viola las políticas de Google y puede costarle al negocio su ficha completa. El gatillo es el momento de satisfacción, no un incentivo.

### Clientes en riesgo (win-back)

Job semanal: compara la cadencia propia de cada cliente contra su promedio histórico y lista a quienes la superan por 2x. El panel muestra la lista con un botón por cliente que abre `wa.me` **en el teléfono del dueño** con un mensaje pre-escrito.

No es WhatsApp como canal de la plataforma — es el dueño escribiendo desde su propio número. Cero infra, cero carga de compliance adicional, y es lo único del producto que genera plata atribuible: *"te traje 6 clientes de vuelta este mes"*.

---

## Wallets

### Apple Wallet — la pieza más cara

Es el único pedazo genuinamente difícil del proyecto. Requiere:

1. Apple Developer Program (USD 99/año) + **certificado Pass Type ID**.
2. Firmar bundles `.pkpass` server-side (`passkit-generator` en Node).
3. Implementar el **web service completo** que los dispositivos de Apple llaman. El protocolo es fijo:
   - `POST   /v1/devices/{deviceId}/registrations/{passTypeId}/{serial}`
   - `GET    /v1/devices/{deviceId}/registrations/{passTypeId}?passesUpdatedSince=`
   - `GET    /v1/passes/{passTypeId}/{serial}`
   - `DELETE /v1/devices/{deviceId}/registrations/{passTypeId}/{serial}`
   - `POST   /v1/log`
   - Autenticación por header `Authorization: ApplePass <token>` — no es auth de usuario.
4. **Push por APNs** (token-based, llave `.p8`) para avisar que el pase cambió.

Presupuestar 1-2 semanas. Es el riesgo de calendario número uno.

### Google Wallet — más simple, pero con espera burocrática

`LoyaltyClass` + `LoyaltyObject` vía REST, entregados con un link "Save to Google Wallet" firmado como JWT. Las actualizaciones son un `PATCH` sobre el objeto y llegan casi instantáneas, sin push propio.

⚠️ **El issuer account requiere aprobación de Google y tarda días.** Hay que iniciar el trámite ahora, en paralelo, no cuando toque construir. Hay modo demo para desarrollar mientras tanto.

### La wallet como canal de notificaciones — el arma del producto

Actualizar un pase muestra una **notificación en pantalla bloqueada**. En Apple se activa cuando cambia un campo que declara `changeMessage`; en Google se configura en la clase y se acompaña de mensajes en el objeto.

Traducción: **tienes push directo al cliente sin app instalada, sin costo de SMS y sin API de WhatsApp.** *"Te faltan 2 visitas para tu corte gratis"* en el lockscreen.

Ningún competidor local lo explota bien. Es el argumento central de por qué wallet-first le gana a app-first, y debería estar al centro del pitch de venta.

### Personalización de la tarjeta

`card_designs` guarda config versionada en JSON: logo, imagen de banda, cuatro colores, etiquetas de campos, nombre del premio, estilo (puntos / sellos / nivel). El panel renderiza **preview en vivo de ambas plataformas**. Publicar una versión nueva regenera la plantilla y empuja la actualización a todos los pases del tenant.

Es lo que se ve en la demo de venta y es el diferenciador declarado del proyecto.

---

## Alianzas entre tiendas, sin romper el aislamiento legal

El objetivo comercial ("que entre tiendas se inviten para conseguir descuentos") choca de frente con la decisión de no tener tabla global de personas. **Se resuelve sin romperla**, y conviene dejar el diseño escrito ahora aunque se construya en Fase 2:

En vez de identidad global, **enlace puntual con consentimiento explícito**. La barbería X le ofrece a su cliente: *"La cafetería Y te regala un 15% — ¿activar?"*. Al aceptar se crea un **perfil nuevo y separado en Y**, con su propio `tenant_id` y su propio registro de consentimiento. Lo único que cruza el límite es un **token opaco de atribución**, jamás PII.

Legalmente limpio: cada negocio sigue siendo responsable exclusivo de sus datos, no existe grafo de identidades, y el consentimiento es específico por negocio como exige la ley.

**Lo único que hay que hacer hoy:** `tenant_id` en todo y `referrals.scope = 'cross'` reservado en el enum. Nada más.

---

## Seguridad

| Superficie | Control |
|---|---|
| Aislamiento entre negocios | RLS `FORCE` en todas las tablas + suite de tests de acceso cruzado que bloquea el merge |
| Bypass de RLS | Confinado a 4 funciones `SECURITY DEFINER` de firma estrecha; una quinta exige revisión humana |
| Sesión del local | Cuenta por local + **PIN de 4 dígitos por empleado** (bcrypt/argon2), `staff_id` en cada evento |
| Fraude del personal | Rate limit por tarjeta, audit log de canjes, panel con "quién marcó qué" |
| Pases | `auth_token` por pase, guardado hasheado; rotación al re-emitir |
| Entradas | Zod en todo borde: rutas, server actions, jobs, webhooks |
| Secretos | `.p12`/`.p8` de Apple y service account de Google en secret manager, nunca en el repo. Si se filtran, un tercero emite tarjetas con tu marca |
| Dependencias | Auditoría en CI, Dependabot |
| Revisión | `/security-review` obligatorio en todo PR que toque auth, RLS o el ledger |

---

## Ley 21.719 mapeada a componentes

Vigencia plena: **1 dic 2026**. Las PYMEs tienen un año de gracia; **la plataforma, como encargado de tratamiento, no**.

| Obligación | Componente |
|---|---|
| Responsable = el negocio; encargado = la plataforma | Aislamiento por `tenant_id` + contrato de encargado firmado al alta |
| Consentimiento específico por negocio | Tabla `consents` versionada, capturada en el registro |
| Derechos ARCO | `dsr_requests` + export JSON/CSV y borrado en el panel del dueño, con vencimiento visible |
| Notificación de brecha en 72h | Runbook escrito + alertas Sentry + audit log suficiente para reconstruir el alcance |
| Trazabilidad | `audit_log` en toda operación sobre datos personales |
| Minimización | Solo nombre y teléfono. No pedir RUT, correo ni fecha de nacimiento "por si acaso" |
| Retención | Política de purga de clientes inactivos configurable por tenant |

**El borrado es lógico (`deleted_at`) para el negocio, y físico en el job de purga** — el ledger conserva los eventos anonimizados para cuadratura contable sin PII.

---

## Observabilidad

Vas a debuggear código que no escribiste línea por línea. Sin esto estás ciego:

- Logs estructurados con `tenant_id` y `request_id` en **cada** línea.
- Sentry con el tenant como tag.
- Dashboard operativo propio (no el del cliente): **escaneos por local por semana**. Cuando un local cae a cero, llamas tú antes de que cancele. Esa métrica es tu producto de retención.
- Digest semanal por correo al dueño: clientes nuevos, visitas, canjes. Le recuerda por qué paga.

---

## Testing y CI

**El CI es el único revisor que la IA no puede convencer.** Rojo = no entra.

```
typecheck (strict, cero `any`)
lint
tests de /lib/domain            ← puntos, umbrales, referidos, riesgo
tests de aislamiento            ← acceso cruzado entre tenants, por ruta y por tabla
tests de integración            ← contra Postgres real, no mocks
chequeo de migraciones          ← solo hacia adelante, sin drift
auditoría de dependencias
build
```

### La suite que te salva de la multa

`/tests/isolation` intenta, para **cada ruta y cada tabla**, acceso cruzado entre tenants y exige 403/404. Corre en CI y bloquea el merge. Es el test más importante del proyecto; en un proyecto construido con IA no es opcional.

### Migraciones

Solo hacia adelante, versionadas, **revisadas por humano**. La IA nunca ejecuta SQL destructivo contra producción. Nunca.

---

## Entornos

```
local      Supabase local (Docker) + wallets en modo demo
staging    proyecto Supabase aparte, DATOS ANONIMIZADOS
producción datos reales — nunca se usan para probar (además de ser ilegal ahora)
```

---

## Convenciones para construir con IA

1. **`CLAUDE.md` es el contrato.** Convenciones, mapa de carpetas y una sección explícita de "nunca hagas esto". Es el archivo de mayor apalancamiento del repo. Se escribe antes de la primera línea de código.
2. **Rebanadas verticales, una a la vez.** Una feature completa de punta a punta, testeada, mergeada. Nunca 40 archivos de una: la calidad cae y se pierde la capacidad de revisar.
3. **La lógica de negocio vive en `/lib/domain` como funciones puras.** Es donde un bug le cuesta plata al cliente, y donde los tests son baratos.
4. **Lo que se pueda expresar como invariante de base de datos, va en la base de datos.**
5. **Secretos fuera del código, siempre.**
6. **Un PR que toque RLS, auth o el ledger se revisa a mano.** Sin excepciones.

---

## Roadmap

**Ahora, en paralelo — bloqueantes externos:**
- Apple Developer Program + certificado Pass Type ID
- **Solicitud de issuer account de Google Wallet** ← tarda días, es el que puede frenar todo
- Nombre de marca (bloquea dominio, logo y ambas tarjetas)

| Fase | Duración | Contenido |
|---|---|---|
| **0 — Fundaciones** | 1 sem | Esquema + RLS + auth + CI + `CLAUDE.md` + suite de aislamiento |
| **1 — Espina dorsal** | 3 sem | Registro → tarjeta en ambas wallets → escáner PWA → ledger → canje |
| **2 — Lo que vende** | 2 sem | Panel, personalización con preview, referidos, reseñas, clientes en riesgo, digest |
| **3 — Compliance y hardening** | 2 sem | ARCO, retención, runbook de brecha, contrato de encargado, security review, carga |
| **4 — Piloto** | 2-3 sem | 3 locales reales. Cero features nuevas, solo arreglar lo que se rompa en terreno |

**Total realista: 8-10 semanas.** Quien prometa 3 no contó Apple Wallet.

---

## Pendientes

- Nombre de marca → bloquea dominio, logo, y la aplicación de la paleta a ambas tarjetas.
- Redactar `CLAUDE.md` antes de Fase 0.
- Contrato de encargado de tratamiento (plantilla corta, revisión legal).
- Definir rate limit por defecto de `earn` por tarjeta (propuesta: 1 cada 4 horas).
- Convención de idioma: **identificadores de código y BD en inglés, UI y documentación en español** (ver `CLAUDE.md`).
- Confirmar contra documentación vigente los detalles finos de notificaciones en Google Wallet (`notifyPreference` / mensajes de objeto) al implementar Fase 1.
