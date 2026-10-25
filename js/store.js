/* ============================================================
   El Perdonómetro · capa de datos (store)
   ------------------------------------------------------------
   La interfaz SOLO habla con `window.PDM.store`. El store usa un
   *adaptador*, así que cambiar la base no toca la interfaz:

   · AdaptadorLocal  → localStorage (funciona ya, y sincroniza
                       entre pestañas con BroadcastChannel).
   · AdaptadorTurso  → SQLite en Turso. Solo pega el `url` y el
                       `authToken` en config.js y queda activo.

   Interfaz del adaptador (ambos la cumplen):
       leerSesion() / escribirSesion(s) / borrarSesion()
       verificarClave(usuario, clave)        → Promise<boolean>
       leerDatos()                          → Promise<datos>
       cobrar(autor, monto)                 → Promise<datos>
       suscribir(callback)                  → función de corte

   Datos:
       { deudas: { anyi: 0, edu: 0 },   ← cuánto le deben a cada uno
         movimientos: [{ id, autor, deudor, monto, ts }],
         meta: 300000, actualizado }
   ============================================================ */

(function () {
  "use strict";

  const CFG = window.PDM_CONFIG;
  const K = {
    sesion: CFG.almacen.prefijo + ".sesion",
    pareja: CFG.almacen.prefijo + ".pareja", // registro compartido por los 2
    copia: CFG.almacen.prefijo + ".copia",   // última respuesta de Turso (respaldo offline)
  };

  const ids = () => CFG.usuarios.map((u) => u.usuario);
  const info = (id) => CFG.usuarios.find((u) => u.usuario === id) || { usuario: id, nombre: id };

  const estadoVacio = () => {
    const deudas = {};
    ids().forEach((id) => (deudas[id] = 0));
    return { deudas, movimientos: [], meta: CFG.frasco.meta, actualizado: Date.now() };
  };

  const normalizar = (datos) => {
    const base = estadoVacio();
    if (!datos || typeof datos !== "object") return base;
    base.deudas = Object.assign({}, base.deudas, datos.deudas || {});
    base.movimientos = Array.isArray(datos.movimientos) ? datos.movimientos : [];
    base.meta = Number(datos.meta) || CFG.frasco.meta;
    base.actualizado = Number(datos.actualizado) || Date.now();
    return base;
  };

  const totalDe = (datos) =>
    Object.values(datos.deudas).reduce((suma, n) => suma + (Number(n) || 0), 0);

  // a quién se le cobra: el otro usuario (solo hay dos)
  const otroDe = (usuario) => ids().find((x) => x !== usuario) || null;

  const nuevoId = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* ==========================================================
     ADAPTADOR LOCAL (localStorage + tiempo real entre pestañas)
     ========================================================== */
  class AdaptadorLocal {
    constructor() {
      this.canal = "BroadcastChannel" in window
        ? new BroadcastChannel(CFG.almacen.prefijo + "-tiempo-real")
        : null;
    }

    /* --- sesión (siempre en el dispositivo) --- */
    leerSesion() {
      try {
        const bruto = localStorage.getItem(K.sesion);
        return bruto ? JSON.parse(bruto) : null;
      } catch {
        return null;
      }
    }
    escribirSesion(sesion) {
      localStorage.setItem(K.sesion, JSON.stringify(sesion));
    }
    borrarSesion() {
      localStorage.removeItem(K.sesion);
    }

    /* --- validación --- */
    async verificarClave(usuario, clave) {
      const u = String(usuario || "").trim().toLowerCase();
      return CFG.usuarios.some(
        (x) => x.usuario.toLowerCase() === u && x.clave === String(clave)
      );
    }

    /* --- datos --- */
    async leerDatos() {
      try {
        const bruto = localStorage.getItem(K.pareja);
        return normalizar(bruto ? JSON.parse(bruto) : null);
      } catch {
        return estadoVacio();
      }
    }

    async cobrar(autor, monto) {
      const datos = await this.leerDatos();
      const deudor = otroDe(autor);
      if (!deudor) throw new Error("No hay a quién cobrarle");

      datos.deudas[deudor] = (Number(datos.deudas[deudor]) || 0) + monto;
      datos.movimientos.unshift({ id: nuevoId(), autor, deudor, monto, ts: Date.now() });
      datos.movimientos = datos.movimientos.slice(0, 50);
      datos.actualizado = Date.now();

      localStorage.setItem(K.pareja, JSON.stringify(datos));
      if (this.canal) this.canal.postMessage({ tipo: "datos", datos });
      return datos;
    }

    /* --- tiempo real entre pestañas de este equipo --- */
    suscribir(callback) {
      const manejador = (evento) => {
        if (evento.data && evento.data.tipo === "datos") callback(evento.data.datos);
      };
      if (this.canal) this.canal.addEventListener("message", manejador);

      const enStorage = (evento) => {
        if (evento.key === K.pareja) this.leerDatos().then(callback);
      };
      window.addEventListener("storage", enStorage);

      return () => {
        if (this.canal) this.canal.removeEventListener("message", manejador);
        window.removeEventListener("storage", enStorage);
      };
    }
  }

  /* ==========================================================
     ADAPTADOR TURSO (SQLite en la nube)
     ---------------------------------------------------------
     Se activa al poner config.turso.url y authToken.
     Habla directo con la API HTTP de Turso (/v2/pipeline),
     sin librerías externas ni build. La sesión sigue viva en
     el dispositivo (localStorage).

     AVISO de seguridad: el token queda en el navegador. Para un
     uso público habría que mover login y escritura a una función
     serverless; para esta app de 2 personas funciona tal cual.
     ========================================================== */
  class AdaptadorTurso {
    constructor() {
      if (!CFG.turso.url) throw new Error("Falta config.turso.url");
      this.host = CFG.turso.url.replace(/^libsql:\/\//, "https://");
      this.token = CFG.turso.authToken;
      this.local = new AdaptadorLocal(); // la sesión vive en el dispositivo
      this.timer = null;
    }

    /* --- petición cruda a Turso (una o varias sentencias) --- */
    async pedir(sqls, argumentos = []) {
      // los argumentos viajan con "tipo etiquetado": { type, value }
      const etiquetar = (v) => {
        if (v === null || v === undefined) return { type: "null" };
        if (typeof v === "number")
          return { type: Number.isInteger(v) ? "integer" : "float", value: String(v) };
        if (typeof v === "boolean") return { type: "integer", value: v ? "1" : "0" };
        return { type: "text", value: String(v) };
      };

      const res = await fetch(this.host + "/v2/pipeline", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + this.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: sqls.map((sql, i) => ({
            type: "execute",
            stmt: { sql, args: (argumentos[i] || []).map(etiquetar) },
          })),
        }),
      });

      if (!res.ok) {
        const cuerpo = await res.json().catch(() => ({}));
        throw new Error(cuerpo.error || "Turso respondió " + res.status);
      }

      const datos = await res.json();
      const fallo = (datos.results || []).find((r) => r.type !== "ok");
      if (fallo) throw new Error(fallo.error || "Error en la base");
      return datos.results.map((r) => r.response.result);
    }

    /* --- filas como objetos { columna: valor } --- */
    filas(resultado) {
      if (!resultado || !resultado.rows) return [];
      const cols = resultado.cols.map((c) => c.name);
      const valor = (celda) => {
        if (!celda || celda.type === "null" || celda.value === null) return null;
        if (celda.type === "integer" || celda.type === "real") return Number(celda.value);
        if (celda.type === "blob") return celda.value;
        return celda.value;
      };
      return resultado.rows.map((fila) => {
        const objeto = {};
        cols.forEach((c, i) => (objeto[c] = valor(fila[i])));
        return objeto;
      });
    }

    /* --- sesión (en el dispositivo, igual que siempre) --- */
    leerSesion() { return this.local.leerSesion(); }
    escribirSesion(s) { this.local.escribirSesion(s); }
    borrarSesion() { this.local.borrarSesion(); }

    /* --- validación contra la tabla `usuarios` --- */
    async verificarClave(usuario, clave) {
      const r = await this.pedir(
        ["SELECT usuario FROM usuarios WHERE usuario = ? AND clave = ?"],
        [[String(usuario).trim().toLowerCase(), String(clave)]]
      );
      return this.filas(r[0]).length > 0;
    }

    /* --- leer deudas + movimientos + estado (con respaldo offline) --- */
    async leerDatos() {
      try {
        const rs = await this.pedir([
          "SELECT usuario, debe FROM deudas",
          "SELECT id, autor, deudor, monto, ts FROM movimientos ORDER BY ts DESC, rowid DESC LIMIT 50",
          "SELECT meta, actualizado FROM estado WHERE id = 1",
        ]);

        const datos = estadoVacio();
        this.filas(rs[0]).forEach((f) => (datos.deudas[f.usuario] = Number(f.debe) || 0));
        datos.movimientos = this.filas(rs[1]).map((f) => ({
          id: f.id, autor: f.autor, deudor: f.deudor,
          monto: Number(f.monto), ts: Number(f.ts),
        }));
        const est = this.filas(rs[2])[0];
        if (est) {
          datos.meta = Number(est.meta) || datos.meta;
          datos.actualizado = Number(est.actualizado) || datos.actualizado;
        }

        try { localStorage.setItem(K.copia, JSON.stringify(datos)); } catch {}
        return datos;
      } catch (e) {
        // sin internet: mostramos la última respuesta conocida
        const bruto = localStorage.getItem(K.copia);
        if (bruto) {
          console.warn("Sin conexión con Turso, muestro la última copia:", e.message);
          return normalizar(JSON.parse(bruto));
        }
        throw e;
      }
    }

    /* --- cobrar: suma al deudor y registra el movimiento --- */
    async cobrar(autor, monto) {
      const deudor = otroDe(autor);
      if (!deudor) throw new Error("No hay a quién cobrarle");
      const ts = Date.now();

      await this.pedir(
        [
          "UPDATE deudas SET debe = debe + ?, actualizado = ? WHERE usuario = ?",
          "INSERT INTO movimientos (id, autor, deudor, monto, ts) VALUES (?, ?, ?, ?, ?)",
          "UPDATE estado SET actualizado = ? WHERE id = 1",
        ],
        [
          [monto, ts, deudor],
          [nuevoId(), autor, deudor, monto, ts],
          [ts],
        ]
      );

      return this.leerDatos();
    }

    /* --- tiempo real: mismo equipo (broadcast) + sondeo a la base --- */
    suscribir(callback) {
      const cortarLocal = this.local.suscribir(callback);

      let ultimo = "";
      const sondear = async () => {
        try {
          const datos = await this.leerDatos();
          const huella = JSON.stringify(datos);
          if (huella !== ultimo) {
            ultimo = huella;
            callback(datos);
          }
        } catch (e) {
          console.warn("Sin conexión con Turso:", e.message);
        }
      };
      sondear();
      this.timer = setInterval(sondear, CFG.turso.sondeoMs || 2000);

      return () => {
        clearInterval(this.timer);
        cortarLocal();
      };
    }
  }

  /* ==========================================================
     STORE PÚBLICO
     ========================================================== */
  const ADAPTADOR = CFG.turso && CFG.turso.url
    ? new AdaptadorTurso()
    : new AdaptadorLocal();

  const Store = {
    conTurso: ADAPTADOR instanceof AdaptadorTurso,

    /* --- sesión --- */
    sesionActual() {
      const s = ADAPTADOR.leerSesion();
      // si la sesión es de un usuario que ya no existe, se borra
      if (!s || !CFG.usuarios.some((u) => u.usuario === s.usuario)) {
        ADAPTADOR.borrarSesion();
        return null;
      }
      return s;
    },

    async iniciarSesion(usuario, clave) {
      const u = String(usuario || "").trim();
      const c = String(clave || "");
      if (!u || !c) return { ok: false, error: "Completa usuario y contraseña." };

      let valido = false;
      try {
        valido = await ADAPTADOR.verificarClave(u, c);
      } catch (e) {
        return { ok: false, error: "No hay conexión con la base 😿" };
      }
      if (!valido) return { ok: false, error: "Usuario o contraseña incorrectos" };

      const cfg = CFG.usuarios.find((x) => x.usuario.toLowerCase() === u.toLowerCase());
      const sesion = {
        usuario: cfg ? cfg.usuario : u.toLowerCase(),
        nombre: cfg ? cfg.nombre : u,
        inicio: Date.now(),
      };
      ADAPTADOR.escribirSesion(sesion);
      return { ok: true, sesion };
    },

    cerrarSesion() {
      ADAPTADOR.borrarSesion();
    },

    /* --- ahorro / deudas --- */
    obtenerDatos() {
      return ADAPTADOR.leerDatos();
    },

    // +1000 para EL OTRO usuario (Anyi cobra → le sube a Edu)
    cobrar(autor, monto) {
      return ADAPTADOR.cobrar(autor, monto);
    },

    /* --- tiempo real --- */
    suscribir(callback) {
      return ADAPTADOR.suscribir(callback);
    },

    /* --- utilidades para la interfaz --- */
    otroDe,
    totalDe,
    info,
    usuarios: () => CFG.usuarios.slice(),
  };

  window.PDM = window.PDM || {};
  window.PDM.store = Store;
})();
