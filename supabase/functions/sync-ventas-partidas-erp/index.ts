// Edge Function: trae el reporte 377 del ERP ("PARTIDAS HARES SIN TRES") -
// detalle de productos/articulos vendidos por documento - y lo guarda en
// ventas_partidas_erp. Complementa a ventas_documentos_erp (que solo trae el
// total del documento, no el desglose de productos).
//
// Mismo mecanismo de dos pasos que sync-ventas-documentos-erp:
//   1) GET a la pantalla de captura (ERP_URL_PARTIDAS) -> lee la URL de envio fresca.
//   2) POST a esa URL con el rango de fechas.
//
// Modos de llamada (iguales a sync-ventas-documentos-erp):
//   (sin parametros)        incremental desde la ultima sincronizacion exitosa.
//   ?dry=1                  solo prueba, no escribe. Requiere x-sync-key.
//   ?desde=AAAAMMDD&hasta=AAAAMMDD   fuerza un rango puntual. Requiere x-sync-key.
//   ?backfill=1              carga historica automatica por anio. Requiere x-sync-key.
//
// Secretos (supabase secrets set ...):
//   ERP_URL_PARTIDAS           URL fija de la pantalla de captura del reporte 377
//   ERP_COOKIE                 la misma cookie de sesion que usan los otros sync
//   SYNC_KEY                   clave para los modos protegidos
//   SYNC_MIN_MINUTOS           (opcional, default 60)
//   SYNC_DIAS_ATRAS            (opcional, default 730) solo la PRIMERA vez
//   SYNC_DIAS_MARGEN           (opcional, default 5)
//   SYNC_BACKFILL_ANIO_INICIAL (opcional, default 2015)
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

function extraerAccionFormulario(html: string): string {
  const m = html.match(/action=['"]([^'"]*SmartReport_GO\.php[^'"]*)['"]/i);
  if (!m) throw new Error('No encontre el <form action="SmartReport_GO.php..."> en la pantalla de captura');
  return m[1].replace(/&amp;/g, "&");
}

// El SQL del reporte agrega una comilla simple al inicio de CLAVE (CONCAT(CHAR(39),...))
// para forzar que Excel/el navegador lo trate como texto; la quitamos al guardar.
const limpiarClave = (s: string) => s.replace(/^'/, "").trim();

function interpretar(filas: string[][]) {
  const iEnc = filas.findIndex((f) => f.some((c) => c.toUpperCase() === "ID") && f.some((c) => c.toUpperCase() === "TOTAL"));
  if (iEnc < 0) throw new Error("No encontre la fila de encabezados (columnas ID/TOTAL) en la respuesta del ERP");
  const enc = filas[iEnc].map((c) => c.toUpperCase());
  const col = (n: string) => enc.indexOf(n);
  const iId = col("ID"), iDocumento = col("DOCUMENTO"), iTipo = col("TIPO"), iFecha = col("FECHA"),
    iAlmacen = col("ALMACEN"), iCliente = col("CLIENTE"), iClave = col("CLAVE"), iCosto = col("COSTO"),
    iPrecio = col("PRECIO"), iLista = col("LISTA"), iDescripcion = col("DESCRIPCION"),
    iSalidas = col("SALIDAS"), iEntradas = col("ENTRADAS"), iNombre = col("NOMBRE"), iNotas = col("NOTAS"),
    iUsuario = col("USUARIO"), iHora = col("HORA"), iTotal = col("TOTAL");

  const titulo = "PARTIDAS HARES SIN TRES";

  const contadorLinea = new Map<string, number>();
  const partidas: any[] = [];
  for (const f of filas.slice(iEnc + 1)) {
    const idTxt = (f[iId] ?? "").replace(/,/g, "").trim();
    if (!idTxt || !/^\d+$/.test(idTxt)) continue; // fila de totales / vacia
    const documentoTxt = (f[iDocumento] ?? idTxt).replace(/,/g, "").trim();
    const documento = Number(documentoTxt || idTxt);
    const clave = limpiarClave(f[iClave] ?? "");
    const claveGrupo = `${documento}␟${clave}`;
    const linea = (contadorLinea.get(claveGrupo) ?? 0) + 1;
    contadorLinea.set(claveGrupo, linea);
    partidas.push({
      documento,
      tipo: f[iTipo]?.trim() || null,
      fecha: f[iFecha]?.trim() || null,
      almacen: f[iAlmacen]?.trim() || null,
      cliente_codigo: (f[iCliente] ?? "").replace(/,/g, "").trim() || null,
      cliente_nombre: f[iNombre]?.trim() || null,
      clave,
      linea,
      descripcion: f[iDescripcion]?.trim() || null,
      costo: num(f[iCosto]),
      precio: num(f[iPrecio]),
      lista: f[iLista]?.trim() || null,
      salidas: num(f[iSalidas]),
      entradas: num(f[iEntradas]),
      total: num(f[iTotal]),
      notas: f[iNotas]?.trim() || null,
      usuario: f[iUsuario]?.trim() || null,
      hora: f[iHora]?.trim() || null,
      reporte: titulo,
    });
  }
  return { titulo, partidas };
}

type Resultado =
  | { ok: true; partidas: number; titulo: string }
  | { ok: false; error: string };

async function sincronizarRango(db: SupabaseClient, desde: Date, hasta: Date, escribir: boolean): Promise<Resultado> {
  const cookie = Deno.env.get("ERP_COOKIE")!;
  const headersBase = { Cookie: cookie, "User-Agent": UA };

  const respCaptura = await fetch(Deno.env.get("ERP_URL_PARTIDAS")!, {
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
      urlEnvio = new URL(urlEnvio, Deno.env.get("ERP_URL_PARTIDAS")!).toString();
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
      Referer: Deno.env.get("ERP_URL_PARTIDAS")!,
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

  if (!escribir) return { ok: true, partidas: datos.partidas.length, titulo: datos.titulo };

  for (let i = 0; i < datos.partidas.length; i += 500) {
    const { error } = await db.from("ventas_partidas_erp")
      .upsert(datos.partidas.slice(i, i + 500), { onConflict: "documento,clave,linea" });
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true, partidas: datos.partidas.length, titulo: datos.titulo };
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

  if (backfill) {
    const { data: est } = await db.from("erp_sync_estado_partidas").select("backfill_anio").eq("id", 1).single();
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
      await db.from("erp_sync_estado_partidas").update({ ultimo_error: resultado.error }).eq("id", 1);
      return json({ ok: false, anio: anioActual, error: resultado.error }, 502);
    }
    const siguiente = anioActual + 1;
    await db.from("erp_sync_estado_partidas")
      .update({ backfill_anio: siguiente > anioMax ? null : siguiente, ultimo_error: null })
      .eq("id", 1);
    return json({
      ok: true,
      anio: anioActual,
      partidas: resultado.partidas,
      terminado: siguiente > anioMax,
      siguiente_anio: siguiente > anioMax ? null : siguiente,
    });
  }

  if (!dry && !manual) {
    const minutos = Number(Deno.env.get("SYNC_MIN_MINUTOS") ?? 60);
    const limite = new Date(Date.now() - minutos * 60_000).toISOString();
    const { data: turno } = await db.from("erp_sync_estado_partidas")
      .update({ ultimo_intento: new Date().toISOString() })
      .eq("id", 1).lt("ultimo_intento", limite).select("id");
    if (!turno?.length) return json({ ok: true, omitido: true });
  }

  const { data: estado } = await db.from("erp_sync_estado_partidas").select("ultimo_ok").eq("id", 1).single();

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
    if (!dry) await db.from("erp_sync_estado_partidas").update({ ultimo_error: resultado.error }).eq("id", 1);
    return json({ ok: false, error: resultado.error }, 502);
  }

  const resumen = { ok: true, titulo: resultado.titulo, desde: fechaYYYYMMDD(desde), hasta: fechaYYYYMMDD(hoy), partidas: resultado.partidas };
  if (dry) return json(resumen);

  await db.from("erp_sync_estado_partidas")
    .update({ ultimo_ok: new Date().toISOString(), ultimo_error: null }).eq("id", 1);
  return json(resumen);
});
