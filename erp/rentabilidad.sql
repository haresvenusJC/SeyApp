-- Analisis de rentabilidad: ventas (ventas_documentos_erp) vs cargos por cliente/mes
-- (Fee Logistico, Maniobras, Contribucion marginal por promociones, Inversion en
-- promociones, Costo de promotoria, Devoluciones, y las que se vayan agregando).

-- Catalogo de categorias canonicas de cargo. Se puede seguir agregando desde la app.
create table if not exists cargos_tipos (
    id          bigint generated always as identity primary key,
    nombre      text not null unique,
    orden       int not null default 0,
    activo      boolean not null default true,
    creado_en   timestamptz not null default now()
);
alter table cargos_tipos enable row level security;
create policy "lectura cargos tipos" on cargos_tipos for select using (true);
create policy "escritura cargos tipos" on cargos_tipos for insert with check (true);
create policy "actualiza cargos tipos" on cargos_tipos for update using (true);

insert into cargos_tipos (nombre, orden) values
    ('Fee Logístico', 1),
    ('Maniobras', 2),
    ('Contribución marginal por promociones', 3),
    ('Inversión en promociones', 4),
    ('Costo de promotoría', 5),
    ('Devoluciones', 6)
on conflict (nombre) do nothing;

-- Diccionario de referencia: como le llama cada cliente a cada categoria canonica
-- (distintos clientes nombran sus cargos distinto; esto es solo documentacion,
-- la captura mensual siempre usa la categoria canonica).
create table if not exists cargos_alias (
    id             bigint generated always as identity primary key,
    cliente_nombre text not null,
    cargo_tipo_id  bigint not null references cargos_tipos(id) on delete cascade,
    alias_nombre   text not null,
    creado_en      timestamptz not null default now(),
    unique (cliente_nombre, cargo_tipo_id, alias_nombre)
);
alter table cargos_alias enable row level security;
create policy "lectura cargos alias" on cargos_alias for select using (true);
create policy "escritura cargos alias" on cargos_alias for insert with check (true);
create policy "borra cargos alias" on cargos_alias for delete using (true);

-- Captura mensual real de cargos por cliente (un monto por cliente+mes+categoria).
create table if not exists cargos_mensuales (
    id             bigint generated always as identity primary key,
    cliente_nombre text not null,
    periodo        date not null,  -- primer dia del mes (ej. 2026-10-01)
    cargo_tipo_id  bigint not null references cargos_tipos(id) on delete cascade,
    monto          numeric not null default 0,
    notas          text,
    capturado_en   timestamptz not null default now(),
    unique (cliente_nombre, periodo, cargo_tipo_id)
);
alter table cargos_mensuales enable row level security;
create policy "lectura cargos mensuales" on cargos_mensuales for select using (true);
create policy "escritura cargos mensuales" on cargos_mensuales for insert with check (true);
create policy "actualiza cargos mensuales" on cargos_mensuales for update using (true);
create policy "borra cargos mensuales" on cargos_mensuales for delete using (true);
