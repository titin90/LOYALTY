-- =============================================================================
-- Corrige el bloqueo por fuerza bruta del PIN.
--
-- Bug: `authenticate_staff` incrementaba el contador de intentos y acto seguido
-- hacía RAISE. La excepción aborta la transacción y revierte el propio contador,
-- así que el bloqueo NUNCA se activaba: el PIN de 4 dígitos era atacable sin
-- límite. Lo detectó el test "se bloquea tras 10 intentos fallidos de PIN".
--
-- Arreglo: las rutas de PIN devuelven un resultado en vez de lanzar excepción,
-- para que el incremento alcance a confirmarse. El resto de los errores sigue
-- con RAISE, porque no tienen efecto colateral que deba sobrevivir.
--
-- Además el contador se cuenta contra el DISPOSITIVO y no contra las personas
-- del local (ver comentario en el esquema).
-- =============================================================================

DROP FUNCTION IF EXISTS app.authenticate_staff(uuid, text);

-- Devuelve (staff_id, error). Nunca lanza: quien llama decide, y así el
-- incremento de intentos fallidos se confirma con la transacción.
CREATE OR REPLACE FUNCTION app.authenticate_staff(
  p_tenant_id uuid,
  p_device_id uuid,
  p_pin       text,
  OUT staff_id uuid,
  OUT error    text
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_locked_until timestamptz;
BEGIN
  staff_id := NULL;
  error := NULL;

  IF p_device_id IS NOT NULL THEN
    SELECT d.locked_until INTO v_locked_until
    FROM public.devices d
    WHERE d.id = p_device_id AND d.tenant_id = p_tenant_id AND d.revoked_at IS NULL;

    IF NOT FOUND THEN
      error := 'device_revoked';
      RETURN;
    END IF;

    IF v_locked_until IS NOT NULL AND v_locked_until > now() THEN
      error := 'locked';
      RETURN;
    END IF;
  END IF;

  SELECT m.id INTO staff_id
  FROM public.tenant_members m
  WHERE m.tenant_id = p_tenant_id
    AND m.active
    AND m.pin_hash IS NOT NULL
    AND app.verify_pin(p_pin, m.pin_hash)
  LIMIT 1;

  IF staff_id IS NULL THEN
    error := 'bad_pin';
    IF p_device_id IS NOT NULL THEN
      UPDATE public.devices
         SET failed_pin_attempts = failed_pin_attempts + 1,
             locked_until = CASE WHEN failed_pin_attempts + 1 >= 10
                                 THEN now() + interval '15 minutes' ELSE locked_until END
       WHERE id = p_device_id;
    END IF;
    RETURN;
  END IF;

  IF p_device_id IS NOT NULL THEN
    UPDATE public.devices
       SET failed_pin_attempts = 0, locked_until = NULL, last_seen_at = now()
     WHERE id = p_device_id;
  END IF;
END $$;

REVOKE ALL ON FUNCTION app.authenticate_staff(uuid, uuid, text) FROM PUBLIC;

--> statement-breakpoint

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
  v_card      public.cards%ROWTYPE;
  v_auth      record;
  v_cooldown  integer;
  v_points    integer;
  v_last_earn timestamptz;
  v_event_id  uuid;
  v_customer  text;
  v_balance   integer;
  v_next      integer;
  v_referral  public.referrals%ROWTYPE;
  v_ref_bonus integer;
BEGIN
  SELECT * INTO v_card FROM public.cards WHERE serial = p_card_serial;
  IF v_card.id IS NULL THEN
    RAISE EXCEPTION 'Tarjeta no encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_card.status <> 'active' THEN
    RAISE EXCEPTION 'Tarjeta bloqueada' USING ERRCODE = 'check_violation';
  END IF;

  -- Se devuelve sin excepción para que el contador de intentos se confirme.
  SELECT * INTO v_auth FROM app.authenticate_staff(v_card.tenant_id, p_device_id, p_staff_pin);
  IF v_auth.error IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', v_auth.error);
  END IF;

  SELECT id INTO v_event_id FROM public.point_events
  WHERE tenant_id = v_card.tenant_id AND idempotency_key = p_idempotency_key;

  IF v_event_id IS NOT NULL THEN
    SELECT c.name, k.points_balance INTO v_customer, v_balance
    FROM public.cards k JOIN public.customers c ON c.id = k.customer_id
    WHERE k.id = v_card.id;
    RETURN jsonb_build_object('ok', true, 'duplicate', true,
                              'customer_name', v_customer, 'balance', v_balance,
                              'earned', 0, 'points_to_next_reward', NULL);
  END IF;

  SELECT s.earn_cooldown_minutes, s.points_per_visit, s.referral_bonus_points
    INTO v_cooldown, v_points, v_ref_bonus
  FROM public.tenant_settings s WHERE s.tenant_id = v_card.tenant_id;

  SELECT max(e.created_at) INTO v_last_earn
  FROM public.point_events e WHERE e.card_id = v_card.id AND e.kind = 'earn';

  IF v_last_earn IS NOT NULL AND v_last_earn > now() - make_interval(mins => v_cooldown) THEN
    RAISE EXCEPTION 'Esta tarjeta ya sumo una visita hace poco' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.point_events (tenant_id, card_id, delta, kind, staff_id, device_id, idempotency_key)
  VALUES (v_card.tenant_id, v_card.id, v_points, 'earn', v_auth.staff_id, p_device_id, p_idempotency_key);

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
  VALUES (v_card.tenant_id, 'staff', v_auth.staff_id, 'points.earn', 'cards', v_card.id);

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'customer_name', v_customer,
                            'earned', v_points, 'balance', v_balance,
                            'points_to_next_reward', v_next);
END $$;

--> statement-breakpoint

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
  v_auth     record;
  v_reward   public.rewards%ROWTYPE;
  v_event_id uuid;
  v_balance  integer;
BEGIN
  SELECT * INTO v_card FROM public.cards WHERE serial = p_card_serial;
  IF v_card.id IS NULL THEN
    RAISE EXCEPTION 'Tarjeta no encontrada' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT * INTO v_auth FROM app.authenticate_staff(v_card.tenant_id, p_device_id, p_staff_pin);
  IF v_auth.error IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', v_auth.error);
  END IF;

  SELECT * INTO v_reward FROM public.rewards r
  WHERE r.id = p_reward_id AND r.tenant_id = v_card.tenant_id AND r.active;

  IF v_reward.id IS NULL THEN
    RAISE EXCEPTION 'Premio no disponible' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT id INTO v_event_id FROM public.point_events
  WHERE tenant_id = v_card.tenant_id AND idempotency_key = p_idempotency_key;

  IF v_event_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;

  IF v_card.points_balance < v_reward.threshold THEN
    RAISE EXCEPTION 'Puntos insuficientes: % de %', v_card.points_balance, v_reward.threshold
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.point_events (tenant_id, card_id, delta, kind, staff_id, device_id, idempotency_key)
  VALUES (v_card.tenant_id, v_card.id, -v_reward.threshold, 'redeem', v_auth.staff_id, p_device_id, p_idempotency_key)
  RETURNING id INTO v_event_id;

  INSERT INTO public.redemptions (tenant_id, card_id, reward_id, staff_id, point_event_id)
  VALUES (v_card.tenant_id, v_card.id, v_reward.id, v_auth.staff_id, v_event_id);

  SELECT points_balance INTO v_balance FROM public.cards WHERE id = v_card.id;

  INSERT INTO public.audit_log (tenant_id, actor_type, actor_id, action, target_table, target_id)
  VALUES (v_card.tenant_id, 'staff', v_auth.staff_id, 'points.redeem', 'cards', v_card.id);

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'reward', v_reward.name, 'balance', v_balance);
END $$;
