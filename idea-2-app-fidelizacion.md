# Idea 2 — App de fidelización multi-negocio

*Proyecto propio (~80% tuyo), vendible por suscripción a cualquier negocio de servicios recurrentes. Documento vivo — última actualización: 12 sep 2026.*

## Concepto en una frase

Tarjeta de fidelización digital (Apple/Google Wallet) para negocios locales — el cliente acumula puntos con un QR, el negocio paga una suscripción mensual. Caso ancla de lanzamiento: barberías.

## Por qué existe y qué la diferencia

La fidelización en sí no es un diferenciador — todos los competidores (Comeback Loyalty, Fidelya, Ruklo, Flavoo en Chile; Fivestars, TapMango, Loyverse afuera) ya la ofrecen. Los diferenciadores reales son:

1. **Distribución vía el barbero-socio** (300k TikTok / 10k IG, seguido por muchos barberos) — activo no replicable por la competencia.
2. **No obligar a migrar de sistema existente** — llega donde el negocio ya está, no reemplaza su agenda/POS.
3. **Experiencia superior del cliente final** — wallet sin fricción, sin cuenta pesada.
4. **Reposicionamiento a futuro**: vender "flujo de caja" (membresías prepagadas) en vez de "puntos" — ángulo que Comeback y el resto no tienen.

## Contexto legal que define la arquitectura

La **Ley 21.719** de protección de datos personales entra en plena vigencia el **1 de diciembre de 2026**. Crea una Agencia con poder real de fiscalización, derechos ARCO completos, notificación de brechas en 72h, y multas de hasta 20.000 UTM (~1.400 millones de pesos) o 4% de ingresos en reincidencia. Las PYMEs tienen un año de gracia (solo amonestación, no multa), pero **la plataforma —como encargado de tratamiento de datos de muchos negocios— no está cubierta por esa gracia**, así que conviene construir compliant desde el MVP.

Esto define la arquitectura de datos: cada negocio es su propio **responsable de datos** sobre sus clientes; la plataforma es el **encargado de tratamiento**. Implicación de diseño ya decidida:

- **Aislamiento estricto por negocio (tenant).** Cada cliente que se registra genera un perfil separado por negocio (`tenant_id`), incluso si es el mismo número de teléfono en dos negocios distintos. No existe ni existirá en la v1 una tabla global de personas que cruce negocios — se descartó explícitamente por riesgo legal.
- Consentimiento simple en el registro de cada cliente, específico por negocio.
- Contrato corto de tratamiento de datos entre la plataforma y cada negocio que se suma.

## Alcance del MVP

**Incluye:**

- Registro único del cliente por negocio (nombre, teléfono) — sin cuenta pesada, sin contraseña ni verificación por correo.
- Tarjeta digital en **Apple Wallet y Google Wallet**, ambas desde el día uno.
- Bono de bienvenida configurable al registrarse — nunca mostrar el contador en cero (lección aprendida probando Comeback Loyalty en terreno).
- Sistema de puntos genérico y configurable (no "cortes" específicamente) — mismo mecanismo, más flexible.
- **Un solo umbral/premio por negocio** — catálogo de múltiples premios queda para Fase 2.
- Escaneo QR por el encargado del local para sumar puntos.
- **Búsqueda manual por teléfono** como respaldo si el cliente no tiene el QR a mano (búsqueda por nombre como filtro secundario de apoyo).
- Canje marcado por el encargado del local al llegar al umbral.
- Gatillo automático de solicitud de reseña de Google, reutilizando el mismo evento de actualización de la tarjeta (sin canal nuevo). **Tope de una vez cada 90 días por cliente**, y solo tras un canje o a partir de la 3ª visita — pedirla en cada evento parece review farming y molesta al cliente. **Nunca dar puntos a cambio de reseña**: viola las políticas de Google y le puede costar al negocio su ficha completa.
- Panel básico del dueño: lista de clientes, puntos acumulados, canjes del mes, link de reseña de Google configurable.
- **Un solo acceso/login compartido por local** para marcar puntos, con **PIN de 4 dígitos por empleado** encima de esa sesión. Costo casi nulo, resuelve el fraude real del rubro (el empleado canjeando premios para sus amigos), da el audit log que la ley exige igual, y es argumento de venta. Cuentas individuales completas quedan para cuando un cliente real lo pida.
- **Programa de referidos**, dentro del mismo negocio (no cruza tenants):
  - El nuevo cliente ingresa el teléfono (o código/link) de quien lo invitó al registrarse.
  - El bono al referente se dispara solo cuando el amigo gana su **primer punto real** (visita real escaneada por el negocio) — nunca solo por registrarse. Esto ya resuelve el riesgo de abuso por cuentas falsas.
  - El amigo no pierde nada — el bono es extra para quien refirió.
  - Regla anti-abuso mínima: el teléfono del referente no puede ser igual al del nuevo cliente (anti auto-referido).
  - **Modelo cerrado (12 sep 2026): monto fijo de puntos, configurable por negocio.** Se explica en una frase, es predecible para el dueño y trivial de auditar; el porcentaje confunde al cliente y complica el ledger.
- **Notificaciones vía la wallet** — actualizar el pase muestra una notificación en pantalla bloqueada (Apple y Google). Es un canal push directo al cliente **sin app instalada, sin costo de SMS y sin API de WhatsApp**, y viene gratis con la infraestructura de pases que hay que construir igual. Ningún competidor local lo explota bien: es el argumento central de por qué wallet-first le gana a app-first.
- **Vista de clientes en riesgo (win-back)** — lista de quienes no vienen hace más del doble de su propia cadencia, con un botón por cliente que abre WhatsApp **en el teléfono del dueño** con un mensaje pre-escrito. No es WhatsApp como canal de la plataforma: es el dueño escribiendo desde su número, así que no suma carga de compliance. Costo de construcción: una query y un link `wa.me`. Es lo único del producto que genera plata medible y atribuible, y por eso es lo que evita el churn en el mes 2.
- **Digest semanal por correo al dueño** (clientes nuevos, visitas, canjes) — le recuerda por qué está pagando.

**No incluye (Fase 2/3):** catálogo de múltiples premios, feed/marketplace de descubrimiento entre negocios, descuentos generales a registrados, gamificación pesada (rankings, medallas, challenges), agenda/reservas, membresías prepagadas con cobro, WhatsApp como canal, multi-rubro simultáneo, NFC físico en tienda, comisión por transacción, servicio a domicilio, login individual por empleado.

## Modelo de negocio

Suscripción mensual por negocio, sin comisión por transacción. Referencia de mercado usada para ubicar precio: plan básico ~15.000-25.000 CLP/mes, plan superior ~40.000-50.000 CLP/mes (equivalente a rangos de Loyalzoo/Fivestars afuera). Primer mes gratis; 50% de descuento si un negocio refiere a otro (mecanismo de crecimiento B2B, ya validado en la sesión anterior).

## Validación y go-to-market

- El fundador cierra los primeros 20-30 clientes a mano — no delegar en fuerza de venta a comisión todavía (el ticket es demasiado bajo para sostenerla).
- Fase 2/3: activar comisión recurrente (% de MRR, no bono único) con cláusula de clawback si el cliente se va antes de 3 meses, para referidos entre negocios y personas con acceso al nicho (proveedores/distribuidores).
- Con los 2-3 negocios que ya mostraron interés informal: escuchar el problema de fondo que piden, no construir cada feature literal — evitar convertirse en software a medida. Formalizar el trato de "crecer juntos" con límites claros (precio preferente + acceso a feedback a cambio de testimonios, no gratis para siempre ni control del roadmap).

## Riesgo principal del negocio

**No es técnico: es que el encargado del local deje de escanear.** Si no marca las visitas, la tarjeta queda congelada, el cliente la borra de la wallet y el dueño cancela al mes 2. Mitigaciones que son requisitos de diseño, no mejoras:

- El escáner debe estar a **≤2 taps desde la pantalla de inicio** del teléfono del local.
- Métrica operativa propia (no del cliente): **escaneos por local por semana**. Cuando un local cae a cero, se llama antes de que cancele.
- Digest semanal al dueño.

## Pendientes

- Nombre de marca — bloquea dominio, logo y la aplicación de la paleta a ambas tarjetas.
- Guion de venta para presentar esto al barbero-socio, ahora que su rol se reencauzó hacia la Idea 1.
- Contrato de encargado de tratamiento (plantilla corta + revisión legal) antes del primer cliente pagado.

## Documentos relacionados

- [idea-2-arquitectura.md](idea-2-arquitectura.md) — stack, modelo de datos, RLS, wallets, compliance y roadmap.
- [idea-2-identidad-visual.md](idea-2-identidad-visual.md) — paleta, tipografía y tono.
