// Edge Function: descarga el reporte de ventas del ERP y lo guarda en Supabase.
// La dispara la app Sey (login / apertura del backoffice). No tiene horario fijo.
//
// Secretos (supabase secrets set ...):
//   ERP_URL     URL completa del reporte tal como la usa el ERP
//   ERP_COOKIE  cookie de sesion del ERP, ej: "PHPSESSID=abc123"
//   SYNC_KEY    clave propia, solo para el modo de prueba (?dry=1)
//   SYNC_MIN_MINUTOS  (opcional, default 60) minimo entre una sincronizacion y la siguiente
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya vienen incluidos en Supabase.
//
// Como la app es publica (anon key), cualquiera podria invocarla; por eso:
//  - no acepta parametros, solo sincroniza el reporte fijo de ERP_URL;
//  - solo va al ERP si pasaron SYNC_MIN_MINUTOS desde el ultimo intento
//    (el resto de llamadas responde {omitido:true} sin tocar el ERP).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-key",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MESES: Record<string, number> = {
  ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SEP: 9, OCT: 10, NOV: 11, DIC: 12,
  JAN: 1, APR: 4, AUG: 8, DEC: 12,
};

const num = (s?: string) => parseFloat((s ?? "").replace(/,/g, "").trim()) || 0;
const limpiar = (s: string) =>
  s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();

function filasDeHtml(html: string): string[][] {
  const filas: string[][] = [];
  for (const tr of html.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
    const celdas = [...tr[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => limpiar(c[1]));
    if (celdas.length) filas.push(celdas);
  }
  return filas;
}

function filasDeCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [], celda = "", q = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (q) {
      if (ch === '"' && texto[i + 1] === '"') { celda += '"'; i++; }
      else if (ch === '"') q = false;
      else celda += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { fila.push(celda.trim()); celda = ""; }
    else if (ch === "\n") { fila.push(celda.trim()); filas.push(fila); fila = []; celda = ""; }
    else if (ch !== "\r") celda += ch;
  }
  if (celda || fila.length) { fila.push(celda.trim()); filas.push(fila); }
  return filas;
}

function interpretar(filas: string[][]) {
  const iEnc = filas.findIndex((f) => f.some((c) => c.toUpperCase() === "REFERENCIA"));
  if (iEnc < 0) throw new Error("No encontre la columna REFERENCIA en la respuesta del ERP");
  const enc = filas[iEnc].map((c) => c.toUpperCase());
  const col = (n: string) => enc.findIndex((c) => c.startsWith(n));
  const [iCad, iNom, iRef, iEx] = [col("CADENA"), col("NOMBRE"), col("REFERENCIA"), col("EXISTENCIA")];

  const titulo = filas.slice(0, iEnc).map((f) => f[0]).find((t) => t && !/emision/i.test(t)) ?? "";
  const mf = filas.slice(0, iEnc).flat().join(" ").match(/(\d{4})-([A-Za-z]{3})-(\d{2})/);
  const fecha = mf && MESES[mf[2].toUpperCase()]
    ? `${mf[1]}-${String(MESES[mf[2].toUpperCase()]).padStart(2, "0")}-${mf[3]}`
    : new Date().toISOString().slice(0, 10);

  const meses: [number, string][] = [];
  enc.forEach((n, i) => {
    const m = n.match(/^([A-Z]{3})(\d{2})$/);
    if (m && MESES[m[1]]) meses.push([i, `${2000 + +m[2]}-${String(MESES[m[1]]).padStart(2, "0")}-01`]);
  });

  const ventas: any[] = [], existencias: any[] = [];
  for (const f of filas.slice(iEnc + 1)) {
    if (!f[iCad]?.trim() || !f[iRef]?.trim()) continue; // totales / vacias
    const base = { cadena: f[iCad].trim(), referencia: f[iRef].trim(), nombre: f[iNom]?.trim() ?? "" };
    if (iEx >= 0) existencias.push({ ...base, fecha, existencia: num(f[iEx]) });
    for (const [i, periodo] of meses) ventas.push({ ...base, periodo, reporte: titulo, cantidad: num(f[i]) });
  }
  return { titulo, fecha, ventas, existencias };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const dry = new URL(req.url).searchParams.has("dry");
  if (dry && req.headers.get("x-sync-key") !== Deno.env.get("SYNC_KEY")) {
    return json({ ok: false, error: "No autorizado" }, 401);
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Limite de frecuencia: reserva el turno de forma atomica (solo gana una llamada concurrente)
  if (!dry) {
    const minutos = Number(Deno.env.get("SYNC_MIN_MINUTOS") ?? 60);
    const limite = new Date(Date.now() - minutos * 60_000).toISOString();
    const { data: turno } = await db.from("erp_sync_estado")
      .update({ ultimo_intento: new Date().toISOString() })
      .eq("id", 1).lt("ultimo_intento", limite).select("id");
    if (!turno?.length) return json({ ok: true, omitido: true });
  }

  const resp = await fetch(Deno.env.get("ERP_URL")!, {
    headers: { Cookie: Deno.env.get("ERP_COOKIE")!, "User-Agent": "Mozilla/5.0" },
    redirect: "manual",
  });
  const cuerpo = await resp.text();
  if (resp.status >= 300 || /type=["']?password/i.test(cuerpo)) {
    const error = "Sesion del ERP no valida: revisa el secreto ERP_COOKIE";
    if (!dry) await db.from("erp_sync_estado").update({ ultimo_error: error }).eq("id", 1);
    return json({ ok: false, error, status: resp.status }, 502);
  }

  let datos;
  try {
    datos = interpretar(/<table/i.test(cuerpo) ? filasDeHtml(cuerpo) : filasDeCsv(cuerpo));
  } catch (e) {
    if (!dry) await db.from("erp_sync_estado").update({ ultimo_error: String(e) }).eq("id", 1);
    return json({ ok: false, error: String(e) }, 502);
  }
  const { titulo, fecha, ventas, existencias } = datos;
  const resumen = { ok: true, titulo, fecha, productos: existencias.length, filas_ventas: ventas.length };
  if (dry) return json({ ...resumen, muestra: ventas.slice(0, 3) });

  for (const [tabla, filas, conflicto] of [
    ["ventas_erp", ventas, "cadena,referencia,periodo"],
    ["existencias_erp", existencias, "cadena,referencia,fecha"],
  ] as const) {
    for (let i = 0; i < filas.length; i += 500) {
      const { error } = await db.from(tabla).upsert(filas.slice(i, i + 500), { onConflict: conflicto });
      if (error) {
        await db.from("erp_sync_estado").update({ ultimo_error: `${tabla}: ${error.message}` }).eq("id", 1);
        return json({ ok: false, tabla, error: error.message }, 500);
      }
    }
  }
  await db.from("erp_sync_estado")
    .update({ ultimo_ok: new Date().toISOString(), ultimo_error: null }).eq("id", 1);
  return json(resumen);
});
