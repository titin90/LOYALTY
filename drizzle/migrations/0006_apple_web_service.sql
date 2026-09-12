-- =============================================================================
-- Web service de Apple Wallet.
--
-- Los dispositivos de Apple llaman a estos endpoints sin sesión de usuario, así
-- que las operaciones necesitan saltar RLS. Se añaden TRES funciones estrechas
-- en vez de dejar que el código de la ruta use una conexión sin restricciones.
--
-- Esto amplía deliberadamente la superficie de bypass de cuatro a siete. El test
-- "la superficie SECURITY DEFINER expuesta son exactamente estas funciones" lleva
-- la lista cerrada: sumar una octava rompe el CI, que es justo lo que se busca.
--
-- Cada una se autoriza sola con el token del pase (`Authorization: ApplePass`),
-- salvo la de listado, que Apple llama sin token y que solo devuelve los seriales
-- que ese mismo dispositivo registró.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.apple_register_device(
  p_serial            text,
  p_auth_token        text,
  p_device_library_id text,
  p_push_token        text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pass public.wallet_passes%ROWTYPE;
BEGIN
  SELECT p.* INTO v_pass
  FROM public.wallet_passes p
  JOIN public.cards c ON c.id = p.card_id
  WHERE c.serial = p_serial AND p.platform = 'apple';

  IF v_pass.id IS NULL OR NOT app.verify_pin(p_auth_token, v_pass.auth_token_hash) THEN
    RETURN false;
  END IF;

  INSERT INTO public.apple_registrations (tenant_id, pass_id, device_library_identifier, push_token)
  VALUES (v_pass.tenant_id, v_pass.id, p_device_library_id, p_push_token)
  ON CONFLICT (pass_id, device_library_identifier)
    DO UPDATE SET push_token = excluded.push_token;

  RETURN true;
END $$;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.apple_unregister_device(
  p_serial            text,
  p_auth_token        text,
  p_device_library_id text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pass public.wallet_passes%ROWTYPE;
BEGIN
  SELECT p.* INTO v_pass
  FROM public.wallet_passes p
  JOIN public.cards c ON c.id = p.card_id
  WHERE c.serial = p_serial AND p.platform = 'apple';

  IF v_pass.id IS NULL OR NOT app.verify_pin(p_auth_token, v_pass.auth_token_hash) THEN
    RETURN false;
  END IF;

  DELETE FROM public.apple_registrations
  WHERE pass_id = v_pass.id AND device_library_identifier = p_device_library_id;

  RETURN true;
END $$;

--> statement-breakpoint

-- Apple llama a este endpoint SIN token. Solo devuelve los seriales que este
-- mismo dispositivo registró, así que conocer un deviceLibraryIdentifier ajeno
-- no revela nada de otros clientes ni de otros negocios.
CREATE OR REPLACE FUNCTION app.apple_updated_serials(
  p_device_library_id text,
  p_since             timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'serialNumbers', COALESCE(jsonb_agg(c.serial), '[]'::jsonb),
    'lastUpdated',   COALESCE(max(p.last_pushed_at), now())::text
  )
  FROM public.apple_registrations r
  JOIN public.wallet_passes p ON p.id = r.pass_id
  JOIN public.cards c ON c.id = p.card_id
  WHERE r.device_library_identifier = p_device_library_id
    AND (p_since IS NULL OR p.last_pushed_at IS NULL OR p.last_pushed_at > p_since);
$$;

--> statement-breakpoint

-- Dispositivos a los que avisar cuando cambian los puntos de una tarjeta.
-- Interna: la usa el emisor de notificaciones, no se expone a ningún rol.
CREATE OR REPLACE FUNCTION app.apple_push_targets(p_card_id uuid)
RETURNS TABLE (push_token text, pass_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.push_token, p.id
  FROM public.apple_registrations r
  JOIN public.wallet_passes p ON p.id = r.pass_id
  WHERE p.card_id = p_card_id AND p.platform = 'apple';
$$;

CREATE OR REPLACE FUNCTION app.mark_pass_pushed(p_pass_id uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.wallet_passes SET last_pushed_at = now() WHERE id = p_pass_id;
$$;

--> statement-breakpoint

REVOKE ALL ON FUNCTION
  app.apple_register_device(text, text, text, text),
  app.apple_unregister_device(text, text, text),
  app.apple_updated_serials(text, timestamptz),
  app.apple_push_targets(uuid),
  app.mark_pass_pushed(uuid)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  app.apple_register_device(text, text, text, text),
  app.apple_unregister_device(text, text, text),
  app.apple_updated_serials(text, timestamptz)
TO anon;
