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
  };

  let sesion = null;
  let datos = null;
  let desuscribir = null;
  let totalMostrado = 0;        // para animar el contador
  let deudasPrevias = {};       // para animar el marcador
  let avisoTimer = null;

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
  }

  function salir() {
    if (desuscribir) desuscribir();
    desuscribir = null;
    Store.cerrarSesion();
    sesion = null;
    datos = null;
    totalMostrado = 0;
    deudasPrevias = {};
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
})();
