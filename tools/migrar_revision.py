import json
import pathlib
import sys
import sqlite3
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")

# Agrega la columna `revision` a la tabla `estado` (Turso + copia local .db).
# Uso: python tools\migrar_revision.py

raiz = pathlib.Path(__file__).resolve().parent.parent
cfg = (raiz / "config.js").read_text(encoding="utf-8")
url = token = None
for linea in cfg.splitlines():
    linea = linea.strip()
    if linea.startswith("url:"):
        url = linea.split(":", 1)[1].strip().rstrip(",").strip('"')
    if linea.startswith("authToken:"):
        token = linea.split(":", 1)[1].strip().rstrip(",").strip('"')

host = url.replace("libsql://", "https://")
cls = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}


def pipeline(sentencias):
    body = json.dumps({"requests": [{"type": "execute", "stmt": s} for s in sentencias]})
    req = urllib.request.Request(host + "/v2/pipeline", data=body.encode(), headers=cls)
    return json.loads(urllib.request.urlopen(req, timeout=20).read())


def ejecutar_turso():
    # ALTER falla si la columna ya existe: se tolera
    try:
        r = pipeline([
            {"sql": "ALTER TABLE estado ADD COLUMN revision INTEGER NOT NULL DEFAULT 0"},
        ])
        print("turso ALTER:", r["results"][0]["type"])
    except urllib.error.HTTPError as e:
        cuerpo = e.read().decode(errors="replace")
        if "duplicate column" in cuerpo.lower() or "already exists" in cuerpo.lower():
            print("turso ALTER: la columna ya existía")
        else:
            raise

    r = pipeline([
        {"sql": "UPDATE estado SET revision = actualizado WHERE id = 1"},
        {"sql": "SELECT meta, actualizado, revision FROM estado WHERE id = 1"},
    ])
    fila = r["results"][1]["response"]["result"]["rows"][0]
    print("turso estado:", [c["value"] for c in fila])


def ejecutar_local():
    con = sqlite3.connect(raiz / "perdonometro.db")
    nombres = [r[1] for r in con.execute("PRAGMA table_info(estado)")]
    if "revision" not in nombres:
        con.execute("ALTER TABLE estado ADD COLUMN revision INTEGER NOT NULL DEFAULT 0")
        print("local ALTER: agregada")
    else:
        print("local ALTER: la columna ya existía")
    con.execute("UPDATE estado SET revision = actualizado WHERE id = 1")
    con.commit()
    print("local estado:", con.execute("SELECT meta, actualizado, revision FROM estado WHERE id = 1").fetchone())
    con.close()


ejecutar_turso()
ejecutar_local()
