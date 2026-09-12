/**
 * Invariantes estructurales. Estos tests son los que hacen que la regla no se
 * erosione: una tabla nueva sin `tenant_id`, sin RLS o sin política rompe el CI
 * aunque nadie se acuerde de agregar un caso a mano.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { sql, publicTables } from './helpers';

let tables: string[] = [];

beforeAll(async () => {
  tables = await publicTables();
});

describe('invariantes del esquema', () => {
  it('hay tablas que revisar', () => {
    expect(tables.length).toBeGreaterThan(10);
  });

  it('TODA tabla pública tiene RLS habilitado', async () => {
    const rows = await sql<{ relname: string }[]>`
      select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    `;
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('TODA tabla lleva FORCE, salvo la excepción documentada de tenant_members', async () => {
    const rows = await sql<{ relname: string }[]>`
      select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relforcerowsecurity
    `;
    // tenant_members no puede llevar FORCE: app.current_tenant_ids() la consulta
    // y la política se llamaría a sí misma (recursión infinita).
    expect(rows.map((r) => r.relname)).toEqual(['tenant_members']);
  });

  it('TODA tabla tiene una política de aislamiento', async () => {
    const rows = await sql<{ relname: string }[]>`
      select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and not exists (
          select 1 from pg_policy p
          where p.polrelid = c.oid and p.polname = 'tenant_isolation'
        )
    `;
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('TODA tabla tiene tenant_id, salvo tenants (donde id ES el tenant)', async () => {
    const rows = await sql<{ table_name: string }[]>`
      select t.table_name
      from information_schema.tables t
      where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
        and t.table_name <> 'tenants'
        and not exists (
          select 1 from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = t.table_name
            and c.column_name = 'tenant_id'
        )
    `;
    expect(rows.map((r) => r.table_name)).toEqual([]);
  });

  it('el rol anon no tiene permisos directos sobre ninguna tabla', async () => {
    const rows = await sql<{ table_name: string; privilege_type: string }[]>`
      select g.table_name, g.privilege_type
      from information_schema.role_table_grants g
      join pg_class c on c.relname = g.table_name
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where g.grantee = 'anon' and g.table_schema = 'public' and c.relkind = 'r'
    `;
    expect(rows).toEqual([]);
  });

  it('anon solo alcanza la vista pública, y solo para leer', async () => {
    const rows = await sql<{ table_name: string; privilege_type: string }[]>`
      select table_name, privilege_type
      from information_schema.role_table_grants
      where grantee = 'anon' and table_schema = 'public'
      order by table_name, privilege_type
    `;
    expect(rows).toEqual([{ table_name: 'tenant_public', privilege_type: 'SELECT' }]);
  });

  it('la vista pública no expone ninguna columna de datos personales', async () => {
    const rows = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'tenant_public'
      order by column_name
    `;
    // Lista cerrada: agregar una columna aquí es una decisión de privacidad,
    // no un detalle de implementación.
    expect(rows.map((r) => r.column_name)).toEqual([
      'name',
      'rewards',
      'slug',
      'welcome_bonus_points',
    ]);
  });

  it('no existe ninguna otra vista que salte RLS', async () => {
    const rows = await sql<{ viewname: string }[]>`
      select c.relname as viewname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v'
        and coalesce((select option_value from pg_options_to_table(c.reloptions)
                      where option_name = 'security_invoker'), 'false') = 'false'
      order by 1
    `;
    expect(rows.map((r) => r.viewname)).toEqual(['tenant_public']);
  });

  it('la superficie SECURITY DEFINER expuesta son exactamente cuatro funciones', async () => {
    const rows = await sql<{ proname: string }[]>`
      select p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.prosecdef
        and (has_function_privilege('anon', p.oid, 'execute')
             or has_function_privilege('authenticated', p.oid, 'execute'))
        and p.proname <> 'current_tenant_ids'
      order by p.proname
    `;
    expect(rows.map((r) => r.proname)).toEqual([
      'record_scan',
      'redeem_reward',
      'register_customer',
      'resolve_apple_pass',
    ]);
  });

  it('toda función SECURITY DEFINER fija su search_path', async () => {
    const rows = await sql<{ proname: string }[]>`
      select p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.prosecdef
        and not exists (
          select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
          where cfg like 'search_path=%'
        )
    `;
    expect(rows.map((r) => r.proname)).toEqual([]);
  });
});
