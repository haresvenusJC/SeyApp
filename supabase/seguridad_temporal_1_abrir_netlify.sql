-- TEMPORAL (autorizado por el dueno): deja entrar a "Rigo" con el codigo VIEJO de Netlify
-- (lee usuarios_bo directo con usuario+password en texto plano) mientras Netlify no pueda desplegar el codigo nuevo.
-- Se deshace con seguridad_temporal_2_restaurar.sql.
-- Las contrasenas cifradas (bcrypt) no se pueden revertir: Rigo necesita una contrasena nueva.
-- Exposicion minima: la politica solo deja leer filas con password en texto plano, es decir, SOLO Rigo.
-- Las demas filas (solo hash) siguen invisibles para la llave anon.

-- 1) El trigger deja de convertir las contrasenas en hash.
alter table public.usuarios_bo disable trigger trg_usuarios_bo_hashear_password;

-- 2) Contrasena temporal en texto plano SOLO para Rigo. Cambia CLAVE_TEMPORAL por la que le vas a dar.
update public.usuarios_bo set password = 'CLAVE_TEMPORAL' where usuario = 'Rigo';

-- 3) Politica temporal: anon solo ve filas con contrasena en texto plano.
drop policy if exists temp_netlify_login on public.usuarios_bo;
create policy temp_netlify_login on public.usuarios_bo
    for select to anon
    using (password is not null and password <> '');

-- 4) El login nuevo (GitHub Pages / futuro deploy) acepta hash o texto plano mientras dure esto.
create or replace function public.login_usuario_bo(p_usuario text, p_password text)
returns table (usuario text, rol text)
language sql
security definer
set search_path = public, extensions
as $$
    select u.usuario::text, u.rol::text
    from public.usuarios_bo u
    where u.usuario = p_usuario
      and (
            (u.password_hash is not null and u.password_hash = crypt(p_password, u.password_hash))
         or (u.password is not null and u.password <> '' and u.password = p_password)
      )
    limit 1;
$$;
revoke all on function public.login_usuario_bo(text, text) from public;
grant execute on function public.login_usuario_bo(text, text) to anon, authenticated;

-- Verifica que el usuario existe con ese nombre exacto (mayusculas incluidas):
select usuario, rol, password <> '' as texto_plano from public.usuarios_bo where usuario ilike 'rigo';
