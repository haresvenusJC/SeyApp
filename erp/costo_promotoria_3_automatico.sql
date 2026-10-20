-- AUTOMATICO: mantiene al dia el cargo "Costo de promotoría" por cadena y mes, sin correr nada a mano.
-- Crea la funcion actualizar_costo_promotoria() (mismo calculo que costo_promotoria_2_aplicar.sql: visitas de
-- Ricardo y Rigo, semanas martes-lunes ya cerradas, tarifa por cadena) y la programa con pg_cron para que
-- corra todos los dias a las 00:30 hora de Ciudad de Mexico. Como el calculo reemplaza el monto de cada
-- cadena/mes con el total actualizado, correrla a diario es seguro: el lunes por la noche cierra la semana
-- y el martes ya aparece en el cargo.
-- Correr UNA sola vez en el proyecto SeyApp. Para cambiar usuarios, tarifas por defecto o el mapeo de cadenas,
-- edita la funcion y vuelve a correr este archivo.

create extension if not exists pg_cron;

create or replace function public.actualizar_costo_promotoria()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
    filas integer;
begin
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
    mapeo_manual (cadena_sucursal, cadena_cargo) as (values ('BENAVIDES', 'Farmacias Benavides'), ('HEB', 'Super Mercados Internacionales')),
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

    insert into public.cargos_mensuales (cliente_nombre, periodo, cargo_tipo_id, monto, notas)
    select c.cadena_cargo, c.periodo,
           (select id from public.cargos_tipos where nombre = 'Costo de promotoría'),
           sum(c.monto),
           'Promotoría (Ricardo y Rigo): ' || sum(c.visitas) || ' visitas, semanas martes-lunes cerradas al ' || (select cierre from params)
    from costo_mes c
    group by c.cadena_cargo, c.periodo
    on conflict (cliente_nombre, periodo, cargo_tipo_id)
    do update set monto = excluded.monto, notas = excluded.notas, capturado_en = now();

    get diagnostics filas = row_count;
    return filas;
end;
$fn$;

-- Solo la ejecuta el cron (y el postgres de Supabase); no se puede llamar desde la API publica.
revoke all on function public.actualizar_costo_promotoria() from public, anon, authenticated;

-- Programacion diaria: 06:30 UTC = 00:30 en Ciudad de Mexico (sin horario de verano).
do $$
begin
    perform cron.unschedule(jobid) from cron.job where jobname = 'costo-promotoria-diario';
    perform cron.schedule('costo-promotoria-diario', '30 6 * * *', 'select public.actualizar_costo_promotoria()');
end $$;

-- Corrida inicial: devuelve cuantos cargos (cadena/mes) se escribieron.
select public.actualizar_costo_promotoria() as cargos_actualizados;
