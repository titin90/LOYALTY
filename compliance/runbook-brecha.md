# Runbook — brecha de seguridad

*Obligación legal: notificar a la Agencia **dentro de 72 horas** desde que se
toma conocimiento. El reloj parte cuando alguien del equipo se entera, no cuando
se termina de investigar.*

## 0. Antes de nada (minuto 0-15)

1. **No borres nada.** Logs, tablas y respaldos son la evidencia y también lo que
   permite acotar el alcance. Borrar para "limpiar" empeora el incidente.
2. Anota la hora exacta en que te enteraste. Ese es el inicio de las 72 horas.
3. Abre un documento del incidente y registra todo con marca de tiempo.

## 1. Contener (primeras horas)

Según el tipo:

| Sospecha | Acción inmediata |
|---|---|
| Credenciales filtradas | Rotar `SESSION_SECRET` y `DEVICE_TOKEN_SECRET` (cierra todas las sesiones y desempareja los equipos) |
| Secreto del cron filtrado | Rotar `CRON_SECRET`. Habilita la purga por retención, que **borra datos de forma irreversible** en cualquier negocio |
| Clave de base de datos expuesta | Rotar la contraseña de Postgres y revocar conexiones activas |
| Certificado de wallet expuesto | Revocar el Pass Type ID en Apple y el service account en Google |
| Acceso indebido de un empleado de un local | Revocar sus equipos desde el panel y rotar los PIN del negocio |
| Fuga entre negocios (RLS) | **Detener despliegues**, reproducir en staging y corregir antes de seguir |

## 2. Acotar el alcance (día 1)

Preguntas que hay que poder responder, y dónde está la respuesta:

- **¿Qué datos?** → `compliance/registro-de-tratamiento.md`
- **¿De cuántas personas y de qué negocios?** → `audit_log`, filtrando por `tenant_id`
- **¿Desde cuándo?** → primera entrada sospechosa en `audit_log` y logs del proveedor
- **¿Sigue abierta?** → verificado tras la contención

Si no puedes responder "cuántas personas", **notifica igual** con lo que sepas y
actualiza después. El plazo no se detiene mientras investigas.

## 3. Notificar (antes de las 72 horas)

**A la Agencia**, con:
- naturaleza de la brecha y categorías de datos afectados,
- número aproximado de titulares,
- consecuencias probables,
- medidas adoptadas y por adoptar,
- datos de contacto del responsable en la plataforma.

**A cada negocio afectado.** Son los responsables del tratamiento: tienen que
saberlo para decidir si avisan a sus clientes. Escríbeles aunque el alcance aún
no esté cerrado.

**A los titulares**, cuando la brecha suponga un riesgo alto para ellos — por
ejemplo, si se filtraron teléfonos junto con el negocio que frecuentan.

## 4. Después

- Post-mortem sin culpables: qué falló y qué control lo habría evitado.
- **Todo arreglo lleva un test que falla sin él.** Si no se puede escribir ese
  test, el arreglo no está terminado.
- Actualiza este runbook con lo aprendido.

## Contactos

| Rol | Quién | Cómo |
|---|---|---|
| Responsable en la plataforma | *(por completar)* | |
| Apoyo legal | *(por completar)* | |
| Proveedor de alojamiento | *(por completar)* | |

> Completar esta tabla **antes** del primer cliente pagado. Buscar un abogado a
> las 2 de la mañana con el reloj corriendo no es un plan.
