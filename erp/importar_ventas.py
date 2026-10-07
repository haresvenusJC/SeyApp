#!/usr/bin/env python3
"""Importa el CSV del reporte de ventas del ERP a Supabase.

Uso:
    export SUPABASE_URL=https://snjvdfjouoxnaopgeral.supabase.co
    export SUPABASE_SERVICE_KEY=...   # service_role, NUNCA en el repo ni en el HTML
    python3 erp/importar_ventas.py reporte.csv [--dry-run]
"""
import csv, io, json, os, re, sys, urllib.request
from datetime import date

MESES = {"ENE": 1, "FEB": 2, "MAR": 3, "ABR": 4, "MAY": 5, "JUN": 6,
         "JUL": 7, "AGO": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DIC": 12}
MESES_EN = {"JAN": 1, "APR": 4, "AUG": 8, "DEC": 12}
RE_MES = re.compile(r"^([A-Z]{3})(\d{2})$")


def num(s):
    s = (s or "").replace(",", "").strip()
    return float(s) if s else 0.0


def leer(path):
    raw = open(path, "rb").read()
    for enc in ("utf-8-sig", "latin-1"):
        try:
            texto = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    filas = list(csv.reader(io.StringIO(texto)))
    titulo, fecha = "", date.today()
    for i, f in enumerate(filas):
        celdas = [c.strip() for c in f]
        if celdas and not titulo and celdas[0] and "REFERENCIA" not in celdas:
            titulo = celdas[0]
        if any("emision" in c.lower() for c in celdas):
            m = re.search(r"(\d{4})-([A-Za-z]{3})-(\d{2})", " ".join(celdas))
            if m:
                mes = {**MESES, **MESES_EN}.get(m.group(2).upper())
                if mes:
                    fecha = date(int(m.group(1)), mes, int(m.group(3)))
        if "REFERENCIA" in [c.upper() for c in celdas]:
            return titulo, fecha, [c.upper() for c in celdas], filas[i + 1:]
    sys.exit("No encontre la fila de encabezados (columna REFERENCIA) en el CSV.")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv
    if not args:
        sys.exit(__doc__)
    titulo, fecha, enc, datos = leer(args[0])
    col = {n: i for i, n in enumerate(enc)}
    nombre_col = next(n for n in col if n.startswith("NOMBRE"))
    meses = {}
    for n, i in col.items():
        m = RE_MES.match(n)
        mes = m and {**MESES, **MESES_EN}.get(m.group(1))
        if mes:
            meses[i] = date(2000 + int(m.group(2)), mes, 1).isoformat()

    ventas, exist = [], []
    for f in datos:
        if len(f) <= col["REFERENCIA"] or not f[col["CADENA"]].strip():
            continue  # fila de totales o vacia
        base = {"cadena": f[col["CADENA"]].strip(),
                "referencia": f[col["REFERENCIA"]].strip(),
                "nombre": f[col[nombre_col]].strip()}
        if "EXISTENCIA" in col:
            exist.append({**base, "fecha": fecha.isoformat(),
                          "existencia": num(f[col["EXISTENCIA"]])})
        for i, periodo in meses.items():
            ventas.append({**base, "periodo": periodo, "reporte": titulo,
                           "cantidad": num(f[i]) if i < len(f) else 0})

    print(f"{titulo} | emitido {fecha} | {len(exist)} productos, "
          f"{len(meses)} meses -> {len(ventas)} filas de ventas")
    if dry:
        print(json.dumps(ventas[:2], indent=2, ensure_ascii=False))
        return

    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        sys.exit("Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY en el entorno.")
    for tabla, filas, conflicto in (
            ("ventas_erp", ventas, "cadena,referencia,periodo"),
            ("existencias_erp", exist, "cadena,referencia,fecha")):
        for k in range(0, len(filas), 500):
            req = urllib.request.Request(
                f"{url}/rest/v1/{tabla}?on_conflict={conflicto}",
                data=json.dumps(filas[k:k + 500]).encode(), method="POST",
                headers={"apikey": key, "Authorization": f"Bearer {key}",
                         "Content-Type": "application/json",
                         "Prefer": "resolution=merge-duplicates"})
            urllib.request.urlopen(req).read()
        print(f"{tabla}: {len(filas)} filas cargadas")


if __name__ == "__main__":
    main()
