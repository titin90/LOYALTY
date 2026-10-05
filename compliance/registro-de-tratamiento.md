# Registro de actividades de tratamiento

*Última actualización: 12 sep 2026.*

## Datos que se tratan

### Clientes de los negocios (titulares)

| Dato | Finalidad | Base de legitimación | Retención |
|---|---|---|---|
| Nombre | Identificar al titular en el local y en su tarjeta | Consentimiento | Hasta supresión, o 36 meses sin visitas |
| Teléfono (E.164) | Clave única dentro del negocio y contacto del negocio | Consentimiento | Igual |
| Historial de visitas y canjes | Operar el programa de fidelización | Consentimiento | Conservado **anonimizado** tras la supresión, para la contabilidad del negocio |
| Registro del consentimiento | Demostrar qué se consintió y cuándo | Obligación legal | Se elimina con el titular |

**No se recogen:** RUT, correo, dirección, fecha de nacimiento, ni datos de pago.
La minimización es una regla del repositorio, no una aspiración: agregar un campo
personal exige justificarlo (`CLAUDE.md`, regla 10).

### Personal de los negocios

| Dato | Finalidad | Retención |
|---|---|---|
| Nombre, correo | Acceso al panel | Mientras dure la relación |
| PIN (hash bcrypt) | Atribuir quién marcó cada visita | Igual |

## Destinatarios

- **Apple Inc.** y **Google LLC**, cuando el titular guarda su tarjeta en la wallet.
  Reciben nombre, saldo de puntos y el serial de la tarjeta. **Nunca el teléfono**
  — hay un test automatizado que falla si se filtra.
- **Proveedor de alojamiento** (infraestructura).

No hay venta ni cesión de datos a terceros. No hay elaboración de perfiles
automatizada con efectos jurídicos.

## Transferencias internacionales

La infraestructura y las wallets están fuera de Chile. Debe declararse al titular
en el texto de consentimiento y quedar cubierto en el contrato de encargado.

## Medidas de seguridad

| Medida | Dónde vive |
|---|---|
| Aislamiento por negocio impuesto por la base de datos (RLS) | Migración `0001` |
| Superficie de acceso privilegiado cerrada y auditada | `tests/isolation/schema-invariants.test.ts` |
| Contraseñas y PIN con bcrypt; bloqueo por intentos | Migraciones `0004` y `0008` |
| Registro de auditoría sin datos personales | Tabla `audit_log` |
| Datos personales fuera de los logs | `lib/db/errors.ts` + test que falla si se filtran |
| Cifrado en tránsito (HSTS, CSP) | `middleware.ts` |
| Purga por retención | `scripts/retention.ts` y el cron semanal `/api/cron/retention` |
| Datos reales nunca salen de producción | `CLAUDE.md`, regla 9 |

## Derechos del titular

El titular los ejerce **ante el negocio**, que es el responsable. El panel le da
al negocio las herramientas:

- **Acceso y portabilidad:** exportación en JSON con todo lo guardado.
- **Supresión:** borrado irreversible de nombre, teléfono y consentimientos. El
  historial sobrevive sin ninguna referencia a la persona.
- **Rectificación y oposición:** se registran con su plazo y se atienden a mano.

Plazo de respuesta configurado: **30 días**, con aviso en el panel al vencerse.
