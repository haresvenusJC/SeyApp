-- PASO 1: funcion de login. Es seguro correrla en cualquier momento: no cambia ningun permiso.
-- Permite que la app valide usuario/contrasena SIN poder leer la tabla usuarios_bo
-- (hoy cualquiera con la llave anon puede bajarse todos los usuarios y contrasenas).
-- Despues de correrla, publica el codigo de la app (que ya usa esta funcion) y solo entonces corre el PASO 2.

create or replace function public.login_usuario_bo(p_usuario text, p_password text)
returns table (usuario text, rol text)
language sql
security definer
set search_path = public
as $$
    select u.usuario::text, u.rol::text
    from public.usuarios_bo u
    where u.usuario = p_usuario and u.password = p_password
    limit 1;
$$;

revoke all on function public.login_usuario_bo(text, text) from public;
grant execute on function public.login_usuario_bo(text, text) to anon, authenticated;
