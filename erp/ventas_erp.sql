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
