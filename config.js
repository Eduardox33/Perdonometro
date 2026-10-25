/* ============================================================
   El Perdonómetro · configuración central
   ============================================================ */

window.PDM_CONFIG = {
  // Los únicos dos usuarios permitidos.
  usuarios: [
    { usuario: "anyi", clave: "2712", nombre: "Anyi", color: "#a8e4ff" },
    { usuario: "edu",  clave: "0608", nombre: "Edu",  color: "#ffd0e4" },
  ],

  // Dinero
  moneda: {
    codigo: "CLP",
    simbolo: "$",
    paso: 1000, // lo que suma "Cobrar luca"
    locale: "es-CL",
  },

  // Frasco: a este monto se ve lleno (NO hay tope de dinero:
  // el contador sigue subiendo y la animación sigue, solo que
  // visualmente el billete no sube más allá de aquí).
  frasco: {
    meta: 300000,
  },

  // Llaves de localStorage
  almacen: {
    prefijo: "pdm",
  },

  /* --------------------------------------------------------
     Turso (SQLite en la nube). Mientras url esté vacío, la app
     usa localStorage. Cuando tenga la base, pega aquí el url y
     el token y listo: el AdaptadorTurso de js/store.js ya está
     implementado.
     -------------------------------------------------------- */
  turso: {
    url: "libsql://perdonometro-eduardox33.aws-sa-east-1.turso.io",
    authToken: "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTI5NjIyNzMsImlkIjoiMDFhMTc0ZGQtMTEwMS03OGVjLTllNzktOWVlMWUxNDQ4OWI2Iiwia2lkIjoiTnpwSVl0YXVuOUE0Qk5XVG5DaEFwMFI5T3I1Mmd0N00waEdQUUU0UThyUSIsInJpZCI6IjNjOWUxOTk3LThkY2QtNDE4MC05NGUyLTE3ODRhMDVjY2JjZiJ9.p0jRP_f5-ulwxlCUxrtjNIclW8k-GJiF_wlaqcDIiQs3pPqzPOhmFJz5933WAXNbqdjPX77TeFNYaZQeaUGYBQ",
    // cada cuánto (ms) se consulta la base para "tiempo real"
    sondeoMs: 2000,
  },
};
