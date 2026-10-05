-- =============================================================================
-- La solicitud de reseña viaja DENTRO del pase.
--
-- El documento de producto lo pedía así: reutilizar el mismo evento de
-- actualización de la tarjeta, sin abrir un canal nuevo. Cuando corresponde
-- pedir reseña, el pase se actualiza con el enlace y el cliente lo ve en su
-- wallet; no hay SMS, ni correo, ni nada que instalar.
--
-- `pass_payload` se extiende en vez de agregar otra función: la superficie de
-- bypass se mantiene en ocho.
--
-- El tope lo decide `shouldPromptReview` en TypeScript, que ya está cubierto por
-- tests. Aquí solo se expone si hay una solicitud vigente.
-- =============================================================================

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
  v_review  text;
BEGIN
  IF p_serial !~ '^[0-9a-f]{32}$' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_card FROM public.cards c WHERE c.serial = p_serial;
  IF v_card.id IS NULL OR v_card.status <> 'active' THEN
    RETURN NULL;
  END IF;

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

  -- Enlace de reseña solo si hay una solicitud de los últimos 30 días para este
  -- cliente y el negocio configuró su enlace.
  SELECT s.google_review_url INTO v_review
  FROM public.tenant_settings s
  WHERE s.tenant_id = v_card.tenant_id
    AND s.google_review_url IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.review_prompts rp
      WHERE rp.customer_id = v_card.customer_id
        AND rp.sent_at > now() - interval '30 days'
    );

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
    'review_url',      v_review,
    'apple_pass_id',   v_pass.id
  );
END $$;
