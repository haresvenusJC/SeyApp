// Edge Function: trae el reporte "VENTAS ALMACEN 500" del ERP (folio, cliente,
// subtotal, IVA, total) y lo guarda en ventas_documentos_erp.
//
// A diferencia de sync-ventas-erp, este reporte pide un rango de fechas en una
// pantalla de captura (PARAM1/PARAM2). Esa pantalla genera, cada vez que se abre,
// una URL de envio nueva (SmartReport_GO.php?a=...&b=...&z=...) incrustada en su
// propio HTML. Por eso esta funcion hace DOS pasos:
//   1) GET a la pantalla de captura (ERP_URL_DOCUMENTOS) -> lee esa URL de envio.
//   2) POST a esa URL con las fechas que queramos (por defecto: ultimos 24 meses).
//
// Secretos (supabase secrets set ...):
//   ERP_URL_DOCUMENTOS  URL fija de la pantalla de captura "VENTAS ALMACEN 500"
//   ERP_COOKIE          la misma cookie de sesion que usa sync-ventas-erp
//   SYNC_KEY            la misma clave, solo para el modo de prueba (?dry=1)
//   SYNC_MIN_MINUTOS    (opcional, default 60)
//   SYNC_DIAS_ATRAS     (opcional, default 730 = ~24 meses) cuantos dias atras pedir
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya vienen incluidos en Supabase.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-key",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const UA = "SeyApp-sync (integracion ventas SEY)";
const num = (s?: string) => parseFloat((s ?? "").replace(/,/g, "").trim()) || 0;
const limpiar = (s: string) =>
  s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();

function filasDeHtml(html: string): string[][] {
  const filas: string[][] = [];
  for (const tr of html.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
    const celdas = [...tr[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => limpiar(c[1]));
    if (celdas.length) filas.push(celdas);
  }
  return filas;
}

// El reporte sale como texto plano (TIPOREPORTE=4), separado por ";" (TXTCampos)
// con saltos de linea CRLF (TXTLinea = chr(13).chr(10)).
function filasDeCsv(texto: string): string[][] {
  const limpio = texto.replace(/^﻿/, "");
  return limpio
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => l.split(";").map((c) => c.replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim()));
}

function fechaYYYYMMDD(d: Date) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

// Extrae del HTML de la pantalla de captura la URL de envio (<form ... action='SmartReport_GO.php?...'>)
function extraerAccionFormulario(html: string): string {
  const m = html.match(/action=['"]([^'"]*SmartReport_GO\.php[^'"]*)['"]/i);
  if (!m) throw new Error('No encontre el <form action="SmartReport_GO.php..."> en la pantalla de captura');
  return m[1].replace(/&amp;/g, "&");
}

function interpretar(filas: string[][]) {
  const iEnc = filas.findIndex((f) => f.some((c) => c.toUpperCase() === "ID") && f.some((c) => c.toUpperCase() === "TOTAL"));
  if (iEnc < 0) throw new Error("No encontre la fila de encabezados (columnas ID/TOTAL) en la respuesta del ERP");
  const enc = filas[iEnc].map((c) => c.toUpperCase());
  const col = (n: string) => enc.indexOf(n);
  const iId = col("ID"), iTipo = col("TIPO"), iFecha = col("FECHA"), iCliente = col("CLIENTE"),
    iNombre = col("NOMBRE"), iNotas = col("NOTAS"), iUsuario = col("USUARIO"),
    iSubtotal = col("SUBTOTAL"), iIva = col("IVA"), iTotal = col("TOTAL");

  const titulo = filas.slice(0, iEnc).map((f) => f[0]).find((t) => t && !/emision|fecha/i.test(t)) ?? "";

  const docs: any[] = [];
  for (const f of filas.slice(iEnc + 1)) {
    const idTxt = (f[iId] ?? "").replace(/,/g, "").trim();
    if (!idTxt || !/^\d+$/.test(idTxt)) continue; // fila de totales / vacia
    docs.push({
      id: Number(idTxt),
      tipo: f[iTipo]?.trim() || null,
      fecha: f[iFecha]?.trim() || null,
      cliente_codigo: (f[iCliente] ?? "").replace(/,/g, "").trim() || null,
      cliente_nombre: f[iNombre]?.trim() || null,
      notas: f[iNotas]?.trim() || null,
      usuario: f[iUsuario]?.trim() || null,
      subtotal: num(f[iSubtotal]),
      iva: num(f[iIva]),
      total: num(f[iTotal]),
      reporte: titulo,
    });
  }
  return { titulo, docs };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const dry = new URL(req.url).searchParams.has("dry");
  if (dry && req.headers.get("x-sync-key") !== Deno.env.get("SYNC_KEY")) {
    return json({ ok: false, error: "No autorizado" }, 401);
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (!dry) {
    const minutos = Number(Deno.env.get("SYNC_MIN_MINUTOS") ?? 60);
    const limite = new Date(Date.now() - minutos * 60_000).toISOString();
    const { data: turno } = await db.from("erp_sync_estado_docs")
      .update({ ultimo_intento: new Date().toISOString() })
      .eq("id", 1).lt("ultimo_intento", limite).select("id");
    if (!turno?.length) return json({ ok: true, omitido: true });
  }

  const cookie = Deno.env.get("ERP_COOKIE")!;
  const headersBase = { Cookie: cookie, "User-Agent": UA };

  // Paso 1: pantalla de captura -> extraer la URL de envio fresca
  const respCaptura = await fetch(Deno.env.get("ERP_URL_DOCUMENTOS")!, {
    headers: headersBase, redirect: "manual", signal: AbortSignal.timeout(20_000),
  });
  const htmlCaptura = await respCaptura.text();
  if (respCaptura.status >= 300 || /type=["']?password/i.test(htmlCaptura)) {
    const error = "Sesion del ERP no valida: revisa el secreto ERP_COOKIE";
    if (!dry) await db.from("erp_sync_estado_docs").update({ ultimo_error: error }).eq("id", 1);
    return json({ ok: false, error, status: respCaptura.status }, 502);
  }

  let urlEnvio: string;
  try {
    urlEnvio = extraerAccionFormulario(htmlCaptura);
    if (!/^https?:\/\//i.test(urlEnvio)) {
      urlEnvio = new URL(urlEnvio, Deno.env.get("ERP_URL_DOCUMENTOS")!).toString();
    }
  } catch (e) {
    if (!dry) await db.from("erp_sync_estado_docs").update({ ultimo_error: String(e) }).eq("id", 1);
    return json({ ok: false, error: String(e) }, 502);
  }

  // Paso 2: POST con el rango de fechas (por defecto, ultimos ~24 meses)
  const diasAtras = Number(Deno.env.get("SYNC_DIAS_ATRAS") ?? 730);
  const hoy = new Date();
  const desde = new Date(Date.now() - diasAtras * 86_400_000);
  const cuerpo = new URLSearchParams({
    PARAM1: fechaYYYYMMDD(desde),
    PARAM2: fechaYYYYMMDD(hoy),
    PARAM3: "", PARAM4: "", PARAM5: "", PARAM6: "", PARAM7: "", PARAM8: "", PARAM9: "", PARAM10: "",
    ORDENA1: "", ORDENA2: "", ORDENA3: "",
    TIPOREPORTE: "4", // salida en texto plano (CSV), la unica que trae los datos en el cuerpo de la respuesta
    LATINFUNNEL: "1",
    TXTCampos: ";", TXTLinea: "chr(13).chr(10)", TXTTitulos: "1", TXTTotales: "1", TXTDecimal: ".",
  });

  const respGo = await fetch(urlEnvio, {
    method: "POST",
    headers: {
      ...headersBase,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: Deno.env.get("ERP_URL_DOCUMENTOS")!,
    },
    body: cuerpo.toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const htmlGo = await respGo.text();
  if (respGo.status >= 300) {
    const error = `El ERP respondio ${respGo.status} al generar el reporte`;
    if (!dry) await db.from("erp_sync_estado_docs").update({ ultimo_error: error }).eq("id", 1);
    return json({ ok: false, error }, 502);
  }

  let datos;
  try {
    datos = interpretar(filasDeCsv(htmlGo));
  } catch (e) {
    const crudo = htmlGo.slice(0, 4000);
    if (!dry) await db.from("erp_sync_estado_docs").update({ ultimo_error: String(e) }).eq("id", 1);
    return json({ ok: false, error: String(e), crudo }, 502);
  }

  const resumen = { ok: true, titulo: datos.titulo, desde: fechaYYYYMMDD(desde), hasta: fechaYYYYMMDD(hoy), documentos: datos.docs.length };
  if (dry) return json({ ...resumen, muestra: datos.docs.slice(0, 3) });

  for (let i = 0; i < datos.docs.length; i += 500) {
    const { error } = await db.from("ventas_documentos_erp").upsert(datos.docs.slice(i, i + 500), { onConflict: "id" });
    if (error) {
      await db.from("erp_sync_estado_docs").update({ ultimo_error: error.message }).eq("id", 1);
      return json({ ok: false, error: error.message }, 500);
    }
  }
  await db.from("erp_sync_estado_docs")
    .update({ ultimo_ok: new Date().toISOString(), ultimo_error: null }).eq("id", 1);
  return json(resumen);
});
