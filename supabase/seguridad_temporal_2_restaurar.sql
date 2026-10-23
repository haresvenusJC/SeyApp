-- RESTAURA la seguridad despues de seguridad_temporal_1_abrir_netlify.sql.
-- Correr en cuanto Netlify despliegue el codigo nuevo (el que usa login_usuario_bo).

-- 1) Cierra la lectura directa de la tabla.
drop policy if exists temp_netlify_login on public.usuarios_bo;

-- 2) El trigger vuelve a cifrar.
alter table public.usuarios_bo enable trigger trg_usuarios_bo_hashear_password;

-- 3) Convierte en hash las contrasenas temporales y borra el texto plano.
update public.usuarios_bo set password = password where password is not null and password <> '';

-- 4) El login vuelve a aceptar solo el hash.
create or replace function public.login_usuario_bo(p_usuario text, p_password text)
returns table (usuario text, rol text)
language sql
security definer
set search_path = public, extensions
as $$
    select u.usuario::text, u.rol::text
    from public.usuarios_bo u
    where u.usuario = p_usuario
      and u.password_hash is not null
      and u.password_hash = crypt(p_password, u.password_hash)
    limit 1;
$$;
revoke all on function public.login_usuario_bo(text, text) from public;
grant execute on function public.login_usuario_bo(text, text) to anon, authenticated;
