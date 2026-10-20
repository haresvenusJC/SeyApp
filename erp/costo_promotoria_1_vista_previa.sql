-- VISTA PREVIA (solo lectura): costo de promotoria por cadena y mes, de Ricardo y Rigo, con semanas
-- cerradas (martes a lunes). Corre esto primero y revisa; no modifica nada.
-- Revisa: "coincide_clientes_cadenas" en false => el nombre de la cadena no existe en clientes_cadenas
-- y el cargo no saldria en Analizar rentabilidad (arreglalo en mapeo_manual); "cargo_existente" => ya hay un
-- monto capturado en ese mes que el paso de aplicar reemplazaria; "desde" => primer dia con visitas.
with
-- Ultimo lunes ya terminado (las semanas van de martes a lunes): solo cuentan semanas cerradas.
params as (
    select date_trunc('week', ((now() at time zone 'America/Mexico_City')::date - 1))::date as cierre
),
-- Tarifas por visita: tarifas_cadena y, si falta la cadena, los valores por defecto de la app.
tarifa_default (cadena, tarifa) as (values ('BENAVIDES', 60), ('DEL AHORRO', 80), ('HEB', 100)),
-- Usuarios considerados.
usuarios_considerados (usuario) as (values ('ricardo'), ('rigo')),
-- Si el nombre de una cadena de sucursales no coincide con la cadena de clientes_cadenas (la que usa
-- Analizar rentabilidad), escribe aqui la equivalencia, p. ej. ('DEL AHORRO', 'Farmacias del Ahorro').
mapeo_manual (cadena_sucursal, cadena_cargo) as (values (null::text, null::text)),
visitas_dia as (
    select s.cadena as cadena_suc,
           (v.created_at at time zone 'America/Mexico_City')::date as dia
    from public.visitas_auditoria v
    join public.sucursales s on s.id = v.sucursal_id
    join usuarios_considerados u on u.usuario = lower(v.usuario)
    where s.cadena is not null
),
cadenas_suc as (
    select distinct cadena_suc from visitas_dia
),
nombre_cargo as (
    select c.cadena_suc,
           coalesce(
               (select m.cadena_cargo from mapeo_manual m where m.cadena_sucursal = c.cadena_suc),
               (select cc.cadena from (select distinct cadena from public.clientes_cadenas) cc
                 where lower(cc.cadena) like '%' || lower(c.cadena_suc) || '%'
                    or lower(c.cadena_suc) like '%' || lower(cc.cadena) || '%'
                 order by length(cc.cadena) limit 1),
               c.cadena_suc
           ) as cadena_cargo,
           exists (select 1 from public.clientes_cadenas cc where cc.cadena = coalesce(
               (select m.cadena_cargo from mapeo_manual m where m.cadena_sucursal = c.cadena_suc),
               (select cc2.cadena from (select distinct cadena from public.clientes_cadenas) cc2
                 where lower(cc2.cadena) like '%' || lower(c.cadena_suc) || '%'
                    or lower(c.cadena_suc) like '%' || lower(cc2.cadena) || '%'
                 order by length(cc2.cadena) limit 1))) as coincide_clientes_cadenas
    from cadenas_suc c
),
costo_mes as (
    select n.cadena_cargo, n.cadena_suc, n.coincide_clientes_cadenas,
           date_trunc('month', v.dia)::date as periodo,
           count(*) as visitas,
           sum(coalesce(t.tarifa, d.tarifa, 0)) as monto,
           min(v.dia) as desde
    from visitas_dia v
    join nombre_cargo n on n.cadena_suc = v.cadena_suc
    left join public.tarifas_cadena t on t.cadena = v.cadena_suc
    left join tarifa_default d on d.cadena = v.cadena_suc
    cross join params p
    where v.dia <= p.cierre and coalesce(t.tarifa, d.tarifa, 0) > 0
    group by n.cadena_cargo, n.cadena_suc, n.coincide_clientes_cadenas, date_trunc('month', v.dia)
)

select c.periodo, c.cadena_cargo, c.cadena_suc as cadena_sucursales, c.coincide_clientes_cadenas,
       c.visitas, c.monto as costo_calculado,
       (select m.monto from public.cargos_mensuales m
         where m.cliente_nombre = c.cadena_cargo and m.periodo = c.periodo
           and m.cargo_tipo_id = (select id from public.cargos_tipos where nombre = 'Costo de promotoría')) as cargo_existente,
       c.desde,
       (select cierre from params) as semanas_cerradas_hasta
from costo_mes c
order by c.periodo, c.cadena_cargo;
