# 🫙 El Perdonómetro

App web (PWA) con aspecto **kawaii pastel celeste** donde un frasco se va llenando de
**billetes** cada vez que alguien "cobra una luca". Hecha 100 % con **HTML + CSS +
JavaScript vanilla** (sin frameworks, sin build).

---

## 📱 Cómo verla

**1. Rápida (solo diseño):** doble clic en `index.html`.

**2. Como app de verdad (activa manifest + service worker):**

```powershell
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```

y abre **http://localhost:8765/**. En Chrome/Edge: menú ⋮ → *Instalar El Perdonómetro*.
En el teléfono: *Agregar a pantalla de inicio*.

---

## 👥 Los dos usuarios

| Usuario | Contraseña | Quién es |
|---------|------------|----------|
| `anyi`  | `2712`     | Anyi     |
| `edu`   | `0608`     | Edu      |

Están en `config.js` (arreglo `usuarios`), y también en `db/schema.sql` para la base.
La sesión queda en `localStorage` → no vuelve a pedirla hasta que cierres sesión
(botón ⏻ arriba a la derecha).

---

## 🎯 Reglas del juego

1. **"Cobrar luca"** le suma **$1.000 al otro**:
   - Anyi aprieta → **Edu debe $1.000 más**.
   - Edu aprieta → **Anyi debe $1.000 más**.
2. Al apretar aparece el diálogo **"¿Estás seguro?"** → *Sí, cobrar* o *No, aún no*.
3. El **marcador** muestra siempre **cuánto le debe cada uno** ("debe hasta ahora"),
   y quién está logueado aparece marcado con **"tú"**.
4. El **contador grande** es el total del frasco (la suma de ambas deudas).
5. El frasco se ve **lleno a $300.000** y ahí se queda visualmente, pero **no hay
   tope de dinero**: el contador sigue subiendo y **la animación de billetes entrando
   se sigue reproduciendo** con cada cobro. No hay barra de progreso ni texto de meta:
   el frasco vacío queda completamente limpio.
6. Historial con los últimos cobros (quién cobró a quién, fecha y hora).
7. **"Chat" 💬**: un chat compacto (entre el botón de cobrar y los últimos
   cobros) para escribirse mensajitos el uno al otro. Muestra los últimos 30 y
   scrolleando hacia arriba trae el resto; lo nuevo llega solo (misma petición
   del sondeo, lectura incremental para no gastar reads de Turso).
8. **Tiempo real**: si abres la app en dos pestañas, un cobro se refleja en las dos.

---

## 🗂 Estructura

```
index.html              interfaz (login + app + modal + avisos)
styles.css              todo el estilo kawaii pastel (billetes incluidos)
config.js               usuarios, moneda, meta y datos de Turso
js/store.js             capa de datos (Local + Turso) ← aquí se conecta la base
js/app.js               lógica de la interfaz
db/schema.sql           esquema SQLite para subir a Turso
manifest.webmanifest    para que se vea como aplicación
sw.js                   service worker (offline + caché)
icons/                  iconos PNG generados
tools/gen-icons.ps1     regenera los iconos
tools/serve.ps1         servidor local para probar
```

---

## 🐢 Base de datos en Turso (SQLite) — ✅ YA CONECTADA

La app **ya está hablando con Turso**. En `config.js` están el `url` y el `authToken`:

```js
turso: {
  url: "libsql://perdonometro-eduardox33.aws-sa-east-1.turso.io",
  authToken: "eyJ...",
  sondeoMs: 2000,   // cuánto (ms) se consulta para el tiempo real
},
```

Mientras `url` esté vacío la app usa `localStorage`; al tenerlo, se activa solo el
`AdaptadorTurso` de `js/store.js`, que habla **directo con la API HTTP de Turso**
(`/v2/pipeline`) usando `fetch`, sin librerías ni build.

### Lo que ya existe en la base

| tabla | para qué |
|---|---|
| `usuarios` | anyi/2712 y edu/0608 (de aquí sale el login) |
| `estado` | una sola fila con la meta del frasco (300.000) |

> La meta **no se muestra en pantalla** (no hay barra de progreso ni texto de %):
> solo gobierna qué tan lleno se ve el frasco. El contador y los cobros no tienen tope.
| `deudas` | una fila por persona: cuánto le debe cada uno |
| `movimientos` | historial de cobros (autor, deudor, monto, fecha) |

El esquema completo (por si quieres recrearla o verlo) está en **`db/schema.sql`**:

```powershell
turso db shell perdonometro < db\schema.sql
```

> Si tu base ya era solo la de 4 tablas y quieres agregar el chat a mano, este es
> el query (también está en `schema.sql` y lo dejamos como `tools/migrar_chat_turso.py`):
>
> ```sql
> CREATE TABLE IF NOT EXISTS mensajes (
>   id    INTEGER PRIMARY KEY AUTOINCREMENT,
>   autor TEXT NOT NULL,
>   texto TEXT NOT NULL,
>   ts    INTEGER NOT NULL
> );
> ```

### Reiniciar los contadores

```sql
UPDATE deudas SET debe = 0, actualizado = 0;
DELETE FROM movimientos;
DELETE FROM mensajes; -- borra también todo el chat
```

**Ojo:** al tocar la base a mano (o desde `turso db shell`), no olvides subir la
revisión para que las apps abiertas la detecten al tiro:

```sql
UPDATE estado SET revision = (unixepoch('now') + 1) * 1000 WHERE id = 1;
```

(Si no, no pasa nada grave: las apps re-leen todo cada 15 sondeos como red de
seguridad, máximo ~30 s de tardanza.)

### Rotar el token

Si algún día quieres cambiarlo (por ejemplo, si lo compartiste):
`turso db tokens create perdonometro` y pega el nuevo en `config.js`.

**NOTA de seguridad:** el token queda en el navegador, o sea que cualquier persona
con la URL podría leer/escribir la base. Para esta app de 2 usuarios en sus propios
celulares funciona; si algún día es pública, mueve login y escritura a una función
serverless y deja el token solo ahí.

### Comprobaciones hechas
- Login validado contra `usuarios` (clave mala → "Usuario o contraseña incorrectos").
- "Cobrar luca" escribe en `deudas` y `movimientos` de Turso.
- **Tiempo real entre dispositivos**: modificando la base desde fuera, la app abierta
  se actualiza sola cada 2 s sin recargar.

---

## 🧁 Detalles técnicos

- **Sin emoji raros:** las billetes y monedas son CSS puro, así se ven bien en
  cualquier celular.
- **Animaciones:** billete cayendo, frasco con rebote, contador con count-up,
  oleaje de billetes en la pila y chispas.
- **Offline:** el service worker guarda la app; los datos locales siguen en
  `localStorage` hasta que se conecte Turso.
- **Accesible:** teclado (Esc/Tab en el modal), `aria-live` en el contador y
  `prefers-reduced-motion` respetado.

---

## 🎨 Colores pastel

`#e3f6ff · #c9eeff · #a8e4ff · #7fd4f5` (celestes) + `#ffd0e4 · #ff9ec4` (rosa) +
`#8ce0b4 · #63cd97 · #45b17e` (billetes) + `#fff3cd` (amarillo).

---

## 🖼 Regenerar iconos

```powershell
powershell -ExecutionPolicy Bypass -File tools\gen-icons.ps1
```
