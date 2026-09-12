-- =============================================================================
-- `app.pass_payload` reemplaza a `app.resolve_apple_pass`.
--
-- Emitir un pase exige leer tarjeta, cliente, negocio, premio y diseño sin que
-- haya sesión: lo abre el cliente recién registrado, o el web service de Apple.
-- En vez de sumar una quinta función que salte RLS, se generaliza la que ya
-- existía y el conteo sigue en cuatro (CLAUDE.md regla 3).
--
-- Autorización: el serial es la credencial. Son 128 bits de entropía y es lo
-- mismo que lleva el QR del pase. Cuando además se entrega `p_auth_token` —el
-- header `Authorization: ApplePass` del web service— tiene que coincidir.
--
-- Devuelve SOLO lo que necesita un pase. Nunca el teléfono del cliente.
-- =============================================================================

DROP FUNCTION IF EXISTS app.resolve_apple_pass(text, text);

CREATE OR REPLACE FUNCTION app.pass_payload(
  p_serial     text,
  p_auth_token text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_card    public.cards%ROWTYPE;
  v_pass    public.wallet_passes%ROWTYPE;
  v_name    text;
  v_tenant  record;
  v_reward  record;
  v_design  jsonb;
BEGIN
  IF p_serial !~ '^[0-9a-f]{32}$' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_card FROM public.cards c WHERE c.serial = p_serial;
  IF v_card.id IS NULL OR v_card.status <> 'active' THEN
    RETURN NULL;
  END IF;

  -- Camino del web service de Apple: el token tiene que cuadrar con el pase.
  IF p_auth_token IS NOT NULL THEN
    SELECT * INTO v_pass FROM public.wallet_passes p
    WHERE p.card_id = v_card.id AND p.platform = 'apple';

    IF v_pass.id IS NULL OR NOT app.verify_pin(p_auth_token, v_pass.auth_token_hash) THEN
      RETURN NULL;
    END IF;
  END IF;

  SELECT c.name INTO v_name FROM public.customers c
  WHERE c.id = v_card.customer_id AND c.deleted_at IS NULL;

  IF v_name IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT t.name, t.slug INTO v_tenant FROM public.tenants t WHERE t.id = v_card.tenant_id;

  SELECT r.name, r.threshold INTO v_reward
  FROM public.rewards r
  WHERE r.tenant_id = v_card.tenant_id AND r.active AND r.threshold > v_card.points_balance
  ORDER BY r.threshold
  LIMIT 1;

  SELECT d.config INTO v_design
  FROM public.card_designs d
  WHERE d.tenant_id = v_card.tenant_id AND d.published_at IS NOT NULL
  ORDER BY d.version DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'serial',          v_card.serial,
    'card_id',         v_card.id,
    'tenant_id',       v_card.tenant_id,
    'tenant_name',     v_tenant.name,
    'tenant_slug',     v_tenant.slug,
    'customer_name',   v_name,
    'balance',         v_card.points_balance,
    'reward_name',     v_reward.name,
    'points_to_next',  CASE WHEN v_reward.threshold IS NULL
                            THEN NULL ELSE v_reward.threshold - v_card.points_balance END,
    'design',          COALESCE(v_design, '{}'::jsonb),
    'apple_pass_id',   v_pass.id
  );
END $$;

REVOKE ALL ON FUNCTION app.pass_payload(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.pass_payload(text, text) TO anon, authenticated;

--> statement-breakpoint

-- Registra el pase emitido y guarda hasheado su token de autenticación.
-- No es superficie pública: la llama el servidor con sesión de plataforma.
CREATE OR REPLACE FUNCTION app.register_wallet_pass(
  p_card_id     uuid,
  p_platform    public.wallet_platform,
  p_external_id text,
  p_auth_token  text
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid;
  v_pass_id   uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.cards WHERE id = p_card_id;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tarjeta no encontrada' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO public.wallet_passes (tenant_id, card_id, platform, external_id, auth_token_hash)
  VALUES (v_tenant_id, p_card_id, p_platform, p_external_id,
          CASE WHEN p_auth_token IS NULL THEN NULL ELSE app.hash_pin(p_auth_token) END)
  ON CONFLICT (card_id, platform) DO UPDATE
    SET external_id = excluded.external_id,
        auth_token_hash = COALESCE(excluded.auth_token_hash, public.wallet_passes.auth_token_hash)
  RETURNING id INTO v_pass_id;

  RETURN v_pass_id;
END $$;

REVOKE ALL ON FUNCTION app.register_wallet_pass(uuid, public.wallet_platform, text, text) FROM PUBLIC;
