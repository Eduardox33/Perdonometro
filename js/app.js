/* ============================================================
   El Perdonómetro · lógica de interfaz
   ------------------------------------------------------------
   · El botón "Cobrar luca" le suma $1.000 al OTRO usuario.
   · El marcador muestra cuánto le debe cada uno (sin tope).
   · El frasco se "llena" a $300.000 y ahí se queda visualmente,
     pero la animación de entrar dinero sigue siempre.
   ============================================================ */

(function () {
  "use strict";

  const CFG = window.PDM_CONFIG;
  const Store = window.PDM.store;

  /* ---------- helpers ---------- */
  const $ = (id) => document.getElementById(id);

  const formato = new Intl.NumberFormat(CFG.moneda.locale, {
    style: "currency",
    currency: CFG.moneda.codigo,
    maximumFractionDigits: 0,
  });
  const dinero = (n) => formato.format(n || 0).replace(/\s/g, " ");

  const vistas = {
    login: $("vista-login"),
    app: $("vista-app"),
  };

  const ui = {
    form: $("form-login"),
    usuario: $("usuario"),
    clave: $("clave"),
    error: $("error-login"),
    nombre: $("nombre-usuario"),
    salir: $("btn-salir"),
    total: $("total"),
    marcador: $("marcador"),
    frasco: $("frasco"),
    liquido: $("liquido"),
    capaBillete: $("capa-moneda"),
    estado: $("estado-frasco"),
    cobrar: $("btn-cobrar"),
    cobrarMonto: $("cobrar-monto"),
    pista: $("pista"),
    lista: $("lista-movimientos"),
    listaVacia: $("lista-vacia"),
    cantidad: $("cantidad-cobros"),
    modal: $("modal"),
    modalTexto: $("modal-texto"),
    btnSi: $("btn-si"),
    btnNo: $("btn-no"),
    aviso: $("aviso"),
    chatScroll: $("chat-scroll"),
    chatLista: $("chat-lista"),
    chatVacia: $("chat-vacio"),
    chatMas: $("chat-mas"),
    chatForm: $("chat-form"),
    chatInput: $("chat-input"),
    chatEnviar: $("chat-enviar"),
    statsMes: $("stat-mes"),
    statsRacha: $("stat-racha"),
    statsRachaTexto: $("stat-racha-texto"),
    statsBarras: $("stat-barras"),
    statsNota: $("stat-nota"),
  };

  let sesion = null;
  let datos = null;
  let desuscribir = null;
  let desuscribirChat = null;
  let totalMostrado = 0;        // para animar el contador
  let deudasPrevias = {};       // para animar el marcador
  let avisoTimer = null;

  /* ============================================================
     ESTADÍTIKAS
     ------------------------------------------------------------
     Todo se calcula de los movimientos que ya están en memoria
     (los últimos 50): 0 reads extra para las gráficas.
     ============================================================ */
  function calcularStats(movs) {
    const ahora = new Date();
    const delMes = movs.filter((m) => {
      const f = new Date(m.ts);
      return f.getMonth() === ahora.getMonth() && f.getFullYear() === ahora.getFullYear();
    });

    const porPersona = {};
    Store.usuarios().forEach((u) => (porPersona[u.usuario] = 0));
    delMes.forEach((m) => (porPersona[m.autor] = (porPersona[m.autor] || 0) + m.monto));
    const totalMes = delMes.reduce((suma, m) => suma + m.monto, 0);

    // racha: días seguidos (hacia atrás desde hoy) con al menos 1 cobro
    const dias = new Set(movs.map((m) => new Date(m.ts).toDateString()));
    let racha = 0;
    const d = new Date();
    while (racha < 60 && dias.has(d.toDateString())) {
      racha += 1;
      d.setDate(d.getDate() - 1);
    }

    return { totalMes, cantidadMes: delMes.length, porPersona, total: movs.length, racha };
  }

  function pintarStats() {
    const s = calcularStats(datos.movimientos || []);

    ui.statsMes.textContent = dinero(s.totalMes);
    ui.statsRacha.textContent = String(s.racha);
    ui.statsRachaTexto.textContent =
      s.racha > 0 ? `${s.racha === 1 ? "día" : "días"} de racha con cobros 🔥` : "empieza tu racha hoy ✨";

    // barras: quién le pagó más al frasco este mes
    ui.statsBarras.innerHTML = "";
    Store.usuarios().forEach((u) => {
      const monto = s.porPersona[u.usuario] || 0;
      const pct = s.totalMes > 0 ? Math.round((monto / s.totalMes) * 100) : 0;

      const fila = document.createElement("div");
      fila.className = "stat-fila";
      fila.style.setProperty("--tinte", u.color || "#a8e4ff");
      fila.innerHTML = `
        <span class="stat-quien">${u.nombre}</span>
        <span class="stat-track"><span class="stat-fill" style="width:0%"></span></span>
        <strong class="stat-monto">${dinero(monto)}</strong>`;
      ui.statsBarras.appendChild(fila);

      // animación de la barra al entrar en pantalla
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          fila.querySelector(".stat-fill").style.width = pct + "%";
        })
      );
    });

    ui.statsNota.textContent =
      s.total === 0 ? "Todavía no hay cobros para calcular ✨" : `Con tus últimos ${s.total} cobros`;
  }

  /* ============================================================
     CHAT de la pareja
     ------------------------------------------------------------
     · chat.lista      mensajes confirmados (ordenados por id).
     · chat.hayMas     quedan mensajes anteriores arriba.
     · chat.pendientes enviados que aún no confirma la base.
     Llega solo lo nuevo por la suscripción; el historial viejo
     se pide por lotes solo cuando scrolleas hacia arriba.
     ============================================================ */
  const chat = {
    lista: [],
    vistos: new Set(),
    pendientes: [],
    hayMas: false,
    cargandoViejos: false,
    ultimoId: 0,
  };

  function limpiarChatTexto(texto) {
    return String(texto || "").replace(/\s+/g, " ").trim().slice(0, CFG.chat.maxTexto);
  }

  /** burbuja de un mensaje */
  function nodoMensaje(m) {
    const mias = sesion && m.autor === sesion.usuario;
    const li = document.createElement("li");
    li.className =
      "mensaje" +
      (mias ? " mias" : "") +
      (m.pendiente ? " pendiente" : "") +
      (m.fallo ? " fallo" : "");
    li.dataset.clave = m.id;
    li.style.setProperty("--tinte", Store.info(m.autor).color || "#a8e4ff");

    const quien = document.createElement("span");
    quien.className = "quien";
    const hora = new Date(m.ts).toLocaleTimeString(CFG.moneda.locale, {
      hour: "2-digit",
      minute: "2-digit",
    });
    quien.textContent = mias ? `tú · ${hora}` : `${Store.info(m.autor).nombre} · ${hora}`;

    const globo = document.createElement("span");
    globo.className = "globo";
    globo.textContent = m.texto;

    li.append(quien, globo);
    return li;
  }

  /**
   * pintar el chat.
   * modo: "abajo" (anclar al fondo), "auto" (solo si ya estabas abajo),
   *       "mantener" (al prepender historial, no mover el scroll).
   */
  function pintarChat(modo = "auto") {
    const scroll = ui.chatScroll;
    const cercaAbajo = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 90;
    const visible = scroll.scrollHeight - scroll.scrollTop; // ancla al prepender

    ui.chatLista.textContent = "";
    chat.lista.forEach((m) => ui.chatLista.appendChild(nodoMensaje(m)));
    chat.pendientes.forEach((m) => ui.chatLista.appendChild(nodoMensaje(m)));

    const hay = chat.lista.length + chat.pendientes.length;
    ui.chatVacia.hidden = hay > 0;
    ui.chatMas.hidden = !chat.hayMas || chat.cargandoViejos;

    if (modo === "abajo") scroll.scrollTop = scroll.scrollHeight;
    else if (modo === "mantener") scroll.scrollTop = scroll.scrollHeight - visible;
    else if (modo === "auto" && cercaAbajo) scroll.scrollTop = scroll.scrollHeight;
  }

  /** agrega mensajes nuevos (con su dedupe) y avisa si cambió algo */
  function agregarAlChat(nuevos) {
    if (!Array.isArray(nuevos)) return false;
    let cambio = false;

    nuevos.forEach((m) => {
      if (!m || m.id === undefined) return;
      if (chat.vistos.has(m.id)) return;
      // si este mensaje era un pendiente mío, el pendiente ya no sirve
      const i = chat.pendientes.findIndex(
        (p) => p.pendiente && p.autor === m.autor &&
               p.texto === m.texto && Math.abs(m.ts - p.ts) < 5000
      );
      if (i >= 0) chat.pendientes.splice(i, 1);

      chat.lista.push(m);
      chat.vistos.add(m.id);
      chat.ultimoId = Math.max(chat.ultimoId, m.id);
      cambio = true;
    });

    chat.lista.sort((a, b) => a.id - b.id);
    if (cambio) Store.chatCopiaGuardar(chat.lista, chat.hayMas);
    return cambio;
  }

  /** carga inicial: los últimos N, anclar al fondo */
  async function chatEmpezar() {
    chat.lista = [];
    chat.vistos.clear();
    chat.pendientes = [];
    chat.hayMas = false;
    chat.cargandoViejos = false;
    ui.chatLista.textContent = "";
    pintarChat("auto");

    // 1) pinta el último lote guardado en caché (al instante, incluso offline)
    const copia = Store.chatCopiaLocal();
    if (copia && copia.mensajes.length) {
      chat.hayMas = !!copia.hayMas;
      if (agregarAlChat(copia.mensajes)) pintarChat("abajo");
    }

    // 2) la base confirma en segundo plano y actualiza lo que falte
    try {
      const res = await Store.chatCargar();
      chat.hayMas = !!res.hayMas;
      agregarAlChat(res.mensajes);
      pintarChat("abajo"); // siempre muestra lo último
    } catch (e) {
      console.warn("Chat: no se pudo cargar el historial", e);
      // reintenta en un rato para dejar el sondeo "al día"
      setTimeout(() => { if (sesion) chatEmpezar(); }, 4000);
    }
  }

  /** mensajes que llegan en tiempo real (la base trae SOLO lo nuevo) */
  function chatLlegaron(nuevos) {
    if (!sesion || !agregarAlChat(nuevos)) return;
    pintarChat("auto");
  }

  /** pide un lote anterior (al scrollear o apretar el botón de arriba) */
  async function cargarMsgsViejos() {
    if (!chat.hayMas || chat.cargandoViejos || !chat.lista.length) return;
    chat.cargandoViejos = true;
    ui.chatMas.textContent = "cargando…";
    ui.chatMas.hidden = false;

    try {
      const res = await Store.chatViejos(chat.lista[0].id);
      const tener = res.mensajes.filter((m) => !chat.vistos.has(m.id));
      if (tener.length) {
        chat.lista = tener.concat(chat.lista);
        tener.forEach((m) => chat.vistos.add(m.id));
      }
      chat.hayMas = !!res.hayMas;
    } catch (e) {
      console.warn(e);
      aviso("No se pudieron cargar mensajes anteriores 😿", true);
    } finally {
      chat.cargandoViejos = false;
      ui.chatMas.textContent = "cargar anteriores ↓";
      pintarChat("mantener"); // conserva el lugar exacto del scroll
    }
  }

  async function enviarChat(borrador) {
    if (!chat.pendientes.includes(borrador)) chat.pendientes.push(borrador);
    borrador.pendiente = true;
    borrador.fallo = false;
    pintarChat("abajo");
    try {
      const real = await Store.chatEnviar(borrador.autor, borrador.texto);
      if (real) {
        // El INSERT ya confirma el mensaje: lo agrego directo. El sondeo lo
        // salta (el envío dejó el cursor al día), así que si lo esperara
        // se quedaría en "pendiente" para siempre.
        agregarAlChat([real]);
        pintarChat("abajo");
      } else {
        const i = chat.pendientes.indexOf(borrador);
        if (i >= 0) chat.pendientes.splice(i, 1);
        pintarChat("auto");
      }
    } catch (e) {
      console.warn(e);
      borrador.pendiente = false;
      borrador.fallo = true;
      pintarChat("auto");
      aviso("No se pudo enviar el mensaje 😿", true);
    }
    ui.chatInput.focus();
  }

  /* ---------- vistas ---------- */
  function mostrarVista(cual) {
    vistas.login.hidden = cual !== "login";
    vistas.app.hidden = cual !== "app";
  }

  /* ---------- avisos ---------- */
  function aviso(texto, esError = false) {
    clearTimeout(avisoTimer);
    ui.aviso.textContent = texto;
    ui.aviso.classList.toggle("error-aviso", esError);
    ui.aviso.hidden = false;
    ui.aviso.style.animation = "none";
    void ui.aviso.offsetWidth;
    ui.aviso.style.animation = "";
    avisoTimer = setTimeout(() => (ui.aviso.hidden = true), 2800);
  }

  /* ---------- contador animado ---------- */
  let contadorTimer = null;

  function animarContador(desde, hasta) {
    clearTimeout(contadorTimer);

    // en pestañas de fondo no corre requestAnimationFrame: va directo
    if (desde === hasta || document.hidden) {
      ui.total.textContent = dinero(hasta);
      return;
    }

    const duracion = 750;
    const inicio = performance.now();
    let terminado = false;

    // red de seguridad por si la animación se congela
    contadorTimer = setTimeout(() => {
      if (!terminado) ui.total.textContent = dinero(hasta);
    }, duracion + 200);

    const paso = (ahora) => {
      const t = Math.min((ahora - inicio) / duracion, 1);
      const suave = 1 - Math.pow(1 - t, 3);
      const valor = Math.round(desde + (hasta - desde) * suave);
      ui.total.textContent = dinero(valor);
      if (t < 1) requestAnimationFrame(paso);
      else {
        terminado = true;
        clearTimeout(contadorTimer);
        ui.total.textContent = dinero(hasta);
        ui.total.parentElement.classList.add("latido");
        setTimeout(() => ui.total.parentElement.classList.remove("latido"), 520);
      }
    };
    requestAnimationFrame(paso);
  }

  /* ---------- mensaje del frasco (según lo lleno que esté) ---------- */
  function mensajeFrasco(pct, total) {
    if (total <= 0) return "El frasco está esperando su primera luca";
    if (pct >= 100) return "¡Frascote lleno! El dinero sigue entrando igual";
    if (pct >= 75) return "¡Ya casi se desborda de billetes!";
    if (pct >= 50) return "¡Vas por buen camino!";
    if (pct >= 25) return "El frasco está engordando";
    return "¡Primeras lucas en el frasco!";
  }

  /* ---------- pintar todo ---------- */
  function pintar(animar = false) {
    if (!datos) return;

    const total = Store.totalDe(datos);
    const meta = datos.meta || CFG.frasco.meta;
    // sin tope de dinero: el nivel se queda lleno en la meta pero el contador sigue
    const pctReal = (total / meta) * 100;
    const pct = Math.min(Math.round(pctReal), 100);

    // contador total (nunca se corta)
    if (animar) animarContador(totalMostrado, total);
    else ui.total.textContent = dinero(total);
    totalMostrado = total;

    // frasco (se queda lleno en 300.000, pero la animación sigue al cobrar)
    const nivel = total > 0 ? Math.min(Math.max(2.5, pctReal), 100) : 0;
    ui.liquido.style.height = nivel + "%";
    ui.liquido.classList.toggle("sin-dinero", total <= 0);
    ui.estado.textContent = mensajeFrasco(pct, total);

    // marcador: cuánto le debe cada uno
    pintarMarcador(animar);

    // botón: a quién se le cobra
    const cobrado = Store.otroDe(sesion.usuario);
    const infoCobrado = cobrado ? Store.info(cobrado) : null;
    if (infoCobrado) {
      ui.cobrarMonto.textContent = `${dinero(CFG.moneda.paso)} a ${infoCobrado.nombre}`;
      ui.pista.innerHTML = `Cobrar le sube <strong>${dinero(CFG.moneda.paso)}</strong> a ${infoCobrado.nombre}`;
    }

    // movimientos
    const movs = datos.movimientos || [];
    ui.cantidad.textContent = String(movs.length);
    ui.listaVacia.hidden = movs.length > 0;
    ui.lista.innerHTML = "";

    movs.slice(0, 8).forEach((m) => {
      const fecha = new Date(m.ts);
      const hora = fecha.toLocaleTimeString(CFG.moneda.locale, { hour: "2-digit", minute: "2-digit" });
      const dia =
        fecha.toDateString() === new Date().toDateString()
          ? "Hoy"
          : fecha.toLocaleDateString(CFG.moneda.locale, { day: "2-digit", month: "short" });
      const autor = Store.info(m.autor).nombre;
      const deudor = Store.info(m.deudor).nombre;

      const li = document.createElement("li");
      li.innerHTML = `
        <span class="item-izq">
          <span class="icono"><span class="billete"></span></span>
          <span class="descripcion">
            ${autor} cobró a ${deudor}<br />
            <span class="fecha">${dia} · ${hora}</span>
          </span>
        </span>
        <span class="monto">+${dinero(m.monto)}</span>`;
      ui.lista.appendChild(li);
    });

    pintarStats();
  }

  function pintarMarcador(animar) {
    ui.marcador.innerHTML = "";
    Store.usuarios().forEach((u) => {
      const debe = Number(datos.deudas[u.usuario]) || 0;
      const subio = animar && deudasPrevias[u.usuario] !== undefined && debe > deudasPrevias[u.usuario];
      const soyYo = sesion && u.usuario === sesion.usuario;

      const caja = document.createElement("div");
      caja.className = "deuda" + (soyYo ? " yo-es-row" : "") + (subio ? " sube" : "");
      caja.style.setProperty("--tinte", u.color || "#a8e4ff");
      caja.innerHTML = `
        <span class="quien">${u.nombre}${soyYo ? '<em class="yo">tú</em>' : ""}</span>
        <strong class="monto">${dinero(debe)}</strong>
        <span class="pie">debe hasta ahora</span>`;
      ui.marcador.appendChild(caja);

      if (subio) setTimeout(() => caja.classList.remove("sube"), 700);
      deudasPrevias[u.usuario] = debe;
    });
  }

  /* ---------- animaciones al cobrar ---------- */
  function animarCobro() {
    // billete cayendo al frasco
    const billete = document.createElement("span");
    billete.className = "billete billete-caida";
    const alto = ui.frasco.getBoundingClientRect().height || 260;
    billete.style.setProperty("--profundidad", Math.round(alto * 0.7) + "px");
    ui.capaBillete.appendChild(billete);
    billete.addEventListener("animationend", () => billete.remove());
    setTimeout(() => billete.remove(), 1600);

    // chispas
    for (let i = 0; i < 7; i++) {
      const s = document.createElement("span");
      s.className = "sparkle";
      s.textContent = i % 2 ? "✦" : "✧";
      s.style.left = 42 + Math.random() * 16 + "%";
      s.style.top = 46 + Math.random() * 14 + "%";
      s.style.setProperty("--dx", (Math.random() * 120 - 60).toFixed(0) + "px");
      s.style.setProperty("--dy", (-40 - Math.random() * 70).toFixed(0) + "px");
      s.style.animationDelay = i * 45 + "ms";
      ui.frasco.appendChild(s);
      setTimeout(() => s.remove(), 1400);
    }

    // rebote del frasco
    ui.frasco.classList.remove("boing");
    void ui.frasco.offsetWidth;
    ui.frasco.classList.add("boing");
  }

  /* ---------- modal de confirmación ---------- */
  let ultimoFoco = null;

  function abrirModal() {
    if (!sesion) return;
    const cobrado = Store.otroDe(sesion.usuario);
    if (!cobrado) return;
    const nombre = Store.info(cobrado).nombre;

    ui.modalTexto.innerHTML =
      `Vas a cobrar <strong>${dinero(CFG.moneda.paso)}</strong> a <strong>${nombre}</strong>. ¿Estás seguro?`;
    ultimoFoco = document.activeElement;
    ui.modal.hidden = false;
    ui.btnSi.focus();
    document.addEventListener("keydown", tecladoModal);
  }

  function cerrarModal() {
    ui.modal.hidden = true;
    document.removeEventListener("keydown", tecladoModal);
    if (ultimoFoco) ultimoFoco.focus();
  }

  function tecladoModal(e) {
    if (e.key === "Escape") cerrarModal();
    if (e.key === "Tab") {
      const foco = [ui.btnNo, ui.btnSi];
      const i = foco.indexOf(document.activeElement);
      e.preventDefault();
      const siguiente = e.shiftKey
        ? foco[(i - 1 + foco.length) % foco.length]
        : foco[(i + 1) % foco.length];
      siguiente.focus();
    }
  }

  async function confirmarCobro() {
    cerrarModal();
    if (!sesion) return;

    const cobrado = Store.otroDe(sesion.usuario);
    const nombre = cobrado ? Store.info(cobrado).nombre : "";
    ui.cobrar.disabled = true;

    try {
      datos = await Store.cobrar(sesion.usuario, CFG.moneda.paso);
      pintar(true);
      animarCobro();
      // vibración sutil de "dinero entrando" (Android; iOS ignora la API)
      if ("vibrate" in navigator) navigator.vibrate(35);
      aviso(`¡Le cobraste ${dinero(CFG.moneda.paso)} a ${nombre}! 💵`);
    } catch (e) {
      console.error(e);
      aviso("No se pudo guardar el cobro 😿", true);
    } finally {
      setTimeout(() => (ui.cobrar.disabled = false), 450);
    }
  }

  /* ---------- entrar / salir ---------- */
  async function entrar(s) {
    sesion = s;
    ui.nombre.textContent = s.nombre || s.usuario;
    datos = await Store.obtenerDatos();
    totalMostrado = Store.totalDe(datos);
    deudasPrevias = Object.assign({}, datos.deudas);
    pintar(false);
    mostrarVista("app");

    if (desuscribir) desuscribir();
    desuscribir = Store.suscribir((nuevos) => {
      const eraIgual = JSON.stringify(nuevos) === JSON.stringify(datos);
      datos = nuevos;
      if (!eraIgual) pintar(true);
    });

    // chat: historial inicial + mensajes nuevos en tiempo real
    await chatEmpezar();
    if (desuscribirChat) desuscribirChat();
    desuscribirChat = Store.suscribirChat(chatLlegaron);
  }

  function salir() {
    if (desuscribir) desuscribir();
    desuscribir = null;
    if (desuscribirChat) desuscribirChat();
    desuscribirChat = null;
    Store.cerrarSesion();
    sesion = null;
    datos = null;
    totalMostrado = 0;
    deudasPrevias = {};
    ui.chatLista.textContent = "";
    chat.lista = [];
    chat.vistos.clear();
    chat.pendientes = [];
    chat.hayMas = false;
    ui.chatInput.value = "";
    ui.clave.value = "";
    mostrarVista("login");
    aviso("¡Hasta pronto! 👋");
  }

  /* ---------- eventos ---------- */
  ui.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    ui.error.hidden = true;

    const resultado = await Store.iniciarSesion(ui.usuario.value, ui.clave.value);
    if (!resultado.ok) {
      ui.error.textContent = resultado.error;
      ui.error.hidden = false;
      return;
    }

    ui.clave.value = "";
    await entrar(resultado.sesion);
  });

  ui.salir.addEventListener("click", salir);
  ui.cobrar.addEventListener("click", abrirModal);
  ui.btnNo.addEventListener("click", cerrarModal);
  ui.btnSi.addEventListener("click", confirmarCobro);
  ui.modal.addEventListener("click", (e) => {
    if (e.target === ui.modal) cerrarModal();
  });

  /* ---------- eventos del chat ---------- */
  ui.chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!sesion) return;
    const texto = limpiarChatTexto(ui.chatInput.value);
    if (!texto) {
      ui.chatInput.value = "";
      return;
    }
    ui.chatInput.value = "";
    enviarChat({
      id: "p" + Date.now(),          // clave provisional del borrador
      autor: sesion.usuario,
      texto,
      ts: Date.now(),
    });
  });

  // scrollear hasta arriba trae el lote anterior de la base
  ui.chatScroll.addEventListener("scroll", () => {
    if (ui.chatScroll.scrollTop < 40) cargarMsgsViejos();
  });
  ui.chatMas.addEventListener("click", cargarMsgsViejos);

  // reintentar un mensaje que falló, tocando su burbuja
  ui.chatLista.addEventListener("click", (e) => {
    const li = e.target.closest(".mensaje.fallo");
    if (!li) return;
    const borrador = chat.pendientes.find((p) => p.id === li.dataset.clave);
    if (borrador) enviarChat(borrador);
  });

  // al volver a la pestaña, repinta con los datos más frescos
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && sesion && datos) pintar(false);
  });

  /* ---------- arranque ---------- */
  function iniciar() {
    const sesionGuardada = Store.sesionActual();
    if (sesionGuardada) entrar(sesionGuardada);
    else mostrarVista("login");

    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Sin service worker:", e));
    }
  }

  iniciar();

  /* ---------- preview visual (solo consola, no toca la DB) ---------- */
  /**
   * Desde la consola del navegador (F12):
   *   nivel(0)    → frasco vacío
   *   nivel(25)   → 25 %
   *   nivel(50)   → 50 %
   *   nivel(75)   → 75 %
   *   nivel(100)  → lleno
   *   nivel()     → vuelve al valor real
   */
  window.nivel = function (pct) {
    if (pct === undefined) {
      // restaurar al valor real
      if (datos) pintar(false);
      console.log("🫙 Frasco restaurado al valor real.");
      return;
    }
    pct = Math.max(0, Math.min(100, Number(pct) || 0));
    ui.liquido.style.height = pct + "%";
    ui.liquido.classList.toggle("sin-dinero", pct <= 0);
    console.log(`🫙 Frasco al ${pct}% (solo visual, no afecta datos).`);
  };
})();
