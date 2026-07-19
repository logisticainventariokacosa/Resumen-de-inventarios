/**
 * KACOSA - Dashboard de Inventarios
 * Backend Apps Script. Lee 2 Google Sheets y expone un endpoint JSON (doGet)
 * para el dashboard web (index.html en GitHub Pages).
 *
 * DESPLIEGUE:
 * 1. Abre CUALQUIERA de los 2 Sheets (recomendado: Maestro_Inventario).
 * 2. Extensiones > Apps Script.
 * 3. Pega este archivo como Code.gs.
 * 4. Implementar > Nueva implementación > Tipo: Aplicación web.
 *    - Ejecutar como: Yo (tu cuenta)
 *    - Quién tiene acceso: Cualquier usuario
 * 5. Copia la URL /exec y pégala en API_URL dentro de index.html.
 */

// ==================== CONFIG ====================

const DOC_TIENDAS_ID = '1YE-FwqO6Zt6FO-0Dv3uMHVCUWxX3msPoN-UQTzez0hI'; // Maestro_Inventario
const DOC_MATRIZ_ID  = '15ip1JXvR0fPHCLrsXJFSi7gLKNT0rTwQt88B9IuSdRE'; // INVENTARIO GENERAL KACOSA

const SUPERVISOR_CASA_MATRIZ = 'Derwin Rojas';
const NOMBRE_CASA_MATRIZ = 'Casa Matriz / CD';

const CACHE_SECONDS = 300; // 5 minutos

// Nombres de hoja (ajusta aquí si cambian en el futuro)
const SHEETS = {
  // Detalle de conteo por material: se combinan las 3, tienen columnas idénticas
  // y NO se solapan (UNIQUE_ID distinto en cada una) -> se pueden sumar sin duplicar.
  conteo: ['Maestro_Conteo_Completo', 'Tiendas_Upi', 'Grupo_Pepetodo'],
  controlInventarios: 'Control_Inventarios',
  supervisorCentro: 'SUPERVISOR_CENTRO',
  usuarios: 'USUARIOS',
  // Stock oficial (total de códigos) por centro: se combinan las 3 fuentes de SAP.
  maestroSap: ['Maestro_SAP', 'Maestro_SAP_UPI', 'Maestro_SAP_GRUPO_PEPETODO'],
  maestroCentros: 'Maestro_Centros',
  // Casa Matriz: 3 hojas complementarias (verificado que casi no se solapan en ID).
  matrizDetalle: ['INVENTARIO GENERAL 2026 OK ', 'CONTEO GENERAL', 'CONTEO EXHB'],
  matrizStock: 'STOCK KACOSA AL 09-07-2026'      // Ajustar si el nombre de esta hoja cambia cada carga
};

// ==================== ENTRY POINT ====================

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'resumen';
  let payload;
  try {
    switch (action) {
      case 'resumen':
        payload = getResumenGlobal_();
        break;
      case 'tiendas':
        payload = getListaTiendas_();
        break;
      case 'tienda':
        payload = getDetalleTienda_(e.parameter.nombre);
        break;
      case 'analistas':
        payload = getListaAnalistas_();
        break;
      case 'analista':
        payload = getDetalleAnalista_(e.parameter.nombre);
        break;
      default:
        payload = { error: 'accion_no_valida' };
    }
  } catch (err) {
    payload = { error: String(err), stack: err.stack };
  }
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==================== CACHE WRAPPER ====================

function getModeloCompleto_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('MODELO_COMPLETO');
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fallthrough, recompute */ }
  }
  const modelo = construirModelo_();
  const json = JSON.stringify(modelo);
  // CacheService limita a 100KB por key; si el modelo es más grande, lo partimos.
  if (json.length < 95000) {
    cache.put('MODELO_COMPLETO', json, CACHE_SECONDS);
  } else {
    putChunked_(cache, 'MODELO_COMPLETO', json);
  }
  return modelo;
}

function putChunked_(cache, key, str) {
  const CHUNK = 90000;
  const parts = Math.ceil(str.length / CHUNK);
  const map = {};
  for (let i = 0; i < parts; i++) {
    const chunkKey = key + '_' + i;
    cache.put(chunkKey, str.substr(i * CHUNK, CHUNK), CACHE_SECONDS);
    map[i] = chunkKey;
  }
  cache.put(key + '_META', JSON.stringify({ parts: parts }), CACHE_SECONDS);
}

// ==================== HELPERS DE LECTURA ====================

function sheetToObjects_(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error('Hoja no encontrada: ' + sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row.every(c => c === '' || c === null)) continue;
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      if (headers[c]) obj[headers[c]] = row[c];
    }
    rows.push(obj);
  }
  return rows;
}

// Combina varias hojas con las mismas columnas en una sola lista de objetos,
// deduplicando por el valor de la primera columna (el ID único de cada fila).
function sheetsMerged_(spreadsheet, sheetNames, idField) {
  const vistos = new Set();
  const combinado = [];
  sheetNames.forEach(nombre => {
    let filas;
    try {
      filas = sheetToObjects_(spreadsheet, nombre);
    } catch (e) {
      return; // si una hoja no existe (ej. cambió de nombre), se ignora en vez de romper todo
    }
    filas.forEach(f => {
      const id = idField ? f[idField] : JSON.stringify(f);
      if (vistos.has(id)) return;
      vistos.add(id);
      combinado.push(f);
    });
  });
  return combinado;
}

function toNum_(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function esOk_(estatus) {
  return String(estatus || '').trim().toUpperCase() === 'OK';
}

function fueContado_(fechaUltimoConteo, conteo) {
  // Se considera "contado" si tiene fecha de último conteo o una cantidad contada registrada
  if (fechaUltimoConteo) return true;
  return conteo !== null && conteo !== undefined && conteo !== '';
}

function diasEntre_(fechaInicio, fechaFin) {
  if (!fechaInicio) return 0;
  const ini = new Date(fechaInicio);
  const fin = fechaFin ? new Date(fechaFin) : new Date();
  const ms = fin.getTime() - ini.getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

// ==================== MODELO PRINCIPAL ====================

function construirModelo_() {
  const ssTiendas = SpreadsheetApp.openById(DOC_TIENDAS_ID);
  const ssMatriz = SpreadsheetApp.openById(DOC_MATRIZ_ID);

  // ---- Catálogos de apoyo (documento Tiendas) ----
  const usuarios = sheetToObjects_(ssTiendas, SHEETS.usuarios);
  const usuarioPorId = {};
  usuarios.forEach(u => { usuarioPorId[String(u.ID_USUARIO).trim()] = u.NOMBRE; });

  // Analistas registrados (rol INVENTARIO) con su tienda "base" asignada,
  // usado como respaldo para quienes no tengan conteos activos ahora mismo.
  const analistasRegistrados = usuarios.filter(u => String(u.ROL || '').trim().toUpperCase() === 'INVENTARIO');

  const supervisorCentro = sheetToObjects_(ssTiendas, SHEETS.supervisorCentro);
  const supervisorPorCentro = {};
  supervisorCentro.forEach(s => {
    const nombre = usuarioPorId[String(s.ID_USUARIO_REF).trim()] || s.ID_USUARIO_REF;
    supervisorPorCentro[s.NOMBRE_CENTRO] = nombre;
  });

  const controlInventarios = sheetToObjects_(ssTiendas, SHEETS.controlInventarios);
  // Nos quedamos con el registro más reciente (última FECHA_APERTURA) por centro,
  // esto sólo se usa para la ficha de tiendas INACTIVAS (fecha/duración del último inventario).
  const controlPorCentro = {};
  controlInventarios.forEach(ci => {
    const existente = controlPorCentro[ci.NOMBRE_CENTRO];
    if (!existente || new Date(ci.FECHA_APERTURA) > new Date(existente.FECHA_APERTURA)) {
      controlPorCentro[ci.NOMBRE_CENTRO] = ci;
    }
  });

  // Universo completo de tiendas (para poder listar también las inactivas)
  const maestroCentros = sheetToObjects_(ssTiendas, SHEETS.maestroCentros);
  const universoTiendas = new Set(maestroCentros.map(c => c.NOMBRE_CENTRO).filter(Boolean));
  Object.keys(controlPorCentro).forEach(n => universoTiendas.add(n));

  // ---- Detalle de conteos (Maestro_Conteo_Completo + Tiendas_Upi + Grupo_Pepetodo) ----
  const conteo = sheetsMerged_(ssTiendas, SHEETS.conteo, 'UNIQUE_ID');

  // tiendasCodigos[nombreCentro][material] = { fecha, conteo, tieneDiferencia }  (última ocurrencia)
  const tiendasCodigos = {};
  const tiendasPiezas = {};      // suma bruta de piezas (todas las filas)
  const tiendasAnalistas = {};   // Set de analistas (ULTIMO_AUDITOR_EN_CONTAR) por tienda
  const tiendasCentroCod = {};   // nombreCentro -> código SAP del centro
  const analistasMap = {};       // nombre_analista -> stats

  conteo.forEach(r => {
    const centroNombre = r.NOMBRE_CENTRO;
    if (!centroNombre) return;
    const material = r.MATERIAL;
    const analista = r.ULTIMO_AUDITOR_EN_CONTAR;
    const contado = fueContado_(r.FECHA_ULTIMO_CONTEO, r.CONTEO);
    if (!contado) return;

    tiendasCentroCod[centroNombre] = String(r.CENTRO);
    if (!tiendasCodigos[centroNombre]) tiendasCodigos[centroNombre] = {};
    if (!tiendasPiezas[centroNombre]) tiendasPiezas[centroNombre] = 0;
    if (!tiendasAnalistas[centroNombre]) tiendasAnalistas[centroNombre] = new Set();

    tiendasPiezas[centroNombre] += toNum_(r.CONTEO);

    // Dedupe por código dentro de la misma tienda: nos quedamos con el registro más reciente
    if (material !== undefined && material !== null && material !== '') {
      const actual = tiendasCodigos[centroNombre][material];
      const fecha = r.FECHA_ULTIMO_CONTEO ? new Date(r.FECHA_ULTIMO_CONTEO) : null;
      if (!actual || (fecha && actual.fecha && fecha > actual.fecha) || (fecha && !actual.fecha)) {
        tiendasCodigos[centroNombre][material] = { fecha: fecha, sinDiferencia: esOk_(r.ESTATUS_DIFERENCIA) };
      }
    }

    if (analista) {
      tiendasAnalistas[centroNombre].add(analista);
      if (!analistasMap[analista]) {
        analistasMap[analista] = {
          nombre: analista, codigosContados: 0, piezasContadas: 0,
          conteosOk: 0, conteosDiferencia: 0, tiendas: new Set(), diasActivos: new Set()
        };
      }
      const a = analistasMap[analista];
      a.codigosContados += 1; // cada evento de conteo cuenta como trabajo real del analista
      a.piezasContadas += toNum_(r.CONTEO);
      if (esOk_(r.ESTATUS_DIFERENCIA)) a.conteosOk += 1; else a.conteosDiferencia += 1;
      a.tiendas.add(centroNombre);
      if (r.FECHA_ULTIMO_CONTEO) {
        const d = new Date(r.FECHA_ULTIMO_CONTEO);
        a.diasActivos.add(d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate());
      }
    }
  });

  // Ensamblar objetos finales de tienda
  const tiendas = [];
  universoTiendas.forEach(nombre => {
    const codigosMap = tiendasCodigos[nombre];
    const activa = !!codigosMap; // presente en las hojas de conteo = activa
    const control = controlPorCentro[nombre] || {};

    if (activa) {
      let conDif = 0, sinDif = 0;
      Object.keys(codigosMap).forEach(mat => {
        if (codigosMap[mat].sinDiferencia) sinDif += 1; else conDif += 1;
      });
      tiendas.push({
        nombre: nombre,
        codigo: tiendasCentroCod[nombre],
        activa: true,
        supervisor: supervisorPorCentro[nombre] || control.NOMBRE_USUARIO || 'No asignado',
        fechaApertura: control.FECHA_APERTURA || null,
        fechaCierre: null,
        diasTranscurridos: diasEntre_(control.FECHA_APERTURA),
        stockTotal: 0, // se llena abajo con Maestro_SAP
        codigosContados: Object.keys(codigosMap).length,
        piezasContadas: tiendasPiezas[nombre] || 0,
        itemsConDiferencia: conDif,
        itemsSinDiferencia: sinDif,
        analistas: Array.from(tiendasAnalistas[nombre] || [])
      });
    } else {
      tiendas.push({
        nombre: nombre,
        codigo: control.CENTRO ? String(control.CENTRO) : '',
        activa: false,
        supervisor: supervisorPorCentro[nombre] || control.NOMBRE_USUARIO || 'No asignado',
        fechaApertura: control.FECHA_APERTURA || null,
        fechaCierre: control.FECHA_CIERRE || null,
        diasTranscurridos: diasEntre_(control.FECHA_APERTURA, control.FECHA_CIERRE),
        stockTotal: 0,
        codigosContados: 0,
        piezasContadas: 0,
        itemsConDiferencia: 0,
        itemsSinDiferencia: 0,
        analistas: []
      });
    }
  });

  // ---- Stock (total de códigos) por centro, Maestro_SAP (3 fuentes combinadas) ----
  const maestroSap = sheetsMerged_(ssTiendas, SHEETS.maestroSap, 'Id_SAP');
  const stockPorCentro = {};
  maestroSap.forEach(m => {
    const centro = String(m['Centro']);
    stockPorCentro[centro] = (stockPorCentro[centro] || 0) + 1;
  });
  tiendas.forEach(t => { t.stockTotal = stockPorCentro[t.codigo] || 0; });

  // Agregar Casa Matriz como una "tienda" más
  const casaMatriz = construirCasaMatriz_(ssMatriz, analistasMap);
  casaMatriz.analistas = Object.keys(analistasMap).filter(n => analistasMap[n].tiendas.has(NOMBRE_CASA_MATRIZ));
  tiendas.push(casaMatriz);

  const analistas = Object.keys(analistasMap).map(nombre => {
    const a = analistasMap[nombre];
    const dias = a.diasActivos.size || 1;
    const tiendasArr = Array.from(a.tiendas);
    return {
      nombre: a.nombre,
      codigosContados: a.codigosContados,
      piezasContadas: a.piezasContadas,
      conteosOk: a.conteosOk,
      conteosDiferencia: a.conteosDiferencia,
      tiendas: tiendasArr,
      promedioCodigosPorDia: Math.round((a.codigosContados / dias) * 100) / 100,
      promedioCodigosPorTienda: tiendasArr.length ? Math.round((a.codigosContados / tiendasArr.length) * 100) / 100 : 0,
      activo: true // si aparece en el modelo es porque tiene conteos en una tienda/matriz actualmente activa
    };
  });

  const registrados = analistasRegistrados.map(u => ({ nombre: u.NOMBRE, tiendaAsignada: u.CENTRO }));

  return { tiendas: tiendas, analistas: analistas, registrados: registrados, generadoEn: new Date().toISOString() };
}

// Las 3 hojas de Casa Matriz tienen columnas distintas (la de exhibición no
// tiene STATUS, por ejemplo), así que cada una se normaliza a un formato común
// {codigo, cantidad, analista, fecha, tieneDiferencia} antes de combinarlas.
function normalizarFilaMatriz_(r, tipoHoja) {
  if (tipoHoja === 'exhb') {
    return {
      codigo: r['CODIGO'],
      cantidad: toNum_(r['CONTEO EXHB']),
      analista: r['ULTIMO AUDITOR EN CONTAR'],
      fecha: r['FECHA ULTIMO CONTEO'],
      contado: fueContado_(r['FECHA ULTIMO CONTEO'], r['CONTEO EXHB']),
      tieneDiferencia: toNum_(r['DIFERENCIA']) !== 0
    };
  }
  // 'INVENTARIO GENERAL 2026 OK ' y 'CONTEO GENERAL' comparten estructura
  return {
    codigo: r['CODIGO'],
    cantidad: toNum_(r['CONTEO GENERAL']),
    analista: r['ULTIMO AUDITOR EN CONTAR'],
    fecha: r['FECHA ULTIMO CONTEO'],
    contado: fueContado_(r['FECHA ULTIMO CONTEO'], r['CONTEO GENERAL']),
    tieneDiferencia: String(r['STATUS'] || '').trim().toUpperCase() !== 'OK'
  };
}

function construirCasaMatriz_(ssMatriz, analistasMapGlobal) {
  const fuentes = [
    { hoja: SHEETS.matrizDetalle[0], tipo: 'general' },
    { hoja: SHEETS.matrizDetalle[1], tipo: 'general' },
    { hoja: SHEETS.matrizDetalle[2], tipo: 'exhb' }
  ];
  const detalle = [];
  fuentes.forEach(f => {
    let filas;
    try { filas = sheetToObjects_(ssMatriz, f.hoja); } catch (e) { return; }
    filas.forEach(r => detalle.push(normalizarFilaMatriz_(r, f.tipo)));
  });

  let stockTotal = 0;
  try {
    const stockRows = sheetToObjects_(ssMatriz, SHEETS.matrizStock);
    stockTotal = stockRows.filter(r => r['Material']).length;
  } catch (e) {
    stockTotal = detalle.length; // fallback
  }

  // Dedupe por CODIGO combinando las 3 hojas: nos quedamos con el registro más reciente
  const codigosMap = {};
  let piezasContadas = 0;
  let fechaMinima = null;

  detalle.forEach(n => {
    if (!n.contado) return;
    piezasContadas += n.cantidad; // piezas: se suman TODAS, sin deduplicar

    if (n.fecha) {
      const d = new Date(n.fecha);
      if (!fechaMinima || d < fechaMinima) fechaMinima = d;
    }

    if (n.codigo !== undefined && n.codigo !== null && n.codigo !== '') {
      const actual = codigosMap[n.codigo];
      const fecha = n.fecha ? new Date(n.fecha) : null;
      if (!actual || (fecha && actual.fecha && fecha > actual.fecha) || (fecha && !actual.fecha)) {
        codigosMap[n.codigo] = { fecha: fecha, tieneDiferencia: n.tieneDiferencia };
      }
    }

    if (n.analista) {
      if (!analistasMapGlobal[n.analista]) {
        analistasMapGlobal[n.analista] = {
          nombre: n.analista, codigosContados: 0, piezasContadas: 0,
          conteosOk: 0, conteosDiferencia: 0, tiendas: new Set(), diasActivos: new Set()
        };
      }
      const a = analistasMapGlobal[n.analista];
      a.codigosContados += 1;
      a.piezasContadas += n.cantidad;
      if (n.tieneDiferencia) a.conteosDiferencia += 1; else a.conteosOk += 1;
      a.tiendas.add(NOMBRE_CASA_MATRIZ);
      if (n.fecha) {
        const d = new Date(n.fecha);
        a.diasActivos.add(d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate());
      }
    }
  });

  let conDif = 0, sinDif = 0;
  Object.keys(codigosMap).forEach(c => {
    if (codigosMap[c].tieneDiferencia) conDif += 1; else sinDif += 1;
  });

  return {
    nombre: NOMBRE_CASA_MATRIZ,
    codigo: 'MATRIZ',
    activa: true, // Casa Matriz cuenta de forma continua
    supervisor: SUPERVISOR_CASA_MATRIZ,
    fechaApertura: fechaMinima ? fechaMinima.toISOString() : null,
    fechaCierre: null,
    diasTranscurridos: fechaMinima ? diasEntre_(fechaMinima) : 0,
    stockTotal: stockTotal,
    codigosContados: Object.keys(codigosMap).length,
    piezasContadas: piezasContadas,
    itemsConDiferencia: conDif,
    itemsSinDiferencia: sinDif,
    analistas: [] // se puede derivar de la lista global de analistas filtrando por esta tienda
  };
}

// ==================== ENDPOINTS ====================

function getResumenGlobal_() {
  const modelo = getModeloCompleto_();
  const activas = modelo.tiendas.filter(t => t.activa);
  const analistasActivos = modelo.analistas.filter(a => a.activo);
  return {
    tiendasActivas: activas.length,
    analistasActivos: analistasActivos.length,
    codigosContados: activas.reduce((s, t) => s + t.codigosContados, 0),
    piezasContadas: activas.reduce((s, t) => s + t.piezasContadas, 0),
    itemsConDiferencia: activas.reduce((s, t) => s + t.itemsConDiferencia, 0),
    itemsSinDiferencia: activas.reduce((s, t) => s + t.itemsSinDiferencia, 0),
    generadoEn: modelo.generadoEn
  };
}

function getListaTiendas_() {
  const modelo = getModeloCompleto_();
  return modelo.tiendas.map(t => ({ nombre: t.nombre, activa: t.activa }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

function getDetalleTienda_(nombre) {
  const modelo = getModeloCompleto_();
  const t = modelo.tiendas.find(x => x.nombre === nombre);
  if (!t) return { error: 'tienda_no_encontrada' };
  return t;
}

function getListaAnalistas_() {
  const modelo = getModeloCompleto_();
  const activos = modelo.analistas.map(a => ({ nombre: a.nombre, activo: true }));
  const nombresActivos = new Set(activos.map(a => a.nombre));
  const inactivos = modelo.registrados
    .filter(r => !nombresActivos.has(r.nombre))
    .map(r => ({ nombre: r.nombre, activo: false }));
  return activos.concat(inactivos).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

function getDetalleAnalista_(nombre) {
  const modelo = getModeloCompleto_();
  const a = modelo.analistas.find(x => x.nombre === nombre);
  if (a) return a;
  const registrado = modelo.registrados.find(x => x.nombre === nombre);
  if (registrado) {
    return { nombre: registrado.nombre, activo: false, tiendaAsignada: registrado.tiendaAsignada };
  }
  return { error: 'analista_no_encontrado' };
}
