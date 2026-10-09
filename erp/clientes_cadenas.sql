-- Agrupa clientes (razones sociales, tal como aparecen en ventas_documentos_erp)
-- en cadenas/grupos comerciales, para que el analisis de rentabilidad se pueda
-- ver por cadena (venta global + cargos globales) ademas de por cliente individual.
create table if not exists clientes_cadenas (
    id              bigint generated always as identity primary key,
    cliente_nombre  text not null unique,
    cadena          text not null,
    creado_en       timestamptz not null default now()
);
alter table clientes_cadenas enable row level security;
create policy "lectura clientes cadenas" on clientes_cadenas for select using (true);
create policy "escritura clientes cadenas" on clientes_cadenas for insert with check (true);
create policy "actualiza clientes cadenas" on clientes_cadenas for update using (true);
create policy "borra clientes cadenas" on clientes_cadenas for delete using (true);

create index if not exists idx_clientes_cadenas_cadena on clientes_cadenas (cadena);

-- Agrupaciones iniciales pedidas: todos los "Walmart" y todos los "Servicios en
-- Puertos..." (Farmacias del Ahorro). Se puede ajustar/agregar mas desde la app.
insert into clientes_cadenas (cliente_nombre, cadena)
select distinct cliente_nombre, 'Walmart'
from ventas_documentos_erp
where cliente_nombre ilike '%walmart%'
on conflict (cliente_nombre) do update set cadena = excluded.cadena;

insert into clientes_cadenas (cliente_nombre, cadena)
select distinct cliente_nombre, 'Farmacias del Ahorro'
from ventas_documentos_erp
where cliente_nombre ilike '%servicios en puertos%'
on conflict (cliente_nombre) do update set cadena = excluded.cadena;
