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

   Chat (misma interfaz):
       chatCargar()                         → Promise<{ mensajes, hayMas }>
       chatViejos(antesDeId)                → Promise<{ mensajes, hayMas }>
       chatEnviar(autor, texto)             → Promise<mensaje>
       suscribirChat(callback)              → función de corte
       (la sondeada del chat viaja en la MISMA petición que los datos,
        y solo pide mensajes NUEVOS: `WHERE id > ?` → 0 filas leídas
        cuando no hay novedades)

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
    chat: CFG.almacen.prefijo + ".chat",     // historial del chat (solo fallback local)
    chatCopia: CFG.almacen.prefijo + ".chatCopia", // últimos del chat pinto-tapizados
  };

  const ids = () => CFG.usuarios.map((u) => u.usuario);
  const info = (id) => CFG.usuarios.find((u) => u.usuario === id) || { usuario: id, nombre: id };

  const estadoVacio = () => {
    const deudas = {};
    ids().forEach((id) => (deudas[id] = 0));
    return { deudas, movimientos: [], meta: CFG.frasco.meta, actualizado: Date.now(), revision: 0 };
  };

  const normalizar = (datos) => {
    const base = estadoVacio();
    if (!datos || typeof datos !== "object") return base;
    base.deudas = Object.assign({}, base.deudas, datos.deudas || {});
    base.movimientos = Array.isArray(datos.movimientos) ? datos.movimientos : [];
    base.meta = Number(datos.meta) || CFG.frasco.meta;
    base.actualizado = Number(datos.actualizado) || Date.now();
    base.revision = Number(datos.revision) || 0;
    return base;
  };

  const totalDe = (datos) =>
    Object.values(datos.deudas).reduce((suma, n) => suma + (Number(n) || 0), 0);

  // a quién se le cobra: el otro usuario (solo hay dos)
  const otroDe = (usuario) => ids().find((x) => x !== usuario) || null;

  const nuevoId = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // chat: limpio el texto antes de guardarlo (sin líneas raras ni exceso)
  const limpiarTexto = (texto) =>
    String(texto || "").replace(/\s+/g, " ").trim().slice(0, CFG.chat.maxTexto);

  /* Copia chat-pintable en localStorage: guarda el último lote cargado, así
     el chat aparece al instante al abrir (y aussi offline) sin gastar reads. */
  const leerCopiaChat = () => {
    try {
      const bruto = localStorage.getItem(K.chatCopia);
      const c = JSON.parse(bruto || "null");
      return Array.isArray(c && c.mensajes) ? c : null;
    } catch {
      return null;
    }
  };
  const guardarCopiaChat = (mensajes, hayMas) => {
    try {
      localStorage.setItem(K.chatCopia, JSON.stringify({ mensajes, hayMas, actualizado: Date.now() }));
    } catch {}
  };

  /* ==========================================================
     ADAPTADOR LOCAL (localStorage + tiempo real entre pestañas)
     ========================================================== */
  class AdaptadorLocal {
    constructor() {
      this.canal = "BroadcastChannel" in window
        ? new BroadcastChannel(CFG.almacen.prefijo + "-tiempo-real")
        : null;
      // un solo receptor del canal que reparte según el tipo
      this._datosCb = null;
      this._chatCb = null;
      this._chatSuite = -1; // último id de chat avisado por storage
      if (this.canal) {
        this.canal.addEventListener("message", (e) => {
          const d = e.data;
          if (!d) return;
          if (d.tipo === "datos" && this._datosCb) this._datosCb(d.datos);
          if (d.tipo === "chat" && this._chatCb) this._chatCb(d.mensajes);
        });
      }
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
      this._datosCb = callback;

      // cambio desde otra pestaña (el canal ya se despacha en el constructor)
      const enStorage = (evento) => {
        if (evento.key === K.pareja) this.leerDatos().then((d) => callback(d));
      };
      window.addEventListener("storage", enStorage);

      return () => {
        window.removeEventListener("storage", enStorage);
        if (this._datosCb === callback) this._datosCb = null;
      };
    }

    /* ---------------------- chat ---------------------- */
    chatTodos() {
      try {
        const bruto = localStorage.getItem(K.chat);
        return Array.isArray(JSON.parse(bruto || "[]")) ? JSON.parse(bruto || "[]") : [];
      } catch {
        return [];
      }
    }
    chatGuardar(mensajes) {
      localStorage.setItem(K.chat, JSON.stringify(mensajes));
    }

    /** últimos N mensajes, con 1 extra solo para saber si hay más arriba */
    async chatCargar() {
      const todos = this.chatTodos();
      const crudos = todos.slice(-(CFG.chat.lote + 1));
      const hayMas = crudos.length > CFG.chat.lote;
      const mensajes = crudos.slice(0, CFG.chat.lote);
      this._chatSuite = mensajes.length ? mensajes[mensajes.length - 1].id : -1;
      guardarCopiaChat(mensajes, hayMas);
      return { mensajes, hayMas };
    }

    /** un lote de mensajes anteriores a `antesDe` (para scrollear hacia arriba) */
    async chatViejos(antesDe) {
      const anteriores = this.chatTodos().filter((m) => m.id < antesDe);
      const crudos = anteriores.slice(-(CFG.chat.lote + 1));
      return {
        mensajes: crudos.slice(0, CFG.chat.lote),
        hayMas: crudos.length > CFG.chat.lote,
      };
    }

    async chatEnviar(autor, texto) {
      const limpio = limpiarTexto(texto);
      if (!limpio) return null;

      // id numérico creciente (único incluso si dos mensajes caen al mismo ms)
      let id = Date.now();
      const usados = new Set(this.chatTodos().map((m) => m.id));
      while (usados.has(id)) id += 1;

      const mensaje = { id, autor, texto: limpio, ts: Date.now() };
      const todos = this.chatTodos();
      todos.push(mensaje);
      this.chatGuardar(todos);
      this._chatSuite = mensaje.id;

      if (this.canal) this.canal.postMessage({ tipo: "chat", mensajes: [mensaje] });
      return mensaje;
    }

    suscribirChat(callback) {
      this._chatCb = callback;

      const enStorage = (evento) => {
        if (evento.key !== K.chat || !evento.newValue) return;
        try {
          const nuevos = JSON.parse(evento.newValue).filter((m) => m.id > this._chatSuite);
          if (nuevos.length) callback(nuevos);
          this._chatSuite = Math.max(this._chatSuite, ...nuevos.map((m) => m.id));
        } catch {}
      };
      window.addEventListener("storage", enStorage);

      return () => {
        window.removeEventListener("storage", enStorage);
        if (this._chatCb === callback) this._chatCb = null;
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
      this._chatCb = null;  // callback del chat (si la interfaz está suscrita)
      this._chatDesde = null; // último id de chat conocido (lectura incremental)
      this._ultRev = null;  // última revisión vista (sondeo barato)
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

    /* --- leer deudas + movimientos + estado (con respaldo offline) ---
       Si `chatDesde` viene con un id, agrega la consulta de mensajes NUEVOS
       a la MISMA petición del pipeline: el chat no cuesta requests extra,
       y cuando no hay mensajes nuevos la consulta devuelve 0 filas leídas. */
    async pedirTodo(chatDesde = null) {
      const consisteChat = chatDesde !== null && chatDesde !== undefined;
      const sqls = [
        "SELECT usuario, debe FROM deudas",
        "SELECT id, autor, deudor, monto, ts FROM movimientos ORDER BY ts DESC, rowid DESC LIMIT 50",
        "SELECT meta, actualizado, revision FROM estado WHERE id = 1",
      ];
      if (consisteChat) {
        sqls.push(
          "SELECT id, autor, texto, ts FROM mensajes WHERE id > ? ORDER BY id ASC LIMIT 99"
        );
      }

      let rs;
      try {
        rs = await this.pedir(sqls, [
          [],
          [],
          [],
          ...(consisteChat ? [[chatDesde]] : []),
        ]);
      } catch (e) {
        // sin internet: mostramos la última respuesta conocida
        const bruto = localStorage.getItem(K.copia);
        if (bruto) {
          console.warn("Sin conexión con Turso, muestro la última copia:", e.message);
          return { datos: normalizar(JSON.parse(bruto)), chatNuevos: [] };
        }
        throw e;
      }

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
        datos.revision = Number(est.revision) || 0;
      }
      this._ultRev = datos.revision; // al traer todo quedamos "al día"

      try { localStorage.setItem(K.copia, JSON.stringify(datos)); } catch {}

      let chatNuevos = [];
      if (consisteChat) {
        chatNuevos = this.mapearMensajes(this.filas(rs[3]));
        if (chatNuevos.length) this._chatDesde = chatNuevos[chatNuevos.length - 1].id;
      }
      return { datos, chatNuevos };
    }

    async leerDatos() {
      const { datos } = await this.pedirTodo(null);
      return datos;
    }

    /* ---------------------- chat ---------------------- */
    mapearMensajes(filas) {
      return filas.map((f) => ({
        id: Number(f.id),
        autor: f.autor,
        texto: String(f.texto),
        ts: Number(f.ts),
      }));
    }

    /** los últimos N mensajes del historial (carga inicial) */
    async chatCargar() {
      const lote = CFG.chat.lote;
      const rs = await this.pedir(
        ["SELECT id, autor, texto, ts FROM mensajes ORDER BY id DESC LIMIT ?"],
        [[lote + 1]] // el extra solo dice si hay más mensajes arriba
      );
      const crudos = this.filas(rs[0]);
      const hayMas = crudos.length > lote;
      const mensajes = this.mapearMensajes(crudos.slice(0, lote)).reverse();
      // 0 = "estoy al día" (con el historial vacío igual llegan los nuevos)
      this._chatDesde = mensajes.length ? mensajes[mensajes.length - 1].id : 0;
      guardarCopiaChat(mensajes, hayMas);
      return { mensajes, hayMas };
    }

    /** mensajes anteriores a `antesDe` (cuando scrolleas hacia arriba) */
    async chatViejos(antesDe) {
      const lote = CFG.chat.lote;
      const rs = await this.pedir(
        ["SELECT id, autor, texto, ts FROM mensajes WHERE id < ? ORDER BY id DESC LIMIT ?"],
        [[antesDe, lote + 1]]
      );
      const crudos = this.filas(rs[0]);
      return {
        mensajes: this.mapearMensajes(crudos.slice(0, lote)).reverse(),
        hayMas: crudos.length > lote,
      };
    }

    /** enviar: INSERT + leer el mensaje recién creado, en UNA petición */
    async chatEnviar(autor, texto) {
      const limpio = limpiarTexto(texto);
      if (!limpio) return null;
      const ts = Date.now();

      const rs = await this.pedir(
        [
          "INSERT INTO mensajes (autor, texto, ts) VALUES (?, ?, ?)",
          "SELECT id, autor, texto, ts FROM mensajes WHERE rowid = last_insert_rowid()",
        ],
        [[autor, limpio, ts], []]
      );
      const mensajes = this.mapearMensajes(this.filas(rs[1]));
      if (mensajes.length) {
        this._chatDesde = Math.max(this._chatDesde || 0, mensajes[0].id);
        return mensajes[0];
      }
      return null;
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
          "UPDATE estado SET actualizado = ?, revision = ? WHERE id = 1",
        ],
        [
          [monto, ts, deudor],
          [nuevoId(), autor, deudor, monto, ts],
          [ts, ts],
        ]
      );

      return this.leerDatos();
    }

    /* --- tiempo real: mismo equipo (broadcast) + sondeo a la base ---
       Sondeo BARATO: lee solo la fila `estado` (1 fila) para ver la
       `revision` + lo nuevo del chat (0 filas cuando no hay). Solo si
       la revisión cambió — o cada `sondeoLentoCada` sondeos, por si
       alguien edita la base a mano — trae todas las filas del frasco.
       Todo viaja en UNA petición HTTP por sondeo. */
    suscribir(callback) {
      const cortarLocal = this.local.suscribir(callback);
      const cadaLento = CFG.turso.sondeoLentoCada || 15;
      let vueltas = 0;

      const sondear = async () => {
        try {
          vueltas += 1;
          const debeChat = this._chatCb && this._chatDesde !== null;

          // ---- sondeo completo (de vez en cuando) ----
          if (vueltas % cadaLento === 0) {
            const { datos, chatNuevos } = await this.pedirTodo(
              debeChat ? this._chatDesde : null
            );
            callback(datos);
            if (this._chatCb && chatNuevos.length) this._chatCb(chatNuevos);
            return;
          }

          // ---- sondeo barato: 1 fila de estado + chat incremental ----
          const sqls = ["SELECT revision, actualizado FROM estado WHERE id = 1"];
          const args = [[]];
          if (debeChat) {
            sqls.push(
              "SELECT id, autor, texto, ts FROM mensajes WHERE id > ? ORDER BY id ASC LIMIT 99"
            );
            args.push([this._chatDesde]);
          }
          const rs = await this.pedir(sqls, args);

          let chatNuevos = [];
          if (debeChat) {
            chatNuevos = this.mapearMensajes(this.filas(rs[1]));
            if (chatNuevos.length) this._chatDesde = chatNuevos[chatNuevos.length - 1].id;
          }

          const fila = this.filas(rs[0])[0];
          const rev = fila ? Number(fila.revision) || 0 : 0;

          if (rev !== this._ultRev) {
            // algo cambió: traemos TODO (el pedirTodo re-ancla this._ultRev)
            const { datos, chatNuevos: nuevosChat } = await this.pedirTodo(
              debeChat ? this._chatDesde : null
            );
            callback(datos);
            if (chatNuevos.length) this._chatCb(chatNuevos);
            if (nuevosChat.length) this._chatCb(nuevosChat);
          } else if (chatNuevos.length) {
            this._chatCb(chatNuevos);
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

    /** el callback recibe SOLAMENTE los mensajes nuevos (id > último visto) */
    suscribirChat(callback) {
      this._chatCb = callback;
      return () => {
        if (this._chatCb === callback) this._chatCb = null;
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

    /* --- chat de la pareja --- */
    chatCargar() {
      return ADAPTADOR.chatCargar();
    },
    chatViejos(antesDe) {
      return ADAPTADOR.chatViejos(antesDe);
    },
    chatEnviar(autor, texto) {
      return ADAPTADOR.chatEnviar(autor, texto);
    },
    suscribirChat(callback) {
      return ADAPTADOR.suscribirChat(callback);
    },

    /** últimos mensajes pintados en caché (localStorage): pintar antes de preguntar */
    chatCopiaLocal() {
      return leerCopiaChat();
    },

    /** el cargador refresca la copia (solo la ventana de los últimos N) */
    chatCopiaGuardar(mensajes, hayMas) {
      const ultimos = Array.isArray(mensajes)
        ? mensajes.slice(-(CFG.chat.lote))
        : [];
      guardarCopiaChat(ultimos, !!hayMas);
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
