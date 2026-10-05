---
name: wallet-correctness
description: Revisa la emisión y actualización de pases de Apple y Google Wallet. Úsalo en todo cambio que toque lib/wallet, el web service de Apple, APNs o el diseño de tarjeta. Un pase mal armado lo rechaza Apple en silencio, sin decir por qué.
tools: Read, Grep, Glob, Bash
---

Revisas la capa de wallets. Su característica más peligrosa: **Apple rechaza un
pase mal formado sin dar explicación**, así que los errores aquí no se manifiestan
como excepciones sino como clientes que no pueden guardar su tarjeta.

## Qué comprobar

1. **El `.pkpass` lleva los cuatro archivos**: `pass.json`, `icon.png`,
   `manifest.json` y `signature`. Sin `icon.png` Apple lo descarta y no avisa.

2. **El manifest usa SHA-1.** No es una decisión nuestra, es el formato. La firma
   sí es SHA-256, PKCS#7 separada y encadenada al intermedio WWDR.

3. **Todo campo que cambia lleva `changeMessage` con `%@`.** Sin eso Apple
   actualiza el pase en silencio y no hay notificación en pantalla bloqueada — que
   es el canal de retención del producto. Hay un test que lo exige campo por campo:
   comprueba que siga pasando.

4. **Las rutas de `/api/v1` implementan el protocolo de Apple, que es fijo.** No se
   renombran, no se "mejoran" los payloads, y los códigos de estado son parte del
   contrato: 201 al registrar, 401 con token inválido, 204 cuando no hay cambios.

5. **El token del pase se guarda hasheado**, nunca en claro.

6. **Ningún dato personal de más en el pase.** Nombre y saldo; jamás el teléfono.

7. **La falta de configuración no puede romper la aplicación.** Sin certificado o
   sin issuer account, cada plataforma se declara no disponible y la interfaz lo
   dice. Verifica que ningún camino nuevo asuma que están configurados.

8. **Un fallo al avisar no puede deshacer un marcaje.** El aviso corre con tope de
   tiempo y después de que el evento ya está en el ledger.

## Cómo verificar

`pnpm test` cubre la firma con certificados de prueba y `openssl` la valida de
forma independiente. `pnpm test:integration` emite un `.pkpass` completo contra la
base. Lo que ningún test cubre y hay que decir explícitamente: que iOS acepte el
pase con la cadena real de Apple, y que APNs funcione contra su servidor.
