-- PASO 2: activa Row-Level Security en las tablas que no la tenian (ver paso 0) y deja a la
-- llave anon solo con lo que la app realmente usa. Correr DESPUES de publicar el codigo
-- que usa login_usuario_bo (paso 1); si no, el login deja de funcionar.
-- Las Edge Functions de sincronizacion usan service_role, que no pasa por RLS.

-- Usuarios del back office: sin ninguna politica => la llave anon ya no puede leerlos ni modificarlos.
alter table public.usuarios_bo enable row level security;
drop policy if exists "anon lee usuarios_bo" on public.usuarios_bo;

-- Catalogos: solo lectura.
alter table public.sucursales enable row level security;
drop policy if exists "lectura sucursales" on public.sucursales;
create policy "lectura sucursales" on public.sucursales for select using (true);

alter table public.productos enable row level security;
drop policy if exists "lectura productos" on public.productos;
create policy "lectura productos" on public.productos for select using (true);

-- Visitas: la app de auditores inserta y los reportes leen. Nadie puede editar ni borrar.
alter table public.visitas_auditoria enable row level security;
drop policy if exists "lectura visitas" on public.visitas_auditoria;
drop policy if exists "alta visitas" on public.visitas_auditoria;
create policy "lectura visitas" on public.visitas_auditoria for select using (true);
create policy "alta visitas" on public.visitas_auditoria for insert with check (true);

-- Tarifas por cadena: el back office las lee y las guarda (upsert = insert + update).
alter table public.tarifas_cadena enable row level security;
drop policy if exists "lectura tarifas" on public.tarifas_cadena;
drop policy if exists "alta tarifas" on public.tarifas_cadena;
drop policy if exists "cambio tarifas" on public.tarifas_cadena;
create policy "lectura tarifas" on public.tarifas_cadena for select using (true);
create policy "alta tarifas" on public.tarifas_cadena for insert with check (true);
create policy "cambio tarifas" on public.tarifas_cadena for update using (true);

-- Si el paso 0 mostro otras tablas sin RLS que la app no usa, activalas sin politicas:
--   alter table public.<tabla> enable row level security;
