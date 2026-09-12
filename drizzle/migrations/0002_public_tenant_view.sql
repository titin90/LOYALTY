-- =============================================================================
-- Datos públicos del negocio para la página de registro.
--
-- La página `/r/[slug]` la abre alguien sin sesión: necesita el nombre del local
-- y su premio para poder mostrarlos. `anon` no tiene acceso a ninguna tabla, así
-- que se expone una vista con SOLO información que ya es pública (la misma que
-- está impresa en el cartel del mostrador).
--
-- Es una ampliación deliberada de la superficie de bypass descrita en
-- CLAUDE.md regla 3: acotada, declarativa y cubierta por tests que verifican que
-- no expone ninguna columna de datos personales.
-- =============================================================================

CREATE OR REPLACE VIEW public.tenant_public
WITH (security_invoker = false) AS
SELECT
  t.slug,
  t.name,
  s.welcome_bonus_points,
  COALESCE(
    (
      SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'threshold', r.threshold)
                       ORDER BY r.sort_order, r.threshold)
      FROM public.rewards r
      WHERE r.tenant_id = t.id AND r.active
    ),
    '[]'::jsonb
  ) AS rewards
FROM public.tenants t
JOIN public.tenant_settings s ON s.tenant_id = t.id
WHERE t.status = 'active';

REVOKE ALL ON public.tenant_public FROM PUBLIC;
GRANT SELECT ON public.tenant_public TO anon, authenticated;
