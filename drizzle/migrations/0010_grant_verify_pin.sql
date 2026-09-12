-- =============================================================================
-- Permite verificar el PIN también en operaciones de solo lectura.
--
-- La búsqueda por teléfono devolvía nombres de clientes exigiendo únicamente la
-- cookie del dispositivo. El PIN se escribe antes de llegar al escáner pero no
-- se valida hasta que ocurre un marcaje, así que cualquiera con el teléfono del
-- mostrador en la mano podía escribir cuatro dígitos cualesquiera y barrer la
-- base de clientes del local.
--
-- `app.verify_pin` NO es SECURITY DEFINER: es una comparación bcrypt. Concederla
-- no amplía la superficie de bypass, que sigue en ocho funciones. Quien la llama
-- solo puede comparar contra los hashes que RLS ya le deja ver — los de su
-- propio negocio.
-- =============================================================================

GRANT EXECUTE ON FUNCTION app.verify_pin(text, text) TO authenticated;
