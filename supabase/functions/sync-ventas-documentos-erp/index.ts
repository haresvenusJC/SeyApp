// Edge Function: trae el reporte "VENTAS ALMACEN 500" del ERP (folio, cliente,
// subtotal, IVA, total) y lo guarda en ventas_documentos_erp.
//
// A diferencia de sync-ventas-erp, este reporte pide un rango de fechas en una
// pantalla de captura (PARAM1/PARAM2). Esa pantalla genera, cada vez que se abre,
// una URL de envio nueva (SmartReport_GO.php?a=...&b=...&z=...) incrustada en su
// propio HTML. Por eso esta funcion hace DOS pasos:
//   1) GET a la pantalla de captura (ERP_URL_DOCUMENTOS) -> lee esa URL de envio.
//   2) POST a esa URL con las fechas que queramos.
//
// Modos de llamada:
//   (sin parametros)        sync normal/automatica: incremental desde la ultima
//                            sincronizacion exitosa (o SYNC_DIAS_ATRAS si es la primera vez).
//   ?dry=1                  solo prueba, no escribe en la tabla. Requiere x-sync-key.
//   ?desde=AAAAMMDD&hasta=AAAAMMDD   fuerza un rango puntual. Requiere x-sync-key.
//   ?backfill=1              carga historica automatica: cada llamada (con los MISMOS
//                            parametros) procesa el siguiente anio pendiente, desde
//                            SYNC_BACKFILL_ANIO_INICIAL hasta el anio actual. Requiere x-sync-key.
//
// Secretos (supabase secrets set ...):
//   ERP_URL_DOCUMENTOS        URL fija de la pantalla de captura "VENTAS ALMACEN 500"
//   ERP_COOKIE                la misma cookie de sesion que usa sync-ventas-erp
//   SYNC_KEY                  clave para los modos protegidos (dry/desde-hasta/backfill)
//   SYNC_MIN_MINUTOS          (opcional, default 60)
//   SYNC_DIAS_ATRAS           (opcional, default 730 = ~24 meses) solo se usa la PRIMERA vez
//                              (cuando erp_sync_estado_docs.ultimo_ok todavia es nulo)
//   SYNC_DIAS_MARGEN          (opcional, default 5) en sincronizaciones siguientes, cuantos
//                              dias antes de la ultima sincronizacion exitosa volver a pedir
//   SYNC_BACKFILL_ANIO_INICIAL (opcional, default 2015) primer anio de la carga historica
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya vienen incluidos en Supabase.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function fechaYYYYMMDD(d: Date) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function parseYYYYMMDD(s: string): Date {
  const y = Number(s.slice(0, 4)), m = Number(s.slice(4, 6)) - 1, d = Number(s.slice(6, 8));
  return new Date(y, m, d);
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

  const titulo = "VENTAS ALMACEN 500";

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

type Resultado =
  | { ok: true; documentos: number; titulo: string }
  | { ok: false; error: string };

// Hace el ciclo completo (captura -> envio -> parseo -> guardado) para un rango de fechas dado.
async function sincronizarRango(db: SupabaseClient, desde: Date, hasta: Date, escribir: boolean): Promise<Resultado> {
  const cookie = Deno.env.get("ERP_COOKIE")!;
  const headersBase = { Cookie: cookie, "User-Agent": UA };

  const respCaptura = await fetch(Deno.env.get("ERP_URL_DOCUMENTOS")!, {
    headers: headersBase, redirect: "manual", signal: AbortSignal.timeout(20_000),
  });
  const htmlCaptura = await respCaptura.text();
  if (respCaptura.status >= 300 || /type=["']?password/i.test(htmlCaptura)) {
    return { ok: false, error: "Sesion del ERP no valida: revisa el secreto ERP_COOKIE" };
  }

  let urlEnvio: string;
  try {
    urlEnvio = extraerAccionFormulario(htmlCaptura);
    if (!/^https?:\/\//i.test(urlEnvio)) {
      urlEnvio = new URL(urlEnvio, Deno.env.get("ERP_URL_DOCUMENTOS")!).toString();
    }
  } catch (e) {
    return { ok: false, error: String(e) };
  }

  const cuerpo = new URLSearchParams({
    PARAM1: fechaYYYYMMDD(desde),
    PARAM2: fechaYYYYMMDD(hasta),
    PARAM3: "", PARAM4: "", PARAM5: "", PARAM6: "", PARAM7: "", PARAM8: "", PARAM9: "", PARAM10: "",
    ORDENA1: "", ORDENA2: "", ORDENA3: "",
    TIPOREPORTE: "1", // vista de impresion: trae una tabla <table> con los datos en el cuerpo HTML
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
    return { ok: false, error: `El ERP respondio ${respGo.status} al generar el reporte` };
  }

  let datos;
  try {
    datos = interpretar(filasDeHtml(htmlGo));
  } catch (e) {
    return { ok: false, error: String(e) };
  }

  if (!escribir) return { ok: true, documentos: datos.docs.length, titulo: datos.titulo };

  for (let i = 0; i < datos.docs.length; i += 500) {
    const { error } = await db.from("ventas_documentos_erp").upsert(datos.docs.slice(i, i + 500), { onConflict: "id" });
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true, documentos: datos.docs.length, titulo: datos.titulo };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const params = new URL(req.url).searchParams;
  const dry = params.has("dry");
  const desdeParam = params.get("desde");
  const hastaParam = params.get("hasta");
  const manual = !!(desdeParam || hastaParam);
  const backfill = params.has("backfill");

  if ((dry || manual || backfill) && req.headers.get("x-sync-key") !== Deno.env.get("SYNC_KEY")) {
    return json({ ok: false, error: "No autorizado" }, 401);
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Modo backfill: avanza solo, un anio por llamada, sin necesidad de editar parametros.
  if (backfill) {
    const { data: est } = await db.from("erp_sync_estado_docs").select("backfill_anio").eq("id", 1).single();
    const anioInicial = Number(Deno.env.get("SYNC_BACKFILL_ANIO_INICIAL") ?? 2015);
    const anioActual = est?.backfill_anio ?? anioInicial;
    const anioMax = new Date().getFullYear();
    if (anioActual > anioMax) {
      return json({ ok: true, terminado: true, mensaje: "La carga historica ya cubrio todos los anios." });
    }
    const desdeAnio = new Date(anioActual, 0, 1);
    const hastaAnio = anioActual === anioMax ? new Date() : new Date(anioActual, 11, 31);
    const resultado = await sincronizarRango(db, desdeAnio, hastaAnio, true);
    if (!resultado.ok) {
      await db.from("erp_sync_estado_docs").update({ ultimo_error: resultado.error }).eq("id", 1);
      return json({ ok: false, anio: anioActual, error: resultado.error }, 502);
    }
    const siguiente = anioActual + 1;
    await db.from("erp_sync_estado_docs")
      .update({ backfill_anio: siguiente > anioMax ? null : siguiente, ultimo_error: null })
      .eq("id", 1);
    return json({
      ok: true,
      anio: anioActual,
      documentos: resultado.documentos,
      terminado: siguiente > anioMax,
      siguiente_anio: siguiente > anioMax ? null : siguiente,
    });
  }

  if (!dry && !manual) {
    const minutos = Number(Deno.env.get("SYNC_MIN_MINUTOS") ?? 60);
    const limite = new Date(Date.now() - minutos * 60_000).toISOString();
    const { data: turno } = await db.from("erp_sync_estado_docs")
      .update({ ultimo_intento: new Date().toISOString() })
      .eq("id", 1).lt("ultimo_intento", limite).select("id");
    if (!turno?.length) return json({ ok: true, omitido: true });
  }

  // Si ya sincronizo con exito antes, solo pedimos desde esa fecha (con un
  // margen de unos dias por si el ERP corrige documentos recientes). Si nunca
  // ha sincronizado, traemos el historico completo (SYNC_DIAS_ATRAS).
  const { data: estado } = await db.from("erp_sync_estado_docs").select("ultimo_ok").eq("id", 1).single();

  let hoy = new Date();
  let desde: Date;
  if (manual) {
    desde = desdeParam ? parseYYYYMMDD(desdeParam) : new Date(Date.now() - 730 * 86_400_000);
    if (hastaParam) hoy = parseYYYYMMDD(hastaParam);
  } else if (estado?.ultimo_ok) {
    const diasMargen = Number(Deno.env.get("SYNC_DIAS_MARGEN") ?? 5);
    desde = new Date(new Date(estado.ultimo_ok).getTime() - diasMargen * 86_400_000);
  } else {
    const diasAtras = Number(Deno.env.get("SYNC_DIAS_ATRAS") ?? 730);
    desde = new Date(Date.now() - diasAtras * 86_400_000);
  }

  const resultado = await sincronizarRango(db, desde, hoy, !dry);
  if (!resultado.ok) {
    if (!dry) await db.from("erp_sync_estado_docs").update({ ultimo_error: resultado.error }).eq("id", 1);
    return json({ ok: false, error: resultado.error }, 502);
  }

  const resumen = { ok: true, titulo: resultado.titulo, desde: fechaYYYYMMDD(desde), hasta: fechaYYYYMMDD(hoy), documentos: resultado.documentos };
  if (dry) return json(resumen);

  await db.from("erp_sync_estado_docs")
    .update({ ultimo_ok: new Date().toISOString(), ultimo_error: null }).eq("id", 1);
  return json(resumen);
});
