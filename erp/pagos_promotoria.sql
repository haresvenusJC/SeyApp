-- Pagos de promotoria: cortes semanales (martes a lunes) congelados, registro del pago
-- a cada auditor y base para el costo mensual asignado a cada cadena.

-- Un corte por semana. "dias" guarda el costo por dia y cadena (para repartir semanas que
-- cruzan dos meses), "tarifas" la tarifa vigente al momento del cierre.
create table if not exists pagos_cortes (
    id            bigint generated always as identity primary key,
    semana_inicio date not null unique,   -- martes
    semana_fin    date not null,          -- lunes
    total         numeric not null default 0,
    visitas       int not null default 0,
    dias          jsonb not null default '[]'::jsonb,   -- [{fecha, cadena, visitas, monto}]
    tarifas       jsonb not null default '{}'::jsonb,   -- {cadena: tarifa}
    cerrado_en    timestamptz not null default now()
);
alter table pagos_cortes enable row level security;
create policy "lectura pagos cortes" on pagos_cortes for select using (true);
create policy "escritura pagos cortes" on pagos_cortes for insert with check (true);
create policy "actualiza pagos cortes" on pagos_cortes for update using (true);
create policy "borra pagos cortes" on pagos_cortes for delete using (true);

-- Una fila por auditor y corte, con el estado del pago.
create table if not exists pagos_cortes_auditor (
    id          bigint generated always as identity primary key,
    corte_id    bigint not null references pagos_cortes(id) on delete cascade,
    usuario     text not null,
    visitas     int not null default 0,
    total       numeric not null default 0,
    desglose    jsonb not null default '{}'::jsonb,     -- {cadena: {visitas, tarifa, monto}}
    pagado      boolean not null default false,
    pagado_en   date,
    forma_pago  text,
    referencia  text,
    unique (corte_id, usuario)
);
alter table pagos_cortes_auditor enable row level security;
create policy "lectura pagos auditor" on pagos_cortes_auditor for select using (true);
create policy "escritura pagos auditor" on pagos_cortes_auditor for insert with check (true);
create policy "actualiza pagos auditor" on pagos_cortes_auditor for update using (true);
create policy "borra pagos auditor" on pagos_cortes_auditor for delete using (true);
