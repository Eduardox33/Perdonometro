import json
import pathlib
import sys
import time
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")

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

# deshacer el cobro de prueba: anyi cobró a edu (1000) en la última prueba.
# devuelve los $1.000 a edu, borra ESE movimiento y sube la revisión.
sqls = [
    {"sql": "UPDATE deudas SET debe = debe - 1000 WHERE usuario = 'edu'"},
    {"sql": "DELETE FROM movimientos WHERE ts = (SELECT MAX(ts) FROM movimientos)"},
    {"sql": "UPDATE estado SET revision = ?",
     "args": [{"type": "integer", "value": str(int(time.time() * 1000))}]},
    {"sql": "SELECT usuario, debe FROM deudas"},
    {"sql": "SELECT COUNT(*) AS n FROM movimientos"},
    {"sql": "SELECT COUNT(*) AS n FROM mensajes"},
]
body = json.dumps({"requests": [{"type": "execute", "stmt": s} for s in sqls]})
req = urllib.request.Request(host + "/v2/pipeline", data=body.encode(), headers=cls)
r = json.loads(urllib.request.urlopen(req, timeout=20).read())

deudas = r["results"][3]["response"]["result"]["rows"]
cuantos = r["results"][4]["response"]["result"]["rows"][0][0]["value"]
chat = r["results"][5]["response"]["result"]["rows"][0][0]["value"]
print("deudas:", [(c["value"]) for f in deudas for c in f])
print("movimientos:", cuantos, "/ chat msgs:", chat)
