/**
 * Derechos ARCO. El caso que más importa: suprimir a una persona no puede
 * destruir la contabilidad del negocio, y lo que sobrevive no puede identificarla.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  exportarCliente,
  suprimirCliente,
  registrarSolicitud,
  solicitudes,
  resolverSolicitud,
  DSR_PLAZO_DIAS,
} from '@/lib/panel/dsr';
import { passPayload } from '@/lib/wallet/issue';
import { recordScan } from '@/lib/scanning';
import { clientes } from '@/lib/panel/queries';
import { sql, seedTwoTenants, type SeededTenant } from '../isolation/helpers';
import type { DeviceClaims } from '@/lib/device/token';

let a: SeededTenant;
let b: SeededTenant;

const claimsFor = (t: SeededTenant): DeviceClaims => ({
  kind: 'device',
  tenantId: t.tenantId,
  deviceId: t.deviceId,
  userId: t.userId,
  exp: Math.floor(Date.now() / 1000) + 3600,
});

beforeEach(async () => {
  [a, b] = await seedTwoTenants();
  await sql`
    insert into public.point_events (tenant_id, card_id, delta, kind, idempotency_key)
    values (${a.tenantId}, ${a.cardId}, 3, 'earn', 'previo')
  `;
});

describe('exportarCliente', () => {
  it('entrega todo lo que la plataforma guarda de la persona', async () => {
    const datos = await exportarCliente(a.userId, a.customerId);

    expect(datos?.titular.nombre).toBe('Cliente');
    expect(datos?.titular.telefono).toMatch(/^\+569/);
    expect(datos?.tarjeta?.saldo).toBe(3);
    expect(datos?.movimientos).toHaveLength(1);
    expect(datos?.movimientos[0]).toMatchObject({ tipo: 'earn', puntos: 3 });
  });

  it('el dueño de otro negocio no puede exportar a este cliente', async () => {
    expect(await exportarCliente(b.userId, a.customerId)).toBeNull();
  });

  it('null para un cliente que no existe', async () => {
    expect(await exportarCliente(a.userId, crypto.randomUUID())).toBeNull();
  });
});

describe('suprimirCliente', () => {
  it('borra los datos personales de verdad', async () => {
    await suprimirCliente(a.userId, a.customerId);

    const filas = await sql`select 1 from public.customers where id = ${a.customerId}`;
    expect(filas).toHaveLength(0);

    const consentimientos = await sql`
      select 1 from public.consents where customer_id = ${a.customerId}
    `;
    expect(consentimientos).toHaveLength(0);
  });

  it('CONSERVA el ledger: la supresión no destruye la contabilidad', async () => {
    const resultado = await suprimirCliente(a.userId, a.customerId);
    expect(resultado).toMatchObject({ ok: true, movimientosConservados: 1 });

    const eventos = await sql`select 1 from public.point_events where card_id = ${a.cardId}`;
    expect(eventos).toHaveLength(1);
  });

  it('lo que sobrevive no apunta a ninguna persona', async () => {
    await suprimirCliente(a.userId, a.customerId);

    const [tarjeta] = await sql<{ customer_id: string | null; status: string }[]>`
      select customer_id, status from public.cards where id = ${a.cardId}
    `;
    expect(tarjeta!.customer_id).toBeNull();
    expect(tarjeta!.status).toBe('closed');
  });

  it('la tarjeta suprimida deja de emitir pases', async () => {
    await suprimirCliente(a.userId, a.customerId);
    expect(await passPayload(a.cardSerial)).toBeNull();
  });

  it('la tarjeta suprimida ya no suma visitas en el escáner', async () => {
    await suprimirCliente(a.userId, a.customerId);

    const outcome = await recordScan({
      serial: a.cardSerial,
      pin: a.staffPin,
      claims: claimsFor(a),
      idempotencyKey: crypto.randomUUID(),
    });
    expect(outcome).toMatchObject({ ok: false, failure: 'card_blocked' });
  });

  it('desaparece de la lista de clientes del panel', async () => {
    await suprimirCliente(a.userId, a.customerId);
    expect(await clientes(a.userId)).toEqual([]);
  });

  it('deja rastro en el audit_log, que no guarda datos personales', async () => {
    await suprimirCliente(a.userId, a.customerId);

    const filas = await sql<{ action: string }[]>`
      select action from public.audit_log where tenant_id = ${a.tenantId}
    `;
    expect(filas.map((f) => f.action)).toContain('customer.erase');

    const contenido = JSON.stringify(filas);
    expect(contenido).not.toMatch(/\+?569\d{8}/);
  });

  it('el dueño de otro negocio no puede suprimir a este cliente', async () => {
    const resultado = await suprimirCliente(b.userId, a.customerId);
    expect(resultado).toEqual({ ok: false, motivo: 'no_encontrado' });

    const filas = await sql`select 1 from public.customers where id = ${a.customerId}`;
    expect(filas).toHaveLength(1);
  });

  it('borra los pases de wallet emitidos', async () => {
    await sql`
      insert into public.wallet_passes (tenant_id, card_id, platform, external_id)
      values (${a.tenantId}, ${a.cardId}, 'apple', 'x')
    `;
    await suprimirCliente(a.userId, a.customerId);
    expect(await sql`select 1 from public.wallet_passes where card_id = ${a.cardId}`).toHaveLength(0);
  });
});

describe('solicitudes ARCO', () => {
  it('se registran con su plazo legal', async () => {
    await registrarSolicitud(a.userId, a.tenantId, a.customerId, 'deletion');

    const lista = await solicitudes(a.userId);
    expect(lista).toHaveLength(1);
    expect(lista[0]!.tipo).toBe('deletion');
    expect(lista[0]!.estado).toBe('open');
    expect(lista[0]!.cliente).toBe('Cliente');

    const dias = (lista[0]!.venceEl.getTime() - lista[0]!.creadaEl.getTime()) / 86_400_000;
    expect(Math.round(dias)).toBe(DSR_PLAZO_DIAS);
  });

  it('marca como vencida la que pasó su plazo', async () => {
    await sql`
      insert into public.dsr_requests (tenant_id, customer_id, kind, due_at)
      values (${a.tenantId}, ${a.customerId}, 'access', now() - interval '1 day')
    `;
    expect((await solicitudes(a.userId))[0]!.vencida).toBe(true);
  });

  it('una resuelta deja de estar vencida', async () => {
    await sql`
      insert into public.dsr_requests (tenant_id, customer_id, kind, due_at)
      values (${a.tenantId}, ${a.customerId}, 'access', now() - interval '1 day')
    `;
    const [solicitud] = await solicitudes(a.userId);
    await resolverSolicitud(a.userId, solicitud!.id);

    const despues = (await solicitudes(a.userId))[0]!;
    expect(despues.estado).toBe('resolved');
    expect(despues.vencida).toBe(false);
  });

  it('el dueño de otro negocio no ve estas solicitudes', async () => {
    await registrarSolicitud(a.userId, a.tenantId, a.customerId, 'deletion');
    expect(await solicitudes(b.userId)).toEqual([]);
  });
});
