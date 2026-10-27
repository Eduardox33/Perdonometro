import sqlite3
import pathlib

raiz = pathlib.Path(__file__).resolve().parent.parent
db = raiz / "perdonometro.db"
schema = (raiz / "db" / "schema.sql").read_text(encoding="utf-8")

con = sqlite3.connect(db)
con.executescript(schema)
con.commit()

tablas = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
print("tablas:", tablas)
fila = con.execute("SELECT sql FROM sqlite_master WHERE name='mensajes'").fetchone()
print("mensajes:", fila[0] if fila else "NO EXISTE")
con.close()
