-- PASO 0 (solo lectura): tablas del esquema public SIN Row-Level Security.
-- Son las que Supabase marca como "Table publicly accessible".
select c.relname as tabla, c.relrowsecurity as rls_activo
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relrowsecurity, c.relname;
