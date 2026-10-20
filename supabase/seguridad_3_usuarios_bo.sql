-- PASO 3: cierra la tabla de usuarios y contrasenas. usuarios_bo ya tiene RLS activo, pero alguna
-- politica existente deja leerla con la llave anon (por eso el login actual funciona).
-- Correr SOLO despues de publicar el codigo que usa login_usuario_bo (paso 1) y comprobar que el login funciona.
-- Borra todas las politicas de usuarios_bo: sin politicas, anon no puede leer ni modificar la tabla.
-- (login_usuario_bo es security definer y sigue funcionando.)

do $$
declare p record;
begin
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'usuarios_bo' loop
        execute format('drop policy %I on public.usuarios_bo', p.policyname);
    end loop;
end $$;
alter table public.usuarios_bo enable row level security;
