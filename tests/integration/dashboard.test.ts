/**
 * Panel del dueño: autenticación y consultas.
 *
 * Lo que más importa aquí es que NINGUNA consulta del panel filtra por
 * tenant_id: todas corren bajo RLS. Estos tests comprueban que esa confianza
 * está puesta donde corresponde.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { signIn } from '@/lib/auth/login';
import {
  resumen,
  customers,
  atRiskCustomers,
  premios,
  equipos,
  actividad,
  publishedCardDesign,
} from '@/lib/dashboard/queries';
import { registerCard } from '@/lib/registration';
import { recordScan } from '@/lib/scanning';
import { sql, seedTwoTenants, type SeededTenant } from '../isolation/helpers';
import type { DeviceClaims } from '@/lib/device/token';

let a: SeededTenant;
let b: SeededTenant;

beforeEach(async () => {
  [a, b] = await seedTwoTenants();
});

describe('signIn', () => {
  it('acepta las credenciales correctas y devuelve el negocio', async () => {
    const outcome = await signIn({ email: a.email, password: a.password });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.session.tenantId).toBe(a.tenantId);
    expect(outcome.session.tenantSlug).toBe('barberia-a');
    expect(outcome.session.role).toBe('owner');
  });

  it('el correo no distingue mayúsculas ni espacios', async () => {
    const outcome = await signIn({ email: `  ${a.email.toUpperCase()} `, password: a.password });
    expect(outcome.ok).toBe(true);
  });

  it('rechaza la contraseña equivocada', async () => {
    const outcome = await signIn({ email: a.email, password: 'no-es-la-clave' });
    expect(outcome).toMatchObject({ ok: false, kind: 'rejected' });
  });

  it('un correo desconocido da el MISMO mensaje que una contraseña errónea', async () => {
    // Distinguirlos revela qué direcciones están registradas en la plataforma.
    const conocido = await signIn({ email: a.email, password: 'mala' });
    const desconocido = await signIn({ email: 'nadie@ejemplo.cl', password: 'mala' });

    if (conocido.ok || conocido.kind !== 'rejected') throw new Error('esperaba rechazo');
    if (desconocido.ok || desconocido.kind !== 'rejected') throw new Error('esperaba rechazo');
    expect(desconocido.message).toBe(conocido.message);
  });

  it('bloquea tras 8 intentos fallidos', async () => {
    for (let i = 0; i < 8; i += 1) {
      await signIn({ email: a.email, password: 'mala' });
    }
    const outcome = await signIn({ email: a.email, password: a.password });
    if (outcome.ok || outcome.kind !== 'rejected') throw new Error('esperaba rechazo');
    expect(outcome.message).toMatch(/intentos/i);
  });

  it('el contador de intentos SOBREVIVE al fallo', async () => {
    await signIn({ email: a.email, password: 'mala' });
    const [miembro] = await sql<{ failed_login_attempts: number }[]>`
      select failed_login_attempts from public.tenant_members where id = ${a.memberId}
    `;
    expect(miembro!.failed_login_attempts).toBe(1);
  });

  it('un inicio correcto limpia el contador', async () => {
    await signIn({ email: a.email, password: 'mala' });
    await signIn({ email: a.email, password: a.password });
    const [miembro] = await sql<{ failed_login_attempts: number }[]>`
      select failed_login_attempts from public.tenant_members where id = ${a.memberId}
    `;
    expect(miembro!.failed_login_attempts).toBe(0);
  });

  it('no deja entrar a un negocio suspendido', async () => {
    await sql`update public.tenants set status = 'suspended' where id = ${a.tenantId}`;
    const outcome = await signIn({ email: a.email, password: a.password });
    if (outcome.ok || outcome.kind !== 'rejected') throw new Error('esperaba rechazo');
    expect(outcome.message).toMatch(/suspendida/i);
  });

  it('rechaza un correo mal formado antes de tocar la base', async () => {
    const outcome = await signIn({ email: 'no-es-correo', password: 'x' });
    expect(outcome).toMatchObject({ ok: false, kind: 'validation' });
  });

  it('deja rastro del inicio de sesión en el audit_log', async () => {
    await signIn({ email: a.email, password: a.password });
    const filas = await sql<{ action: string }[]>`
      select action from public.audit_log where tenant_id = ${a.tenantId}
    `;
    expect(filas.map((f) => f.action)).toContain('member.login');
  });
});

describe('consultas del panel bajo RLS', () => {
  it('el resumen cuenta solo el propio negocio', async () => {
    await registerCard({ tenantSlug: 'barberia-a', name: 'Ana', phone: '+56911112222', consent: true });
    await registerCard({ tenantSlug: 'cafe-b', name: 'Beto', phone: '+56933334444', consent: true });

    const datos = await resumen(a.userId);
    // El negocio A tiene su cliente sembrado más Ana; el de B no aparece.
    expect(datos.customers).toBe(2);
  });

  it('la lista de clientes nunca incluye los de otro negocio', async () => {
    await registerCard({ tenantSlug: 'cafe-b', name: 'Beto', phone: '+56933334444', consent: true });

    const lista = await customers(a.userId);
    expect(lista.map((c) => c.name)).not.toContain('Beto');
  });

  it('el dueño de B no ve los clientes de A ni con la misma consulta', async () => {
    await registerCard({ tenantSlug: 'barberia-a', name: 'Ana', phone: '+56911112222', consent: true });

    const desdeB = await customers(b.userId);
    expect(desdeB.map((c) => c.name)).not.toContain('Ana');
  });

  it('la búsqueda encuentra por nombre y por teléfono', async () => {
    await registerCard({ tenantSlug: 'barberia-a', name: 'Ana Pérez', phone: '+56911112222', consent: true });

    expect((await customers(a.userId, 'ana')).map((c) => c.name)).toContain('Ana Pérez');
    expect((await customers(a.userId, '1111')).map((c) => c.name)).toContain('Ana Pérez');
    expect(await customers(a.userId, 'zzzz')).toEqual([]);
  });

  it('el teléfono se muestra legible', async () => {
    await registerCard({ tenantSlug: 'barberia-a', name: 'Ana', phone: '+56911112222', consent: true });
    const fila = (await customers(a.userId)).find((c) => c.name === 'Ana');
    expect(fila?.phoneFormatted).toBe('+56 9 1111 2222');
  });

  it('los premios son solo los del propio negocio', async () => {
    const lista = await premios(a.userId);
    expect(lista).toHaveLength(1);
    expect(lista[0]!.name).toBe('Corte gratis');
  });

  it('los equipos son solo los del propio negocio', async () => {
    const lista = await equipos(a.userId);
    expect(lista).toHaveLength(1);
    expect(lista[0]!.name).toBe('Mostrador');
  });

  it('la actividad refleja los marcajes reales', async () => {
    const claims: DeviceClaims = {
      kind: 'device',
      tenantId: a.tenantId,
      deviceId: a.deviceId,
      userId: a.userId,
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    await recordScan({
      serial: a.cardSerial,
      pin: a.staffPin,
      claims,
      idempotencyKey: crypto.randomUUID(),
    });

    const ledger = await actividad(a.userId);
    expect(ledger[0]).toMatchObject({ tipo: 'earn', delta: 1, customer: 'Cliente' });
  });

  it('sin diseño publicado devuelve null', async () => {
    expect(await publishedCardDesign(a.userId)).toBeNull();
  });
});

describe('clientes en riesgo', () => {
  it('no marca a quien tiene menos de tres visitas', async () => {
    expect(await atRiskCustomers(a.userId)).toEqual([]);
  });

  it('marca a quien superó el doble de su propio ritmo', async () => {
    // Tres visitas cada 14 días y la última hace 60: muy por encima de su ritmo.
    for (const dias of [88, 74, 60]) {
      await sql`
        insert into public.point_events (tenant_id, card_id, delta, kind, idempotency_key, created_at)
        values (${a.tenantId}, ${a.cardId}, 1, 'earn', ${'r' + dias},
                now() - make_interval(days => ${dias}))
      `;
    }

    const enRiesgo = await atRiskCustomers(a.userId);
    expect(enRiesgo).toHaveLength(1);
    // now() avanza entre inserciones: la cadencia es ~14 días, no 14 exactos.
    expect(enRiesgo[0]!.risk.cadenceDays).toBeCloseTo(14, 3);
  });

  it('no marca a quien vino hace poco', async () => {
    for (const dias of [30, 16, 2]) {
      await sql`
        insert into public.point_events (tenant_id, card_id, delta, kind, idempotency_key, created_at)
        values (${a.tenantId}, ${a.cardId}, 1, 'earn', ${'ok' + dias},
                now() - make_interval(days => ${dias}))
      `;
    }
    expect(await atRiskCustomers(a.userId)).toEqual([]);
  });

  it('nunca incluye clientes de otro negocio', async () => {
    for (const dias of [88, 74, 60]) {
      await sql`
        insert into public.point_events (tenant_id, card_id, delta, kind, idempotency_key, created_at)
        values (${b.tenantId}, ${b.cardId}, 1, 'earn', ${'x' + dias},
                now() - make_interval(days => ${dias}))
      `;
    }
    expect(await atRiskCustomers(a.userId)).toEqual([]);
    expect(await atRiskCustomers(b.userId)).toHaveLength(1);
  });
});
