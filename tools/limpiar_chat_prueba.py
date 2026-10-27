import json
import pathlib
import sys
import sqlite3
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
body = json.dumps({"requests": [{"type": "execute", "stmt": {"sql": "DELETE FROM mensajes"}}]})
req = urllib.request.Request(host + "/v2/pipeline", data=body.encode(), headers=cls)
r = json.loads(urllib.request.urlopen(req, timeout=20).read())
print("turso DELETE:", r["results"][0]["type"])

con = sqlite3.connect(raiz / "perdonometro.db")
con.execute("DELETE FROM mensajes")
con.commit()
print("copia local vacía:", con.execute("SELECT COUNT(*) FROM mensajes").fetchone()[0] == 0)
con.close()
