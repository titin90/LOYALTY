# Contrato de tratamiento de datos personales

> **Plantilla. Necesita revisión legal antes de firmarse con el primer cliente
> pagado.** La escribió el equipo técnico para que el contenido operativo sea
> correcto y verificable contra lo que el sistema realmente hace, no para
> sustituir a un abogado.

---

Entre **[NOMBRE DEL NEGOCIO]**, RUT [·], en adelante **el Responsable**, y
**[NOMBRE DE LA PLATAFORMA]**, RUT [·], en adelante **el Encargado**, se acuerda
lo siguiente respecto del tratamiento de datos personales, conforme a la
Ley 21.719.

## 1. Objeto

El Encargado trata datos personales de los clientes del Responsable con la única
finalidad de operar el programa de fidelización contratado.

## 2. Roles

El **Responsable** determina las finalidades y los medios del tratamiento. El
**Encargado** trata los datos únicamente siguiendo sus instrucciones documentadas
y las funcionalidades del servicio.

## 3. Datos tratados

Nombre y número de teléfono de los clientes que se registran voluntariamente, e
historial de visitas y canjes en el negocio del Responsable.

El Encargado **no recoge** RUT, correo, dirección, fecha de nacimiento ni datos
de pago de los clientes.

## 4. Obligaciones del Encargado

1. Tratar los datos solo para la finalidad del punto 1.
2. Mantener los datos de cada Responsable **aislados** de los de cualquier otro.
   El aislamiento lo impone la base de datos, no la aplicación, y se verifica de
   forma automatizada en cada cambio del sistema.
3. No existe ninguna tabla que cruce clientes entre distintos Responsables.
4. Aplicar medidas técnicas y organizativas apropiadas: cifrado en tránsito,
   credenciales con hash, registro de auditoría y control de acceso.
5. **Notificar al Responsable sin dilación indebida** ante cualquier brecha, y en
   todo caso dentro de las **24 horas** desde que tome conocimiento, para que
   pueda cumplir sus propios plazos.
6. Asistir al Responsable en la atención de los derechos de sus titulares,
   poniendo a su disposición la exportación y la supresión de los datos.
7. No subcontratar sin autorización previa, salvo los subencargados del Anexo A.
8. Al terminar el contrato, **eliminar o devolver** los datos según elija el
   Responsable, dentro de los 30 días siguientes.

## 5. Obligaciones del Responsable

1. Obtener el consentimiento de sus clientes e informarles la finalidad. El
   Encargado le provee el texto y registra cada consentimiento con su versión.
2. Dar instrucciones lícitas.
3. Atender los derechos de sus titulares dentro de los plazos legales, usando las
   herramientas del panel.

## 6. Subencargados (Anexo A)

| Subencargado | Para qué | Dónde |
|---|---|---|
| [Proveedor de alojamiento] | Infraestructura y base de datos | [·] |
| Apple Inc. | Entrega de la tarjeta en Apple Wallet | EE. UU. |
| Google LLC | Entrega de la tarjeta en Google Wallet | EE. UU. |

A Apple y Google se transmiten el nombre del cliente, su saldo de puntos y el
identificador de su tarjeta. **No se les transmite el número de teléfono.**

## 7. Transferencias internacionales

El Responsable autoriza las transferencias del Anexo A, necesarias para prestar
el servicio, y declara haberlo informado a sus titulares.

## 8. Retención

Los datos se conservan mientras dure el contrato. Además:

- Un cliente suprimido se elimina de forma irreversible; su historial de visitas
  se conserva **sin ninguna referencia a la persona**, para la contabilidad del
  Responsable.
- Los clientes sin actividad durante 36 meses se purgan automáticamente.

## 9. Auditoría

El Responsable puede solicitar, una vez al año, información sobre las medidas de
seguridad aplicadas.

## 10. Vigencia

Este contrato rige mientras esté vigente la prestación del servicio, y sus
obligaciones de confidencialidad sobreviven a su término.

---

Firmado en [·], a [·].

**Por el Responsable** ______________________  
**Por el Encargado** ______________________

---

### Anexo B — Texto de consentimiento vigente

Versión `2026-09-v1`, mostrada al cliente al registrarse:

> Autorizo a este negocio a guardar mi nombre y teléfono para administrar mi
> tarjeta de fidelización y avisarme de mis beneficios. Puedo pedir acceder a mis
> datos o eliminarlos en cualquier momento.

Cambiar este texto exige subir la versión: cada registro guarda la versión que se
mostró, para poder demostrar a qué consintió cada persona.
