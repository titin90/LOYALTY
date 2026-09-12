-- =============================================================================
-- Autenticación del dueño para el panel.
--
-- Es una función más en la superficie de bypass (de 7 a 8) y no hay forma de
-- evitarlo: iniciar sesión es, por definición, una operación previa a tener
-- sesión. Va lo más estrecha posible — recibe correo y contraseña, devuelve solo
-- la identidad — y queda en la lista cerrada del test de aislamiento.
--
-- Devuelve en vez de lanzar, por la misma razón que `authenticate_staff`: una
-- excepción revierte la transacción y con ella el contador de intentos, que es
-- justo lo que permite el bloqueo (ver migración 0004).
-- =============================================================================

CREATE OR REPLACE FUNCTION app.authenticate_member(
  p_email    text,
  p_password text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member public.tenant_members%ROWTYPE;
  v_tenant public.tenants%ROWTYPE;
BEGIN
  SELECT * INTO v_member
  FROM public.tenant_members m
  WHERE lower(m.email) = lower(btrim(p_email)) AND m.active AND m.password_hash IS NOT NULL;

  -- Mismo resultado para correo inexistente y contraseña errónea: distinguirlos
  -- dice si una dirección está registrada en la plataforma.
  IF v_member.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_credentials');
  END IF;

  IF v_member.login_locked_until IS NOT NULL AND v_member.login_locked_until > now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'locked');
  END IF;

  IF NOT app.verify_pin(p_password, v_member.password_hash) THEN
    UPDATE public.tenant_members
       SET failed_login_attempts = failed_login_attempts + 1,
           login_locked_until = CASE WHEN failed_login_attempts + 1 >= 8
                                     THEN now() + interval '15 minutes'
                                     ELSE login_locked_until END
     WHERE id = v_member.id;
    RETURN jsonb_build_object('ok', false, 'error', 'bad_credentials');
  END IF;

  SELECT * INTO v_tenant FROM public.tenants t WHERE t.id = v_member.tenant_id;
  IF v_tenant.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tenant_inactive');
  END IF;

  UPDATE public.tenant_members
     SET failed_login_attempts = 0, login_locked_until = NULL
   WHERE id = v_member.id;

  INSERT INTO public.audit_log (tenant_id, actor_type, actor_id, action)
  VALUES (v_member.tenant_id, 'staff', v_member.id, 'member.login');

  RETURN jsonb_build_object(
    'ok',          true,
    'user_id',     v_member.user_id,
    'tenant_id',   v_member.tenant_id,
    'tenant_slug', v_tenant.slug,
    'tenant_name', v_tenant.name,
    'name',        v_member.name,
    'role',        v_member.role
  );
END $$;

REVOKE ALL ON FUNCTION app.authenticate_member(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.authenticate_member(text, text) TO anon;

--> statement-breakpoint

-- Alta de credenciales. Operación de plataforma: no se expone a ningún rol.
CREATE OR REPLACE FUNCTION app.set_member_password(
  p_member_id uuid,
  p_email     text,
  p_password  text
) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.tenant_members
     SET email = lower(btrim(p_email)),
         password_hash = app.hash_pin(p_password),
         failed_login_attempts = 0,
         login_locked_until = NULL
   WHERE id = p_member_id;
$$;

REVOKE ALL ON FUNCTION app.set_member_password(uuid, text, text) FROM PUBLIC;
