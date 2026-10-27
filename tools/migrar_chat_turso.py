import json
import pathlib
import urllib.request

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

sqls = [
    {"sql": "CREATE TABLE IF NOT EXISTS mensajes (id INTEGER PRIMARY KEY AUTOINCREMENT, autor TEXT NOT NULL, texto TEXT NOT NULL, ts INTEGER NOT NULL)"},
    {"sql": "SELECT id, autor, texto, ts FROM mensajes LIMIT 0"},
]
body = json.dumps({"requests": [{"type": "execute", "stmt": s} for s in sqls]})
req = urllib.request.Request(host + "/v2/pipeline", data=body.encode(), headers=cls)
with urllib.request.urlopen(req, timeout=20) as r:
    print("estado:", r.status)
    print("respuesta:", r.read().decode()[:400])
