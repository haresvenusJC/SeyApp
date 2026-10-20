-- PASO 0: agrupa en clientes_cadenas los clientes del ERP de Benavides y de HEB, para que su costo de
-- promotoria aparezca en Analizar rentabilidad igual que Farmacias del Ahorro.
--   Benavides -> cadena "Farmacias Benavides"            (clientes cuyo nombre contiene "benavides")
--   HEB       -> cadena "Super Mercados Internacionales" (clientes cuyo nombre contiene "internacionales")
-- No cambia a los clientes que ya tengan una cadena asignada. Al final muestra que quedo agrupado:
-- revisa que sean los clientes correctos; si sobra alguno, quitalo en Configuracion -> Cadenas (boton X).

insert into public.clientes_cadenas (cliente_nombre, cadena)
select distinct cliente_nombre, 'Farmacias Benavides'
from public.ventas_documentos_erp
where cliente_nombre ilike '%benavides%'
on conflict (cliente_nombre) do nothing;

insert into public.clientes_cadenas (cliente_nombre, cadena)
select distinct cliente_nombre, 'Super Mercados Internacionales'
from public.ventas_documentos_erp
where cliente_nombre ilike '%internacionales%'
on conflict (cliente_nombre) do nothing;

select cadena, cliente_nombre
from public.clientes_cadenas
where cadena in ('Farmacias Benavides', 'Super Mercados Internacionales')
order by cadena, cliente_nombre;
