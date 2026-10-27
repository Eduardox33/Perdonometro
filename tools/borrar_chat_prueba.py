import json
import pathlib
import sys
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
sqls = [
    {"sql": "DELETE FROM mensajes"},
    {"sql": "SELECT COUNT(*) AS n FROM mensajes"},
]
body = json.dumps({"requests": [{"type": "execute", "stmt": s} for s in sqls]})
req = urllib.request.Request(host + "/v2/pipeline", data=body.encode(), headers=cls)
r = json.loads(urllib.request.urlopen(req, timeout=20).read())
n = r["results"][1]["response"]["result"]["rows"][0][0]["value"]
print("mensajes de chat restantes:", n)
