-- Ventas detalladas por documento/folio, con cliente y montos en pesos.
-- Sincronizado desde el reporte "VENTAS ALMACEN 500" del ERP (pantalla SmartReport).
create table if not exists ventas_documentos_erp (
    id              bigint primary key,   -- folio del documento en el ERP
    tipo            text,
    fecha           date not null,
    cliente_codigo  text,
    cliente_nombre  text,
    notas           text,                 -- suele traer el numero de orden de compra / factura
    usuario         text,
    subtotal        numeric,
    iva             numeric,
    total           numeric,
    reporte         text,
    importado_en    timestamptz not null default now()
);
alter table ventas_documentos_erp enable row level security;
-- La app (anon) puede leer este reporte:
create policy "lectura ventas documentos" on ventas_documentos_erp for select using (true);

-- Control de la sincronizacion de este reporte (independiente del de piezas por producto)
create table if not exists erp_sync_estado_docs (
    id             int primary key check (id = 1),
    ultimo_intento timestamptz not null default 'epoch',
    ultimo_ok      timestamptz,
    ultimo_error   text
);
insert into erp_sync_estado_docs (id) values (1) on conflict do nothing;
alter table erp_sync_estado_docs enable row level security;
create policy "lectura estado sync docs" on erp_sync_estado_docs for select using (true);
