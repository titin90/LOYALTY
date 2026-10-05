# Despliegue

Guía para poner esto en producción. El orden importa: los dos primeros pasos
tienen espera externa y conviene iniciarlos antes de necesitar el resto.

---

## 1 · Issuer account de Google Wallet (días de espera)

Sin esto no hay tarjeta en Android. Inícialo primero.

1. En [Google Cloud Console](https://console.cloud.google.com), crea un proyecto
   y habilita la **Google Wallet API**.
2. Crea una **cuenta de servicio**, descarga su clave JSON y guárdala fuera del
   repositorio.
3. Entra a la [Google Pay & Wallet Console](https://pay.google.com/business/console)
   y regístrate como emisor. Te dan un **Issuer ID** numérico.
4. En esa consola, sección **Google Wallet API → Usuarios**, autoriza el correo
   de la cuenta de servicio del paso 2.
5. Mientras Google revisa tu cuenta puedes emitir pases a correos de prueba que
   agregues allí mismo. La aprobación para público general tarda días.

```bash
GOOGLE_WALLET_ISSUER_ID=3388000000022000000
GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64=$(base64 -i cuenta-servicio.json)
```

## 2 · Certificado de Apple Wallet

No es para publicar una aplicación. Un pase de Apple Wallet es un archivo
**firmado criptográficamente**, y el certificado que lo firma solo se emite a
cuentas del Apple Developer Program. Sin él, el iPhone rechaza el pase sin dar
explicación.

1. Inscríbete en el [Apple Developer Program](https://developer.apple.com/programs/)
   (USD 99 al año).
2. En **Certificates, Identifiers & Profiles → Identifiers**, crea un
   **Pass Type ID** con la forma `pass.cl.tudominio.loyalty`.
3. Genera un certificado para ese Pass Type ID y, desde Acceso a Llaveros,
   expórtalo como `.p12` con contraseña.
4. Descarga el intermedio **Apple Worldwide Developer Relations** desde el portal
   de autoridades de certificación de Apple.
5. En **Keys**, crea una llave de **Apple Push Notification service** y descarga
   el `.p8`. Es lo que avisa al teléfono que su tarjeta cambió. Se descarga una
   sola vez.

```bash
APPLE_PASS_TYPE_ID=pass.cl.tudominio.loyalty
APPLE_TEAM_ID=ABCDE12345
APPLE_PASS_CERT_P12_BASE64=$(base64 -i certificado.p12)
APPLE_PASS_CERT_PASSWORD=la-clave-del-p12
APPLE_WWDR_CERT_PEM=$(base64 -i AppleWWDRCAG4.pem)
APPLE_APNS_KEY_P8_BASE64=$(base64 -i AuthKey_XXXX.p8)
APPLE_APNS_KEY_ID=XXXXXXXXXX
```

## 3 · Base de datos

Un proyecto de Supabase, o cualquier Postgres 17 con `pgcrypto`.

```bash
DATABASE_URL='postgresql://...'   # cadena de conexión directa, no el pooler
ALLOW_REMOTE_MIGRATE=yes pnpm db:migrate
```

Las migraciones solo van hacia adelante y la primera crea los roles `anon` y
`authenticated` si no existen, así que funciona igual en Supabase que en un
Postgres pelado.

## 4 · Secretos de la aplicación

```bash
SESSION_SECRET=$(openssl rand -base64 48)       # sesión del panel
DEVICE_TOKEN_SECRET=$(openssl rand -base64 48)  # credencial del escáner
APP_URL=https://tudominio.cl                    # sin barra final
```

`APP_URL` termina dentro de los pases emitidos como dirección del web service de
Apple. Cambiarla después deja a los pases ya entregados apuntando al dominio
viejo, así que decide el dominio antes de emitir el primero.

## 5 · Vercel

```bash
vercel link
vercel env add DATABASE_URL production     # repite por cada variable
vercel --prod
```

El `vercel.json` del repositorio fija la región **gru1** (São Paulo), la más
cercana a Chile de las disponibles, y programa la purga por retención los
domingos a las 4.

## 6 · Primer negocio

```bash
psql "$DATABASE_URL" <<'SQL'
insert into tenants (slug, name) values ('barberia-don-luis', 'Barbería Don Luis');
insert into tenant_settings (tenant_id) select id from tenants where slug = 'barberia-don-luis';
insert into tenant_members (tenant_id, role, name)
  select id, 'owner', 'Don Luis' from tenants where slug = 'barberia-don-luis';
insert into rewards (tenant_id, name, threshold)
  select id, 'un corte gratis', 6 from tenants where slug = 'barberia-don-luis';
SQL

psql "$DATABASE_URL" -c "select app.set_member_password(
  (select id from tenant_members limit 1), 'duenio@correo.cl', 'una-clave-larga');"
```

Después, desde el panel: **Ajustes** para el enlace de reseñas y los puntos, y
**Equipos** para generar el enlace de emparejamiento del teléfono del local.

## 7 · Qué verificar en el primer despliegue

Tres cosas que no se pueden probar sin credenciales reales ni teléfono:

- **Que el iPhone acepte el pase.** La firma está verificada contra una cadena de
  prueba, pero la cadena real de Apple es otra cosa. Si el pase no se abre, el
  único canal de diagnóstico es `/api/v1/log`, donde los dispositivos de Apple
  reportan por qué lo rechazaron. Revísalo.
- **El push por APNs.** Marca una visita y confirma que el pase se actualiza en el
  teléfono y muestra el aviso en pantalla bloqueada.
- **La cámara del escáner.** Necesita HTTPS; en `localhost` funciona por excepción
  del navegador, desde un teléfono no.

## Rotación de secretos

Rotar `SESSION_SECRET` cierra todas las sesiones del panel. Rotar
`DEVICE_TOKEN_SECRET` desempareja todos los equipos y hay que volver a emparejar
cada teléfono. Ambas cosas son la respuesta correcta ante una filtración — ver
[compliance/runbook-brecha.md](compliance/runbook-brecha.md).
