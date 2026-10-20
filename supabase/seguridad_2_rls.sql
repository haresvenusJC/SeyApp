-- PASO 2: tarifas_cadena era la unica tabla del esquema public sin Row-Level Security
-- (es la que marca el aviso "Table publicly accessible"). Se puede correr en cualquier momento,
-- no depende del paso 1. Deja a la llave anon con lo que el back office usa: leer y guardar tarifas
-- (upsert = insert + update), sin poder borrarlas.

alter table public.tarifas_cadena enable row level security;
drop policy if exists "lectura tarifas" on public.tarifas_cadena;
drop policy if exists "alta tarifas" on public.tarifas_cadena;
drop policy if exists "cambio tarifas" on public.tarifas_cadena;
create policy "lectura tarifas" on public.tarifas_cadena for select using (true);
create policy "alta tarifas" on public.tarifas_cadena for insert with check (true);
create policy "cambio tarifas" on public.tarifas_cadena for update using (true);
