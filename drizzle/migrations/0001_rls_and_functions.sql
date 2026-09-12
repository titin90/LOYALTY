-- =============================================================================
-- Superficie de seguridad de la plataforma. Escrito a mano a propósito: RLS,
-- triggers e invariantes se revisan como SQL, no se generan (ver CLAUDE.md).
--
-- Contenido:
--   1. Esquema `app` y helpers de identidad
--   2. RLS en las 17 tablas
--   3. Grants (el ledger y el saldo no son escribibles por la aplicación)
--   4. Trigger del saldo + guardia de append-only
--   5. Las cuatro funciones SECURITY DEFINER (única superficie de bypass)
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS app;

-- Roles de Supabase. Se crean si faltan para que el CI corra las MISMAS políticas
-- contra un Postgres pelado que producción contra Supabase.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public, app TO anon, authenticated;

--> statement-breakpoint

-- =============================================================================
-- 1. Identidad
-- =============================================================================

-- Mismo cuerpo que `auth.uid()` de Supabase, pero sin depender del esquema `auth`,
-- para que la suite de aislamiento pueda correr contra Postgres pelado en CI.
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

-- Tenants a los que pertenece el usuario actual.
--
-- SECURITY DEFINER a propósito: se ejecuta como dueño de las tablas para leer
-- `tenant_members` sin activar su propia política, que llamaría de vuelta a esta
-- función. Por eso `tenant_members` lleva ENABLE pero NO FORCE ROW LEVEL SECURITY
-- (ver nota en la sección 2). Es la única excepción del esquema y es deliberada.
CREATE OR REPLACE FUNCTION app.current_tenant_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(array_agg(m.tenant_id), '{}'::uuid[])
  FROM public.tenant_members m
  WHERE m.user_id = app.current_user_id()
    AND m.active
$$;

REVOKE ALL ON FUNCTION app.current_tenant_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_tenant_ids(), app.current_user_id() TO anon, authenticated;

--> statement-breakpoint

-- =============================================================================
-- 2. Row Level Security
-- =============================================================================
-- Toda tabla lleva ENABLE + FORCE y su política de aislamiento. `tenant_members`
-- lleva ENABLE sin FORCE (ver sección 1). El rol `anon` no recibe NINGUNA política:
-- los flujos públicos pasan solo por las funciones de la sección 5.

DO $$
DECLARE
  t text;
  -- `tenants` se aísla por su propia `id`; el resto por `tenant_id`.
  tables_with_tenant_id text[] := ARRAY[
    'tenant_settings', 'tenant_members', 'devices', 'customers', 'consents',
    'cards', 'card_designs', 'wallet_passes', 'apple_registrations',
    'point_events', 'rewards', 'redemptions', 'referrals',
    'audit_log', 'dsr_requests', 'review_prompts'
  ];
BEGIN
  -- tenants
  EXECUTE 'ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY';
  EXECUTE $p$
    CREATE POLICY tenant_isolation ON public.tenants FOR ALL TO authenticated
      USING (id = ANY (app.current_tenant_ids()))
      WITH CHECK (id = ANY (app.current_tenant_ids()))
  $p$;

  FOREACH t IN ARRAY tables_with_tenant_id LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- Excepción documentada: FORCE en tenant_members produciría recursión
    -- infinita al evaluar la política a través de app.current_tenant_ids().
    IF t <> 'tenant_members' THEN
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    END IF;

    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON public.%I FOR ALL TO authenticated
        USING (tenant_id = ANY (app.current_tenant_ids()))
        WITH CHECK (tenant_id = ANY (app.current_tenant_ids()))
    $p$, t);
  END LOOP;
END $$;

--> statement-breakpoint

-- =============================================================================
-- 3. Grants
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

-- El ledger es append-only también a nivel de permisos, no solo de trigger.
REVOKE UPDATE, DELETE ON public.point_events FROM authenticated;

-- El saldo lo mantiene el trigger de la sección 4. La aplicación no puede tocarlo
-- aunque el código lo intente: CLAUDE.md regla 4, impuesta por Postgres.
REVOKE UPDATE ON public.cards FROM authenticated;
GRANT UPDATE (status) ON public.cards TO authenticated;

-- El audit_log no se reescribe ni se borra.
REVOKE UPDATE, DELETE ON public.audit_log FROM authenticated;

-- `anon` no toca ninguna tabla directamente.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

--> statement-breakpoint

-- =============================================================================
-- 4. Saldo y append-only
-- =============================================================================

CREATE OR REPLACE FUNCTION app.apply_point_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.cards
     SET points_balance = points_balance + NEW.delta
   WHERE id = NEW.card_id
     AND tenant_id = NEW.tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'card % no existe en el tenant %', NEW.card_id, NEW.tenant_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_apply_point_event
AFTER INSERT ON public.point_events
FOR EACH ROW EXECUTE FUNCTION app.apply_point_event();

CREATE OR REPLACE FUNCTION app.reject_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION
    'point_events es append-only: para corregir, inserta un evento kind=adjust (CLAUDE.md regla 6)'
    USING ERRCODE = 'restrict_violation';
END $$;

CREATE TRIGGER trg_point_events_append_only
BEFORE UPDATE OR DELETE ON public.point_events
FOR EACH ROW EXECUTE FUNCTION app.reject_ledger_mutation();

-- Postgres concede EXECUTE a PUBLIC por defecto. Las funciones de trigger las
-- invoca el motor, nunca un cliente: se revoca para que la superficie expuesta
-- sean exactamente las cuatro de la sección 5.
REVOKE ALL ON FUNCTION app.apply_point_event(), app.reject_ledger_mutation() FROM PUBLIC;

--> statement-breakpoint

-- =============================================================================
-- 5. Superficie de bypass: CUATRO funciones SECURITY DEFINER
-- =============================================================================
-- Agregar una quinta exige aprobación humana explícita (CLAUDE.md regla 3).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION app.hash_pin(p_pin text) RETURNS text
LANGUAGE sql VOLATILE AS $$ SELECT crypt(p_pin, gen_salt('bf', 10)) $$;

CREATE OR REPLACE FUNCTION app.verify_pin(p_pin text, p_hash text) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT p_hash IS NOT NULL AND p_hash = crypt(p_pin, p_hash) $$;

-- pgcrypto vive en `extensions` en Supabase y en `public` en Postgres pelado.
-- Se fija el search_path real en vez de asumir uno.
DO $$
DECLARE v_schema text;
BEGIN
  SELECT n.nspname INTO v_schema
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';

  EXECUTE format('ALTER FUNCTION app.hash_pin(text) SET search_path = %I, pg_catalog', v_schema);
  EXECUTE format('ALTER FUNCTION app.verify_pin(text, text) SET search_path = %I, pg_catalog', v_schema);
END $$;

REVOKE ALL ON FUNCTION app.hash_pin(text), app.verify_pin(text, text) FROM PUBLIC;

--> statement-breakpoint

-- Verifica el PIN del personal y devuelve el miembro, con bloqueo por intentos
-- fallidos. Interna: no se expone a ningún rol.
CREATE OR REPLACE FUNCTION app.authenticate_staff(p_tenant_id uuid, p_pin text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member public.tenant_members%ROWTYPE;
BEGIN
  SELECT * INTO v_member
  FROM public.tenant_members m
  WHERE m.tenant_id = p_tenant_id
    AND m.active
    AND m.pin_hash IS NOT NULL
    AND app.verify_pin(p_pin, m.pin_hash)
  LIMIT 1;

  IF v_member.id IS NULL THEN
    UPDATE public.tenant_members
       SET failed_pin_attempts = failed_pin_attempts + 1,
           locked_until = CASE WHEN failed_pin_attempts + 1 >= 10
                               THEN now() + interval '15 minutes' ELSE locked_until END
     WHERE tenant_id = p_tenant_id AND active;
    RAISE EXCEPTION 'PIN invalido' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_member.locked_until IS NOT NULL AND v_member.locked_until > now() THEN
    RAISE EXCEPTION 'Cuenta bloqueada temporalmente' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.tenant_members
     SET failed_pin_attempts = 0, locked_until = NULL
   WHERE id = v_member.id;

  RETURN v_member.id;
END $$;

REVOKE ALL ON FUNCTION app.authenticate_staff(uuid, text) FROM PUBLIC;

--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- RPC 1/4 — register_customer
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.register_customer(
  p_tenant_slug     text,
  p_name            text,
  p_phone           text,
  p_consent_version text,
  p_referral_code   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id   uuid;
  v_bonus       integer;
  v_customer_id uuid;
  v_card_id     uuid;
  v_serial      text;
  v_existing    uuid;
  v_referrer    uuid;
BEGIN
  IF p_phone !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'Telefono invalido: se espera formato E.164' USING ERRCODE = 'check_violation';
  END IF;

  IF btrim(COALESCE(p_name, '')) = '' THEN
    RAISE EXCEPTION 'Nombre requerido' USING ERRCODE = 'check_violation';
  END IF;

  SELECT t.id, s.welcome_bonus_points INTO v_tenant_id, v_bonus
  FROM public.tenants t
  JOIN public.tenant_settings s ON s.tenant_id = t.id
  WHERE t.slug = p_tenant_slug AND t.status = 'active';

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Negocio no encontrado' USING ERRCODE = 'no_data_found';
  END IF;

  -- Reinscripción: devolver la tarjeta existente en vez de duplicar.
  SELECT c.id INTO v_existing
  FROM public.customers c
  WHERE c.tenant_id = v_tenant_id AND c.phone_e164 = p_phone AND c.deleted_at IS NULL;

  IF v_existing IS NOT NULL THEN
    SELECT id, serial INTO v_card_id, v_serial FROM public.cards WHERE customer_id = v_existing;
    RETURN jsonb_build_object('serial', v_serial, 'created', false);
  END IF;

  INSERT INTO public.customers (tenant_id, name, phone_e164)
  VALUES (v_tenant_id, btrim(p_name), p_phone)
  RETURNING id INTO v_customer_id;

  INSERT INTO public.consents (tenant_id, customer_id, purpose, version)
  VALUES (v_tenant_id, v_customer_id, 'loyalty', p_consent_version);

  v_serial := replace(pg_catalog.gen_random_uuid()::text, '-', '');

  INSERT INTO public.cards (tenant_id, customer_id, serial)
  VALUES (v_tenant_id, v_customer_id, v_serial)
  RETURNING id INTO v_card_id;

  -- Nunca mostrar el contador en cero (CLAUDE.md regla 13).
  IF v_bonus > 0 THEN
    INSERT INTO public.point_events (tenant_id, card_id, delta, kind, idempotency_key)
    VALUES (v_tenant_id, v_card_id, v_bonus, 'welcome_bonus', 'welcome:' || v_card_id::text);
  END IF;

  -- Referido: queda 'pending'. Se paga con el primer `earn` real (CLAUDE.md regla 12).
  IF p_referral_code IS NOT NULL AND btrim(p_referral_code) <> '' THEN
    SELECT c.id INTO v_referrer
    FROM public.customers c
    WHERE c.tenant_id = v_tenant_id
      AND c.deleted_at IS NULL
      AND (c.phone_e164 = p_referral_code
           OR EXISTS (SELECT 1 FROM public.cards k
                      WHERE k.customer_id = c.id AND k.serial = p_referral_code));

    IF v_referrer IS NOT NULL AND v_referrer <> v_customer_id THEN
      INSERT INTO public.referrals (tenant_id, referrer_customer_id, referred_customer_id)
      VALUES (v_tenant_id, v_referrer, v_customer_id)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  INSERT INTO public.audit_log (tenant_id, actor_type, actor_id, action, target_table, target_id)
  VALUES (v_tenant_id, 'customer', v_customer_id, 'customer.register', 'customers', v_customer_id);

  RETURN jsonb_build_object('serial', v_serial, 'created', true);
END $$;

--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- RPC 2/4 — record_scan
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.record_scan(
  p_card_serial     text,
  p_staff_pin       text,
  p_device_id       uuid,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_card        public.cards%ROWTYPE;
  v_staff_id    uuid;
  v_cooldown    integer;
  v_points      integer;
  v_last_earn   timestamptz;
  v_event_id    uuid;
  v_customer    text;
  v_balance     integer;
  v_next        integer;
  v_referral    public.referrals%ROWTYPE;
  v_ref_bonus   integer;
BEGIN
  SELECT * INTO v_card FROM public.cards WHERE serial = p_card_serial;
  IF v_card.id IS NULL THEN
    RAISE EXCEPTION 'Tarjeta no encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_card.status <> 'active' THEN
    RAISE EXCEPTION 'Tarjeta bloqueada' USING ERRCODE = 'check_violation';
  END IF;

  v_staff_id := app.authenticate_staff(v_card.tenant_id, p_staff_pin);

  IF p_device_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.devices d
    WHERE d.id = p_device_id AND d.tenant_id = v_card.tenant_id AND d.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Dispositivo no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Idempotencia: reenviar el mismo evento desde la cola offline no suma dos veces.
  SELECT id INTO v_event_id FROM public.point_events
  WHERE tenant_id = v_card.tenant_id AND idempotency_key = p_idempotency_key;

  IF v_event_id IS NOT NULL THEN
    SELECT c.name, k.points_balance INTO v_customer, v_balance
    FROM public.cards k JOIN public.customers c ON c.id = k.customer_id
    WHERE k.id = v_card.id;
    RETURN jsonb_build_object('duplicate', true, 'customer_name', v_customer, 'balance', v_balance);
  END IF;

  SELECT s.earn_cooldown_minutes, s.points_per_visit, s.referral_bonus_points
    INTO v_cooldown, v_points, v_ref_bonus
  FROM public.tenant_settings s WHERE s.tenant_id = v_card.tenant_id;

  SELECT max(e.created_at) INTO v_last_earn
  FROM public.point_events e
  WHERE e.card_id = v_card.id AND e.kind = 'earn';

  IF v_last_earn IS NOT NULL AND v_last_earn > now() - make_interval(mins => v_cooldown) THEN
    RAISE EXCEPTION 'Esta tarjeta ya sumo una visita hace poco' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.point_events (tenant_id, card_id, delta, kind, staff_id, device_id, idempotency_key)
  VALUES (v_card.tenant_id, v_card.id, v_points, 'earn', v_staff_id, p_device_id, p_idempotency_key);

  -- Primer `earn` real: se paga el referido pendiente.
  IF v_last_earn IS NULL THEN
    SELECT * INTO v_referral FROM public.referrals r
    WHERE r.tenant_id = v_card.tenant_id
      AND r.referred_customer_id = v_card.customer_id
      AND r.status = 'pending';

    IF v_referral.id IS NOT NULL AND v_ref_bonus > 0 THEN
      INSERT INTO public.point_events (tenant_id, card_id, delta, kind, idempotency_key)
      SELECT v_card.tenant_id, k.id, v_ref_bonus, 'referral', 'referral:' || v_referral.id::text
      FROM public.cards k WHERE k.customer_id = v_referral.referrer_customer_id;

      UPDATE public.referrals SET status = 'paid', rewarded_at = now() WHERE id = v_referral.id;
    END IF;
  END IF;

  SELECT c.name, k.points_balance INTO v_customer, v_balance
  FROM public.cards k JOIN public.customers c ON c.id = k.customer_id
  WHERE k.id = v_card.id;

  SELECT min(r.threshold) - v_balance INTO v_next
  FROM public.rewards r
  WHERE r.tenant_id = v_card.tenant_id AND r.active AND r.threshold > v_balance;

  INSERT INTO public.audit_log (tenant_id, actor_type, actor_id, action, target_table, target_id)
  VALUES (v_card.tenant_id, 'staff', v_staff_id, 'points.earn', 'cards', v_card.id);

  RETURN jsonb_build_object(
    'duplicate', false,
    'customer_name', v_customer,
    'earned', v_points,
    'balance', v_balance,
    'points_to_next_reward', v_next
  );
END $$;

--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- RPC 3/4 — redeem_reward
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.redeem_reward(
  p_card_serial     text,
  p_reward_id       uuid,
  p_staff_pin       text,
  p_device_id       uuid,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_card     public.cards%ROWTYPE;
  v_staff_id uuid;
  v_reward   public.rewards%ROWTYPE;
  v_event_id uuid;
  v_balance  integer;
BEGIN
  SELECT * INTO v_card FROM public.cards WHERE serial = p_card_serial;
  IF v_card.id IS NULL THEN
    RAISE EXCEPTION 'Tarjeta no encontrada' USING ERRCODE = 'no_data_found';
  END IF;

  v_staff_id := app.authenticate_staff(v_card.tenant_id, p_staff_pin);

  -- El premio debe pertenecer al MISMO tenant que la tarjeta.
  SELECT * INTO v_reward FROM public.rewards r
  WHERE r.id = p_reward_id AND r.tenant_id = v_card.tenant_id AND r.active;

  IF v_reward.id IS NULL THEN
    RAISE EXCEPTION 'Premio no disponible' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT id INTO v_event_id FROM public.point_events
  WHERE tenant_id = v_card.tenant_id AND idempotency_key = p_idempotency_key;

  IF v_event_id IS NOT NULL THEN
    RETURN jsonb_build_object('duplicate', true);
  END IF;

  IF v_card.points_balance < v_reward.threshold THEN
    RAISE EXCEPTION 'Puntos insuficientes: % de %', v_card.points_balance, v_reward.threshold
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.point_events (tenant_id, card_id, delta, kind, staff_id, device_id, idempotency_key)
  VALUES (v_card.tenant_id, v_card.id, -v_reward.threshold, 'redeem', v_staff_id, p_device_id, p_idempotency_key)
  RETURNING id INTO v_event_id;

  INSERT INTO public.redemptions (tenant_id, card_id, reward_id, staff_id, point_event_id)
  VALUES (v_card.tenant_id, v_card.id, v_reward.id, v_staff_id, v_event_id);

  SELECT points_balance INTO v_balance FROM public.cards WHERE id = v_card.id;

  INSERT INTO public.audit_log (tenant_id, actor_type, actor_id, action, target_table, target_id)
  VALUES (v_card.tenant_id, 'staff', v_staff_id, 'points.redeem', 'cards', v_card.id);

  RETURN jsonb_build_object('duplicate', false, 'reward', v_reward.name, 'balance', v_balance);
END $$;

--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- RPC 4/4 — resolve_apple_pass
-- Autenticación del header `Authorization: ApplePass <token>` del web service.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.resolve_apple_pass(p_serial text, p_auth_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pass public.wallet_passes%ROWTYPE;
BEGIN
  SELECT * INTO v_pass FROM public.wallet_passes p
  WHERE p.platform = 'apple' AND p.external_id = p_serial;

  IF v_pass.id IS NULL OR NOT app.verify_pin(p_auth_token, v_pass.auth_token_hash) THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object('pass_id', v_pass.id, 'card_id', v_pass.card_id, 'tenant_id', v_pass.tenant_id);
END $$;

--> statement-breakpoint

-- Grants de la superficie pública. Nada más de `app` es ejecutable desde fuera.
REVOKE ALL ON FUNCTION
  app.register_customer(text, text, text, text, text),
  app.record_scan(text, text, uuid, text),
  app.redeem_reward(text, uuid, text, uuid, text),
  app.resolve_apple_pass(text, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.register_customer(text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION app.resolve_apple_pass(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION app.record_scan(text, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.redeem_reward(text, uuid, text, uuid, text) TO authenticated;
