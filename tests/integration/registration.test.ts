/**
 * Registro del cliente, de punta a punta contra una base de datos real:
 * validación Zod → función SQL → tarjeta creada con su consentimiento.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { registerCard } from '@/lib/registration';
import { getPublicTenant } from '@/lib/db/public-queries';
import { sql, seedTwoTenants, type SeededTenant } from '../isolation/helpers';

let a: SeededTenant;

beforeEach(async () => {
  [a] = await seedTwoTenants();
});

const valid = {
  tenantSlug: 'barberia-a',
  name: 'Ana Pérez',
  phone: '+56 9 1111 2222',
  consent: true,
};

describe('getPublicTenant', () => {
  it('entrega los datos públicos del negocio', async () => {
    const tenant = await getPublicTenant('barberia-a');
    expect(tenant?.name).toBe('barberia-a');
    expect(tenant?.welcomeBonusPoints).toBe(1);
    expect(tenant?.rewards[0]?.threshold).toBe(5);
  });

  it('null para un negocio que no existe', async () => {
    expect(await getPublicTenant('no-existe')).toBeNull();
  });

  it('null para un negocio suspendido', async () => {
    await sql`update public.tenants set status = 'suspended' where id = ${a.tenantId}`;
    expect(await getPublicTenant('barberia-a')).toBeNull();
  });
});

describe('registerCard', () => {
  it('crea la tarjeta y normaliza el teléfono a E.164', async () => {
    const outcome = await registerCard(valid);
    expect(outcome).toMatchObject({ ok: true, created: true });

    const [customer] = await sql<{ phone_e164: string; name: string }[]>`
      select phone_e164, name from public.customers where tenant_id = ${a.tenantId}
        and name = 'Ana Pérez'
    `;
    expect(customer!.phone_e164).toBe('+56911112222');
  });

  it('la tarjeta nace con el bono de bienvenida, nunca en cero', async () => {
    const outcome = await registerCard(valid);
    if (!outcome.ok) throw new Error('esperaba éxito');

    const [card] = await sql<{ points_balance: number }[]>`
      select points_balance from public.cards where serial = ${outcome.serial}
    `;
    expect(card!.points_balance).toBeGreaterThan(0);
  });

  it('guarda el consentimiento con su versión', async () => {
    await registerCard(valid);
    const [consent] = await sql<{ version: string; purpose: string }[]>`
      select version, purpose from public.consents where tenant_id = ${a.tenantId}
      order by granted_at desc limit 1
    `;
    expect(consent!.purpose).toBe('loyalty');
    expect(consent!.version).toMatch(/^\d{4}-\d{2}-v\d+$/);
  });

  it('deja rastro en el audit_log', async () => {
    await registerCard(valid);
    const rows = await sql<{ action: string }[]>`
      select action from public.audit_log where tenant_id = ${a.tenantId}
    `;
    expect(rows.map((r) => r.action)).toContain('customer.register');
  });

  it('acepta los formatos de teléfono que la gente escribe de verdad', async () => {
    for (const [i, phone] of ['912345678', '+56912345679', '09 1234 5680'].entries()) {
      const outcome = await registerCard({ ...valid, name: `Cliente ${i}`, phone });
      expect(outcome.ok, `falló con "${phone}"`).toBe(true);
    }
  });

  it('rechaza un teléfono que no es celular chileno', async () => {
    const outcome = await registerCard({ ...valid, phone: '22334455' });
    expect(outcome).toMatchObject({ ok: false, kind: 'validation' });
    if (outcome.ok || outcome.kind !== 'validation') throw new Error('esperaba error de validación');
    expect(outcome.fieldErrors.phone).toMatch(/celular chileno/i);
  });

  it('rechaza el registro sin consentimiento', async () => {
    const outcome = await registerCard({ ...valid, consent: false });
    expect(outcome).toMatchObject({ ok: false, kind: 'validation' });
    if (outcome.ok || outcome.kind !== 'validation') throw new Error('esperaba error de validación');
    expect(outcome.fieldErrors.consent).toMatch(/autorización/i);
  });

  it('rechaza un nombre vacío', async () => {
    const outcome = await registerCard({ ...valid, name: '  ' });
    expect(outcome).toMatchObject({ ok: false, kind: 'validation' });
  });

  it('rechaza un negocio inexistente sin filtrar detalles internos', async () => {
    const outcome = await registerCard({ ...valid, tenantSlug: 'no-existe' });
    expect(outcome).toEqual({
      ok: false,
      kind: 'rejected',
      message: 'Este negocio no está disponible.',
    });
  });

  it('re-registrarse devuelve la misma tarjeta en vez de duplicar', async () => {
    const first = await registerCard(valid);
    const second = await registerCard(valid);
    if (!first.ok || !second.ok) throw new Error('esperaba éxito');

    expect(second.created).toBe(false);
    expect(second.serial).toBe(first.serial);

    const rows = await sql`select 1 from public.customers where tenant_id = ${a.tenantId} and name = 'Ana Pérez'`;
    expect(rows).toHaveLength(1);
  });

  it('registra el referido como pendiente, sin pagar todavía', async () => {
    const [referrer] = await sql<{ phone_e164: string }[]>`
      select phone_e164 from public.customers where id = ${a.customerId}
    `;
    const before = await sql<{ points_balance: number }[]>`
      select points_balance from public.cards where id = ${a.cardId}
    `;

    await registerCard({ ...valid, referralCode: referrer!.phone_e164 });

    const [ref] = await sql<{ status: string }[]>`select status from public.referrals`;
    expect(ref!.status).toBe('pending');

    const after = await sql<{ points_balance: number }[]>`
      select points_balance from public.cards where id = ${a.cardId}
    `;
    // El bono se paga con la primera visita real, no al registrarse.
    expect(after[0]!.points_balance).toBe(before[0]!.points_balance);
  });

  it('el mismo teléfono en dos negocios crea dos perfiles separados', async () => {
    await registerCard(valid);
    await registerCard({ ...valid, tenantSlug: 'cafe-b' });

    const rows = await sql<{ tenant_id: string }[]>`
      select tenant_id from public.customers where phone_e164 = '+56911112222'
    `;
    expect(new Set(rows.map((r) => r.tenant_id)).size).toBe(2);
  });
});

describe('privacidad en los logs', () => {
  it('un fallo inesperado no registra el teléfono del cliente', async () => {
    const capturado: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void capturado.push(...args);

    // Provoca un error no mapeado: sin permiso para ejecutar la función.
    await sql`revoke execute on function app.register_customer(text,text,text,text,text) from anon`;
    try {
      const outcome = await registerCard({ ...valid, phone: '+56988887777' });
      expect(outcome).toMatchObject({ ok: false, kind: 'rejected' });
    } finally {
      await sql`grant execute on function app.register_customer(text,text,text,text,text) to anon`;
      console.error = original;
    }

    const registrado = JSON.stringify(capturado);
    expect(registrado).not.toMatch(/\+?56988887777/);
    expect(registrado).not.toMatch(/Ana Pérez/);
    // Pero sí quedó rastro útil para depurar.
    expect(registrado).toMatch(/permission denied|42501/i);
  });
});
