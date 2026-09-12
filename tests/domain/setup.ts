/**
 * Los tests de dominio corren SIN base de datos, a propósito.
 *
 * Se borra DATABASE_URL antes de cargar nada: si algún módulo de lógica pura
 * empieza a arrastrar el cliente de Postgres, estos tests fallan de inmediato en
 * vez de volverse lentos y frágiles sin que nadie lo note.
 */
delete process.env.DATABASE_URL;
