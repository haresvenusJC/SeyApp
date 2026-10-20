-- PASO 4: cifra las contrasenas de usuarios_bo (bcrypt con pgcrypto). Correr en el proyecto SeyApp.
-- Despues de correrlo, la columna "password" queda vacia y solo se guarda el hash en "password_hash".
-- La funcion login_usuario_bo (paso 1) pasa a comparar contra el hash, asi que el codigo de la app no cambia.
-- Si el script falla a medias no se pierde nada: las contrasenas solo se borran en el ultimo UPDATE.

create extension if not exists pgcrypto with schema extensions;

alter table public.usuarios_bo add column if not exists password_hash text;

-- 1) Hash de las contrasenas actuales (sin tocar todavia la columna original).
update public.usuarios_bo
set password_hash = extensions.crypt(password, extensions.gen_salt('bf'))
where password_hash is null and password is not null and password <> '';

-- 2) El login compara contra el hash.
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

-- 3) Para altas y cambios de contrasena: se escribe la contrasena normal en la columna "password"
--    (desde el Table Editor o con SQL) y el trigger la convierte en hash y borra el texto.
create or replace function public.usuarios_bo_hashear_password()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
    if new.password is not null and new.password <> '' then
        new.password_hash := crypt(new.password, gen_salt('bf'));
        new.password := '';
    end if;
    return new;
end;
$$;
drop trigger if exists trg_usuarios_bo_hashear_password on public.usuarios_bo;
create trigger trg_usuarios_bo_hashear_password
before insert or update of password on public.usuarios_bo
for each row execute function public.usuarios_bo_hashear_password();

-- 4) Borra el texto plano de las filas existentes (el trigger re-hashea el mismo valor y vacia la columna).
update public.usuarios_bo set password = password where password is not null and password <> '';
