# Plataforma de fidelización

Tarjeta de fidelización digital en Apple/Google Wallet para negocios locales. El
cliente final **no instala nada**: se registra por web y guarda su tarjeta en la
wallet del teléfono.

- **Qué se construye y por qué:** [idea-2-app-fidelizacion.md](idea-2-app-fidelizacion.md)
- **Arquitectura:** [idea-2-arquitectura.md](idea-2-arquitectura.md)
- **Reglas del repo:** [CLAUDE.md](CLAUDE.md) ← léelo antes de escribir código
- **Identidad visual:** [idea-2-identidad-visual.md](idea-2-identidad-visual.md)

## Puesta en marcha

```bash
corepack enable pnpm
pnpm install
cp .env.example .env
```

Levanta un Postgres para desarrollo:

```bash
# Homebrew (lo que está instalado en la máquina de desarrollo actual)
brew install postgresql@17
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
pg_ctl -D /opt/homebrew/var/postgresql@17 -o "-p 54322" -l /tmp/pg17.log start
psql -p 54322 -d postgres -c "create role postgres superuser login password 'postgres';"

# o Docker
docker run -d --name loyalty-db -p 54322:5432 -e POSTGRES_PASSWORD=postgres postgres:17
```

Para detenerlo: `pg_ctl -D /opt/homebrew/var/postgresql@17 stop`

Aplica el esquema y verifica:

```bash
pnpm db:migrate
pnpm test           # lógica de dominio (no necesita base de datos)
pnpm test:isolation # aislamiento entre negocios (necesita base de datos)
```

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Aplicación en local |
| `pnpm typecheck` / `pnpm lint` | Chequeos estáticos |
| `pnpm test` | Tests de `lib/domain` — puros, sin base de datos |
| `pnpm test:isolation` | Suite de aislamiento entre negocios |
| `pnpm db:generate` | Genera una migración desde `lib/db/schema.ts` |
| `pnpm db:migrate` | Aplica migraciones pendientes (solo hacia adelante) |

## Estado

**Fase 1 en curso.** Fase 0 completa y verificada.

### Fase 1

| Pieza | Estado |
|---|---|
| Registro del cliente (`/r/[slug]`) | ✅ |
| Escáner PWA con emparejamiento de equipo y PIN | ✅ |
| Cola de marcajes sin conexión (IndexedDB) | ✅ |
| Canje de premios | ✅ |
| Pases de Apple/Google Wallet | ⏳ bloqueado por certificado e issuer account |

Probar el escáner en local:

```bash
pnpm tsx scripts/pair-device.ts <slug-del-negocio> "Mostrador"
# abre el enlace que imprime, en el teléfono o en el navegador
```

### Fase 0

| Pieza | Estado |
|---|---|
| Esquema: 17 tablas, `tenant_id` en todas | ✅ |
| RLS + políticas de aislamiento | ✅ |
| Ledger append-only con saldo por trigger | ✅ |
| Superficie `SECURITY DEFINER`: 4 funciones | ✅ |
| Lógica de dominio pura | ✅ 53 tests |
| Suite de aislamiento entre negocios | ✅ 59 tests |
| CI (typecheck, lint, tests, deriva, build, audit) | ✅ |

La suite de aislamiento se validó por mutación: al quitar una política, al permitir
que la aplicación escriba el saldo, al sacar la guardia append-only y al exponer una
quinta función `SECURITY DEFINER`, el CI cae en cada caso.

Sin interfaz todavía. La **Fase 1** construye el registro del cliente, la emisión de
pases Apple/Google y la PWA del escáner.
