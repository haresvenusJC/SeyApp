-- Detalle de productos/articulos por documento de venta (partidas), sincronizado
-- desde el reporte 377 del ERP ("PARTIDAS HARES SIN TRES"). Complementa a
-- ventas_documentos_erp (que solo trae el total por documento, no el desglose
-- de que productos se vendieron).
create table if not exists ventas_partidas_erp (
    id              bigint generated always as identity primary key,
    documento       bigint not null,   -- folio del documento (mismo id que ventas_documentos_erp.id)
    tipo            text,
    fecha           date not null,
    almacen         text,
    cliente_codigo  text,
    cliente_nombre  text,
    clave           text,              -- codigo del producto
    descripcion     text,              -- descripcion del producto
    costo           numeric,
    precio          numeric,
    lista           text,
    salidas         numeric,           -- piezas vendidas
    entradas        numeric,           -- piezas devueltas/entradas
    total           numeric,
    notas           text,
    usuario         text,
    hora            text,
    reporte         text,
    importado_en    timestamptz not null default now(),
    unique (documento, clave)
);
alter table ventas_partidas_erp enable row level security;
create policy "lectura ventas partidas" on ventas_partidas_erp for select using (true);

create index if not exists idx_ventas_partidas_documento on ventas_partidas_erp (documento);
create index if not exists idx_ventas_partidas_fecha on ventas_partidas_erp (fecha);

-- Control de sincronizacion de este reporte (independiente de los otros dos)
create table if not exists erp_sync_estado_partidas (
    id             int primary key check (id = 1),
    ultimo_intento timestamptz not null default 'epoch',
    ultimo_ok      timestamptz,
    ultimo_error   text,
    backfill_anio  int
);
insert into erp_sync_estado_partidas (id) values (1) on conflict do nothing;
alter table erp_sync_estado_partidas enable row level security;
create policy "lectura estado sync partidas" on erp_sync_estado_partidas for select using (true);
