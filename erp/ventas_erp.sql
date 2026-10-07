-- Ventas mensuales por cadena/producto, importadas del reporte del ERP
-- ("VENTAS DEL AHORRO ULTIMOS 24M"). Formato largo: una fila por producto y mes.
create table if not exists ventas_erp (
    cadena      text    not null,
    referencia  text    not null,          -- codigo de barras / referencia ERP
    nombre      text,
    periodo     date    not null,          -- primer dia del mes
    cantidad    numeric not null default 0,
    reporte     text,                      -- titulo del reporte de origen
    importado_en timestamptz not null default now(),
    primary key (cadena, referencia, periodo)
);

-- Existencia (inventario) al momento de emitir el reporte
create table if not exists existencias_erp (
    cadena      text    not null,
    referencia  text    not null,
    nombre      text,
    fecha       date    not null,          -- fecha de emision del reporte
    existencia  numeric not null default 0,
    primary key (cadena, referencia, fecha)
);

-- Solo el service_role (script de importacion) escribe; la app (anon) no.
alter table ventas_erp enable row level security;
alter table existencias_erp enable row level security;
-- Para que backoffice.html pueda LEER con la anon key, descomenta:
-- create policy "lectura ventas" on ventas_erp for select using (true);
-- create policy "lectura existencias" on existencias_erp for select using (true);

-- Control de la sincronizacion disparada desde la app (limita cuantas veces se llama al ERP)
create table if not exists erp_sync_estado (
    id             int primary key check (id = 1),
    ultimo_intento timestamptz not null default 'epoch',
    ultimo_ok      timestamptz,
    ultimo_error   text
);
insert into erp_sync_estado (id) values (1) on conflict do nothing;
alter table erp_sync_estado enable row level security;
-- La app (anon) puede leer el estado para mostrar "ultima sincronizacion":
create policy "lectura estado sync" on erp_sync_estado for select using (true);
