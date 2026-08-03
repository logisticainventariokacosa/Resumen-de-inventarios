const queryParams = new URLSearchParams(window.location.search);
const API_URL = queryParams.get('apiUrl') || 'https://script.google.com/macros/s/AKfycby3sVIcPfIY1xJUO_qHYXH_XcL0QhPSbNrqLiSaBrKCcH7l54uDPVCK4hlR1kTztlg76Q/exec';

// Mismo proyecto de Firebase que el Portal KACOSA: si el usuario ya inició
// sesión en el portal, entra aquí directo sin volver a loguearse.
const firebaseConfig = {
  apiKey: "AIzaSyAeXFRdPZsEKX5vcTgGQ5hIOAlJyVv92kQ",
  authDomain: "portal-kacosa.firebaseapp.com",
  projectId: "portal-kacosa",
  storageBucket: "portal-kacosa.firebasestorage.app",
  messagingSenderId: "350653710617",
  appId: "1:350653710617:web:d29f757730e4515ec3c588"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Roles con acceso a este dashboard (debe coincidir con "rolesPermitidos" del portal)
const ROLES_PERMITIDOS_DASHBOARD = ["coordinador", "directiva", "admin"];

function mostrarEstadoAuth(msg, esError = false) {
  const el = document.getElementById('authStatus');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('error', esError);
}

async function verificarAccesoDashboard(email) {
  try {
    const snap = await db.collection("usuarios").doc(email).get();
    if (!snap.exists) return false;
    const rol = snap.data().rol;
    return ROLES_PERMITIDOS_DASHBOARD.includes(rol);
  } catch (e) {
    console.error("Error verificando acceso:", e);
    return false;
  }
}

function mensajeErrorAuth(code) {
  const map = {
    "auth/wrong-password": "Contraseña incorrecta.",
    "auth/user-not-found": "No existe una cuenta con ese correo.",
    "auth/invalid-email": "El correo no es válido.",
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/too-many-requests": "Demasiados intentos. Espera unos minutos."
  };
  return map[code] || ("No se pudo iniciar sesión (" + code + ")");
}

const ICON_EYE_OPEN = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>`;
const ICON_EYE_CLOSE = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"/>
    <path d="M8 8l8 8"/>
    <path d="M16 8l-8 8"/>
  </svg>`;

document.getElementById('authTogglePassword').addEventListener('click', () => {
  const input = document.getElementById('authPassword');
  const btn = document.getElementById('authTogglePassword');
  const oculto = input.type === 'password';
  input.type = oculto ? 'text' : 'password';
  btn.innerHTML = oculto ? ICON_EYE_CLOSE : ICON_EYE_OPEN;
  btn.setAttribute('aria-label', oculto ? 'Ocultar contraseña' : 'Mostrar contraseña');
});

document.getElementById('formLogin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('authEmail').value.trim();
  const pass = document.getElementById('authPassword').value;
  mostrarEstadoAuth('Conectando…');
  try {
    await auth.signInWithEmailAndPassword(email, pass);
  } catch (err) {
    mostrarEstadoAuth(mensajeErrorAuth(err.code), true);
  }
});

document.getElementById('authBtnGoogle').addEventListener('click', async () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  mostrarEstadoAuth('Conectando con Google…');
  try {
    await auth.signInWithPopup(provider);
  } catch (err) {
    mostrarEstadoAuth(mensajeErrorAuth(err.code), true);
  }
});

auth.onAuthStateChanged(async (user) => {
  const authScreen = document.getElementById('authScreen');
  const mainApp = document.getElementById('mainApp');

  if (!user) {
    authScreen.style.display = 'flex';
    mainApp.style.display = 'none';
    return;
  }

  mostrarEstadoAuth('Verificando acceso…');
  const autorizado = await verificarAccesoDashboard(user.email);
  if (!autorizado) {
    // No se cierra sesión: es compartida con el portal y las demás apps.
    authScreen.style.display = 'flex';
    mainApp.style.display = 'none';
    mostrarEstadoAuth('Tu cuenta no tiene acceso a este dashboard.', true);
    return;
  }

  authScreen.style.display = 'none';
  mainApp.style.display = 'block';
  iniciarDashboard();
});

const $ = id => document.getElementById(id);
let chartRef = null;
let chartRef2 = null;
let modeloGlobal = null;
let vistaActual = { tipo: 'general', nombre: null, analistaDesplegado: null, tiendaFiltro: null };

function showLoading(){ $('statusDot').className='status-dot loading'; }
function hideLoading(){ $('statusDot').className='status-dot'; }
function fmt(n){ return new Intl.NumberFormat('es-VE').format(Math.round(n || 0)); }
function fmtDate(iso){ if(!iso)return '—'; const d=new Date(iso); if(isNaN(d))return iso; return d.toLocaleDateString('es-VE'); }
function destroyChart(){ if(chartRef){ chartRef.destroy(); chartRef=null; } if(chartRef2){ chartRef2.destroy(); chartRef2=null; } }

// ==================== FUNCIONES DE CÁLCULO ====================

function calcularPromedioCodigosPorDia(codigosContados, diasTranscurridos) {
  if (!diasTranscurridos || diasTranscurridos === 0) return 0;
  return Math.round((codigosContados / diasTranscurridos) * 100) / 100;
}

function calcularEfectividad(itemsSinDiferencia, codigosContados) {
  if (!codigosContados || codigosContados === 0) return 0;
  return Math.round((itemsSinDiferencia / codigosContados) * 10000) / 100;
}

function calcularPromedioPiezasPorDia(piezasContadas, diasActivos) {
  if (!diasActivos || diasActivos === 0) return 0;
  return Math.round((piezasContadas / diasActivos) * 100) / 100;
}

function getEfectividadColor(valor) {
  if (valor >= 80) return 'var(--green)';
  if (valor >= 50) return 'var(--amber)';
  return 'var(--red)';
}

async function api(action, params) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  if (params) Object.keys(params).forEach(k => url.searchParams.set(k, params[k]));
  const res = await fetch(url);
  const text = await res.text();
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${text.slice(0, 300)}`);
  }
  // Si el servidor no devolvió JSON, lanzar un error legible
  if (!contentType.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error('Respuesta de API no es JSON: ' + text.slice(0, 300));
    }
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('Error parseando JSON de la API: ' + e.message + ' — respuesta: ' + text.slice(0, 300));
  }
}

async function cargarModeloCompleto() {
  if (modeloGlobal) return modeloGlobal;
  showLoading();
  try {
    const respuesta = await api('modelo_completo');
    if (respuesta.error) throw new Error(respuesta.error);
    modeloGlobal = respuesta;
    return modeloGlobal;
  } catch (err) {
    console.error('Error cargando modelo completo:', err);
    const [resumen, tiendas, analistas] = await Promise.all([
      api('resumen'),
      api('tiendas'),
      api('analistas')
    ]);
    modeloGlobal = { resumen, tiendas, analistas };
    return modeloGlobal;
  } finally {
    hideLoading();
  }
}

// ==================== MODAL DE TARJETAS KPI ====================

const KPI_CONFIG = {
  tiendas: { titulo: 'Tiendas activas', color: 'steel', colIzq: 'Tienda', columna: 'Fecha de inicio' },
  analistas: { titulo: 'Analistas activos', color: 'indigo', colIzq: 'Analista', columna: 'Tienda asignada' },
  codigos: { titulo: 'Códigos contados', color: 'teal', colIzq: 'Tienda', columna: 'Códigos contados', campo: 'codigosContados' },
  piezas: { titulo: 'Piezas contadas', color: 'slate', colIzq: 'Tienda', columna: 'Piezas contadas', campo: 'piezasContadas' },
  condif: { titulo: 'Códigos con diferencia', color: 'amber', colIzq: 'Tienda', columna: 'Con diferencia', campo: 'itemsConDiferencia' },
  sindif: { titulo: 'Códigos sin diferencia', color: 'green', colIzq: 'Tienda', columna: 'Sin diferencia', campo: 'itemsSinDiferencia' }
};

function abrirModalKpi(tipo) {
  if (!modeloGlobal) return;
  const cfg = KPI_CONFIG[tipo];
  if (!cfg) return;

  let filas = [];

  if (tipo === 'tiendas') {
    filas = (modeloGlobal.tiendas || [])
      .filter(t => t.activa)
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map(t => ({ nombre: t.nombre, valor: fmtDate(t.fechaApertura) }));
  } else if (tipo === 'analistas') {
    filas = (modeloGlobal.analistas || [])
      .filter(a => a.activo)
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map(a => ({ nombre: a.nombre, valor: a.tiendaAsignada || 'No asignada' }));
  } else {
    filas = (modeloGlobal.tiendas || [])
      .filter(t => t.activa)
      .sort((a, b) => (b[cfg.campo] || 0) - (a[cfg.campo] || 0))
      .map(t => ({ nombre: t.nombre, valor: fmt(t[cfg.campo]) }));
  }

  $('modalHeader').className = 'modal-header ' + cfg.color;
  $('modalTitulo').textContent = cfg.titulo;
  $('modalCount').textContent = filas.length + (filas.length === 1 ? ' registro' : ' registros');
  $('modalColIzq').textContent = cfg.colIzq;
  $('modalColDer').textContent = cfg.columna;

  if (!filas.length) {
    $('modalRows').innerHTML = '<div class="empty-state">Sin datos disponibles.</div>';
  } else {
    $('modalRows').innerHTML = filas.map(f => `
      <div class="modal-row">
        <span class="nombre">${f.nombre}</span>
        <span class="valor">${f.valor}</span>
      </div>`).join('');
  }

  $('modalBackdrop').classList.add('open');
}

function cerrarModalKpi() {
  $('modalBackdrop').classList.remove('open');
}

document.querySelectorAll('[data-kpi]').forEach(el => {
  el.addEventListener('click', () => abrirModalKpi(el.dataset.kpi));
});
$('modalCloseBtn').addEventListener('click', cerrarModalKpi);
$('modalBackdrop').addEventListener('click', e => {
  if (e.target === e.currentTarget) cerrarModalKpi();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') cerrarModalKpi();
});

// ==================== VISTAS PRINCIPALES ====================

async function renderVistaGeneral() {
  destroyChart();
  vistaActual = { tipo: 'general', nombre: null, analistaDesplegado: null, tiendaFiltro: null };
  await cargarModeloCompleto();
  $('content').innerHTML = `
    <div class="section-title">Vista general</div>
    <div class="card">
      <p class="empty-state">Selecciona una tienda o un analista arriba para ver el detalle de su avance.</p>
    </div>`;
  actualizarFiltros();
}

async function renderTienda(nombre) {
  destroyChart();
  vistaActual = { tipo: 'tienda', nombre: nombre, analistaDesplegado: null, tiendaFiltro: null };
  $('content').innerHTML = `<div class="loading-state"><div class="spinner"></div><div class="text">Cargando tienda…</div></div>`;
  
  let t = null;
  if (modeloGlobal && modeloGlobal.tiendas) {
    t = modeloGlobal.tiendas.find(x => x.nombre === nombre);
  }
  if (!t) t = await api('tienda', { nombre });
  
  if (t.error) {
    $('content').innerHTML = `<div class="empty-state">No se encontró la tienda.</div>`;
    actualizarFiltros();
    return;
  }

  if (!t.activa) {
    $('content').innerHTML = `
      <div class="section-title">Tienda · ${t.nombre}</div>
      <div class="card">
        <div class="detail-header">
          <h2>${t.nombre}</h2>
          <span class="badge off">Sin inventario activo</span>
        </div>
        <div class="stat-list">
          <div class="item"><div class="k">Supervisor</div><div class="v">${t.supervisor}</div></div>
          <div class="item"><div class="k">Fecha último inventario (inicio)</div><div class="v">${fmtDate(t.fechaApertura)}</div></div>
          <div class="item"><div class="k">Fecha de cierre</div><div class="v">${fmtDate(t.fechaCierre)}</div></div>
          <div class="item"><div class="k">Duración del último inventario</div><div class="v">${fmt(t.diasTranscurridos)} días</div></div>
        </div>
      </div>`;
    actualizarFiltros();
    return;
  }

  const avance = t.stockTotal > 0 ? (t.codigosContados / t.stockTotal) * 100 : 0;
  
  // Calcular métricas para la tienda
  const promedioCodigosPorDia = calcularPromedioCodigosPorDia(t.codigosContados, t.diasTranscurridos);
  const efectividad = calcularEfectividad(t.itemsSinDiferencia, t.codigosContados);
  const colorEfectividad = getEfectividadColor(efectividad);
  
  let html = `
    <div class="section-title">Tienda · ${t.nombre}</div>
    <div class="grid-2" id="tiendaGrid">
      <div class="card tienda-card">
        <div class="detail-header">
          <h2>${t.nombre}</h2>
          <span class="badge on">Inventario activo</span>
        </div>
        <div class="progress-wrap">
          <div class="progress-label-top">
            <span class="main"><b>${fmt(t.codigosContados)}</b> de <b>${fmt(t.stockTotal)}</b> códigos contados</span>
            <span class="pct">${avance.toFixed(1)}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width:${Math.min(avance,100)}%"></div>
          </div>
        </div>
        <div class="stat-list">
          <div class="item"><div class="k">Supervisor</div><div class="v">${t.supervisor}</div></div>
          <div class="item"><div class="k">Días transcurridos</div><div class="v">${fmt(t.diasTranscurridos)} días</div></div>
          <div class="item"><div class="k">Fecha de inicio</div><div class="v">${fmtDate(t.fechaApertura)}</div></div>
          <div class="item"><div class="k">Piezas contadas</div><div class="v">${fmt(t.piezasContadas)}</div></div>
          <div class="item"><div class="k">Ítems con diferencia</div><div class="v">${fmt(t.itemsConDiferencia)}</div></div>
          <div class="item"><div class="k">Ítems sin diferencia</div><div class="v">${fmt(t.itemsSinDiferencia)}</div></div>
          <div class="item"><div class="k">Promedio códigos / día</div><div class="v">${promedioCodigosPorDia.toFixed(2)}</div></div>
          <div class="item"><div class="k">Efectividad de conteo</div><div class="v" style="color:${colorEfectividad};">${efectividad.toFixed(1)}%</div></div>
        </div>
        <div style="margin-top:12px;font-size:12px;color:var(--muted);font-weight:600;">Analistas que han contado aquí:</div>
        <div class="tag-list">${t.analistas.map(a => `
          <span class="tag clickable" data-analista="${a.nombre}" data-tienda="${t.nombre}">
            ${a.nombre}${a.actual ? ' <span class="actual">Actual</span>' : ''}
          </span>
        `).join('')}</div>
      </div>
      <div class="card">
        <canvas id="chartTienda"></canvas>
      </div>
    </div>
    <div id="analistaExpandido" style="margin-top:20px;"></div>
  `;

  $('content').innerHTML = html;

  const ctx = document.getElementById('chartTienda');
  if (ctx) {
    chartRef = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Sin diferencia', 'Con diferencia', 'Por contar'],
        datasets: [{
          data: [t.itemsSinDiferencia, t.itemsConDiferencia, Math.max(t.stockTotal - t.codigosContados, 0)],
          backgroundColor: ['#3E9C6E', '#D5573B', '#E3E7EE'],
          borderWidth: 0
        }]
      },
      options: {
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, padding: 16, font: { size: 12 } } },
          tooltip: { callbacks: { label: ctx => ctx.label + ': ' + fmt(ctx.raw) } }
        },
        cutout: '60%'
      },
      plugins: [{
        id: 'doughnutLabels',
        afterDraw(chart) {
          const ctx2 = chart.ctx;
          const data = chart.data.datasets[0].data;
          const total = data.reduce((a,b) => a + b, 0);
          if (total === 0) return;
          const centerX = chart.width / 2;
          const centerY = chart.height / 2;
          let angleStart = -Math.PI / 2;
          data.forEach((value, i) => {
            if (value === 0) return;
            const angle = (value / total) * Math.PI * 2;
            const midAngle = angleStart + angle / 2;
            const radius = chart.getDatasetMeta(0).data[i].outerRadius * 0.7;
            const x = centerX + Math.cos(midAngle) * radius;
            const y = centerY + Math.sin(midAngle) * radius;
            ctx2.fillStyle = '#16202E';
            ctx2.font = 'bold 13px JetBrains Mono, monospace';
            ctx2.textAlign = 'center';
            ctx2.textBaseline = 'middle';
            ctx2.fillText(fmt(value), x, y);
            angleStart += angle;
          });
        }
      }]
    });
  }

  document.querySelectorAll('[data-analista]').forEach(el => {
    el.addEventListener('click', () => {
      const analista = el.dataset.analista;
      const tienda = el.dataset.tienda;
      desplegarAnalistaEnTienda(analista, tienda);
    });
  });

  actualizarFiltros();
}

async function desplegarAnalistaEnTienda(nombreAnalista, nombreTienda) {
  const container = document.getElementById('analistaExpandido');
  if (!container) return;

  if (vistaActual.analistaDesplegado === nombreAnalista) {
    container.innerHTML = '';
    vistaActual.analistaDesplegado = null;
    return;
  }

  vistaActual.analistaDesplegado = nombreAnalista;
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><div class="text">Cargando datos de ${nombreAnalista} en ${nombreTienda}…</div></div>`;

  const a = await api('analista', { nombre: nombreAnalista, tienda: nombreTienda });
  if (a.error) {
    container.innerHTML = `<div class="empty-state">No se encontró el analista.</div>`;
    return;
  }

  if (a.filtroActivo === false) {
    container.innerHTML = `
      <div class="card analista-card">
        <div class="detail-header">
          <h2 style="font-size:17px;">👤 ${a.nombre}</h2>
          <span class="badge off">Sin datos en ${nombreTienda}</span>
        </div>
        <p class="empty-state">Este analista no ha contado en ${nombreTienda}.</p>
        <div style="text-align:right;margin-top:8px;">
          <button class="btn-back-bottom" onclick="cerrarAnalistaDesplegado()">Cerrar</button>
        </div>
      </div>`;
    return;
  }

  const promedioPorDia = a.promedioCodigosPorDia || (a.codigosContados / (a.diasActivos || 1));
  const promedioPiezasPorDia = calcularPromedioPiezasPorDia(a.piezasContadas, a.diasActivos || 1);
  const efectividadAnalista = calcularEfectividad(a.conteosOk, a.codigosContados);
  const colorEfectividad = getEfectividadColor(efectividadAnalista);

  container.innerHTML = `
    <div class="card analista-card">
      <div class="detail-header">
        <h2 style="font-size:17px;">👤 ${a.nombre} · en ${nombreTienda}</h2>
        <span class="badge on">${a.tiendaFiltro ? 'Actual' : 'Ha contado aquí'}</span>
      </div>
      <div class="analista-expandido-grid">
        <div>
          <div class="stat-list">
            <div class="item"><div class="k">Códigos contados</div><div class="v">${fmt(a.codigosContados)}</div></div>
            <div class="item"><div class="k">Piezas contadas</div><div class="v">${fmt(a.piezasContadas)}</div></div>
            <div class="item"><div class="k">Sin diferencia (OK)</div><div class="v" style="color:var(--green);">${fmt(a.conteosOk)}</div></div>
            <div class="item"><div class="k">Con diferencia</div><div class="v" style="color:var(--red);">${fmt(a.conteosDiferencia)}</div></div>
            <div class="item"><div class="k">Días activos en esta tienda</div><div class="v">${a.diasActivos || '—'}</div></div>
            <div class="item"><div class="k">Promedio códigos / día</div><div class="v">${promedioPorDia.toFixed(2)}</div></div>
            <div class="item"><div class="k">Promedio piezas contadas / día</div><div class="v">${promedioPiezasPorDia.toFixed(2)}</div></div>
            <div class="item"><div class="k">Efectividad de conteo</div><div class="v" style="color:${colorEfectividad};">${efectividadAnalista.toFixed(1)}%</div></div>
          </div>
        </div>
        <div>
          <canvas id="chartAnalistaTienda"></canvas>
        </div>
      </div>
      <div style="text-align:right;margin-top:8px;">
        <button class="btn-back-bottom" onclick="cerrarAnalistaDesplegado()">Cerrar</button>
      </div>
    </div>
  `;

  const ctx2 = document.getElementById('chartAnalistaTienda');
  if (ctx2) {
    chartRef2 = new Chart(ctx2, {
      type: 'bar',
      data: {
        labels: ['OK', 'Con diferencia'],
        datasets: [{
          data: [a.conteosOk, a.conteosDiferencia],
          backgroundColor: ['#3E9C6E', '#D5573B'],
          borderRadius: 4
        }]
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ctx.label + ': ' + fmt(ctx.raw) } }
        },
        scales: { 
          y: { 
            beginAtZero: true, 
            ticks: { callback: v => fmt(v), font: { size: 10 } },
            grid: { display: false }
          },
          x: { grid: { display: false } }
        }
      },
      plugins: [{
        id: 'barLabelsInside',
        afterDraw(chart) {
          const ctx2 = chart.ctx;
          chart.data.datasets.forEach((dataset) => {
            const meta = chart.getDatasetMeta(0);
            meta.data.forEach((bar, index) => {
              const value = dataset.data[index];
              if (value === 0) return;
              const barHeight = bar.height || 30;
              const yPos = bar.y + (barHeight / 2) + 4;
              const xPos = bar.x;
              ctx2.fillStyle = '#FFFFFF';
              ctx2.font = 'bold 13px JetBrains Mono, monospace';
              ctx2.textAlign = 'center';
              ctx2.textBaseline = 'middle';
              ctx2.shadowColor = 'rgba(0,0,0,0.3)';
              ctx2.shadowBlur = 4;
              ctx2.fillText(fmt(value), xPos, yPos);
              ctx2.shadowBlur = 0;
            });
          });
        }
      }]
    });
  }

  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cerrarAnalistaDesplegado() {
  const container = document.getElementById('analistaExpandido');
  if (container) container.innerHTML = '';
  vistaActual.analistaDesplegado = null;
}

async function renderAnalista(nombre) {
  destroyChart();
  vistaActual = { tipo: 'analista', nombre: nombre, analistaDesplegado: null, tiendaFiltro: null };
  $('content').innerHTML = `<div class="loading-state"><div class="spinner"></div><div class="text">Cargando analista…</div></div>`;

  let a = null;
  if (modeloGlobal && modeloGlobal.analistas) {
    a = modeloGlobal.analistas.find(x => x.nombre === nombre);
  }
  if (!a) a = await api('analista', { nombre });

  if (a.error) {
    $('content').innerHTML = `<div class="empty-state">No se encontró el analista.</div>`;
    actualizarFiltros();
    return;
  }

  if (!a.activo) {
    $('content').innerHTML = `
      <div class="section-title">Analista · ${a.nombre}</div>
      <div class="card">
        <div class="detail-header">
          <h2>${a.nombre}</h2>
          <span class="badge off">Sin inventario activo</span>
        </div>
        <p class="empty-state">Este analista no está participando en ningún inventario activo actualmente.</p>
        <div class="stat-list">
          <div class="item"><div class="k">Tienda actual asignada</div><div class="v">${a.tiendaAsignada || 'No asignada'}</div></div>
        </div>
      </div>`;
    actualizarFiltros();
    return;
  }

  const datosGlobales = {
    codigosContados: a.codigosContados,
    piezasContadas: a.piezasContadas,
    conteosOk: a.conteosOk,
    conteosDiferencia: a.conteosDiferencia,
    promedioCodigosPorDia: a.promedioCodigosPorDia,
    diasActivos: a.diasActivos
  };

  const promedioPiezasPorDiaGlobal = calcularPromedioPiezasPorDia(a.piezasContadas, a.diasActivos || 1);
  const efectividadGlobal = calcularEfectividad(a.conteosOk, a.codigosContados);
  const colorEfectividadGlobal = getEfectividadColor(efectividadGlobal);

  let html = `
    <div class="section-title">Analista · ${a.nombre}</div>
    <div class="grid-2">
      <div class="card analista-card">
        <div class="detail-header">
          <h2>${a.nombre}</h2>
          <span class="badge on">Contando activamente</span>
        </div>
        <div class="stat-list">
          <div class="item"><div class="k">Códigos contados</div><div class="v" id="analistaCodigos">${fmt(a.codigosContados)}</div></div>
          <div class="item"><div class="k">Piezas contadas</div><div class="v" id="analistaPiezas">${fmt(a.piezasContadas)}</div></div>
          <div class="item"><div class="k">Sin diferencia (OK)</div><div class="v" id="analistaOk" style="color:var(--green);">${fmt(a.conteosOk)}</div></div>
          <div class="item"><div class="k">Con diferencia</div><div class="v" id="analistaDif" style="color:var(--red);">${fmt(a.conteosDiferencia)}</div></div>
          <div class="item"><div class="k" id="analistaDiasLabel">Días activos (total)</div><div class="v" id="analistaDiasTotal">${fmt(a.diasActivos)}</div></div>
          <div class="item"><div class="k">Promedio códigos / día</div><div class="v" id="analistaPromedio">${a.promedioCodigosPorDia.toFixed(2)}</div></div>
          <div class="item"><div class="k">Promedio códigos / tienda</div><div class="v">${a.promedioCodigosPorTienda.toFixed(2)}</div></div>
          <div class="item"><div class="k">📦 Promedio piezas / día</div><div class="v" id="analistaPromedioPiezas">${promedioPiezasPorDiaGlobal.toFixed(2)}</div></div>
          <div class="item"><div class="k">🎯 Efectividad</div><div class="v" id="analistaEfectividad" style="color:${colorEfectividadGlobal};">${efectividadGlobal.toFixed(1)}%</div></div>
          <div class="item"><div class="k">Tienda actual asignada</div><div class="v">${a.tiendaAsignada || 'No asignada'}</div></div>
        </div>
        <div style="margin-top:12px;font-size:12px;color:var(--muted);font-weight:600;">Tiendas donde ha contado (click para filtrar):</div>
        <div class="tag-list" id="tiendasAnalista">${a.tiendas.map(t => `
          <span class="tag clickable" data-tienda="${t.nombre}" data-analista="${a.nombre}">
            ${t.nombre}${t.actual ? ' <span class="actual">Actual</span>' : ''}
          </span>
        `).join('')}</div>
        <div class="filtro-info" id="filtroInfo">📌 Mostrando datos filtrados por: <span id="filtroNombre"></span></div>
      </div>
      <div class="card">
        <canvas id="chartAnalista"></canvas>
        <div style="text-align:center;margin-top:10px;">
          <button class="btn-back-bottom" id="btnResetAnalista" style="display:none;">← Ver datos globales</button>
        </div>
      </div>
    </div>
  `;

  $('content').innerHTML = html;

  const ctx = document.getElementById('chartAnalista');
  if (ctx) {
    chartRef = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['OK', 'Con diferencia'],
        datasets: [{
          data: [a.conteosOk, a.conteosDiferencia],
          backgroundColor: ['#3E9C6E', '#D5573B'],
          borderRadius: 4
        }]
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ctx.label + ': ' + fmt(ctx.raw) } }
        },
        scales: { 
          y: { beginAtZero: true, ticks: { callback: v => fmt(v), font: { size: 11 } } },
          x: { ticks: { font: { size: 12, weight: 'bold' } } }
        }
      },
      plugins: [{
        id: 'barLabelsInside',
        afterDraw(chart) {
          const ctx2 = chart.ctx;
          chart.data.datasets.forEach((dataset) => {
            const meta = chart.getDatasetMeta(0);
            meta.data.forEach((bar, index) => {
              const value = dataset.data[index];
              if (value === 0) return;
              const barHeight = bar.height || 30;
              const yPos = bar.y + (barHeight / 2) + 4;
              const xPos = bar.x;
              ctx2.fillStyle = '#FFFFFF';
              ctx2.font = 'bold 14px JetBrains Mono, monospace';
              ctx2.textAlign = 'center';
              ctx2.textBaseline = 'middle';
              ctx2.shadowColor = 'rgba(0,0,0,0.3)';
              ctx2.shadowBlur = 4;
              ctx2.fillText(fmt(value), xPos, yPos);
              ctx2.shadowBlur = 0;
            });
          });
        }
      }]
    });
  }

  document.querySelectorAll('[data-tienda]').forEach(el => {
    el.addEventListener('click', () => {
      const tienda = el.dataset.tienda;
      filtrarAnalistaPorTienda(a, tienda);
    });
  });

  const btnReset = document.getElementById('btnResetAnalista');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      vistaActual.tiendaFiltro = null;
      resetFiltroAnalista(a, datosGlobales);
    });
  }

  actualizarFiltros();
}

async function filtrarAnalistaPorTienda(a, tiendaNombre) {
  vistaActual.tiendaFiltro = tiendaNombre;
  
  const aFiltrado = await api('analista', { nombre: a.nombre, tienda: tiendaNombre });
  
  if (aFiltrado.error || aFiltrado.filtroActivo === false) {
    document.querySelectorAll('[data-tienda]').forEach(el => {
      el.classList.remove('filtrado');
      if (el.dataset.tienda === tiendaNombre) el.classList.add('filtrado');
    });
    const info = document.getElementById('filtroInfo');
    const nombreSpan = document.getElementById('filtroNombre');
    if (info && nombreSpan) {
      nombreSpan.textContent = tiendaNombre + ' (sin datos)';
      info.classList.add('visible');
    }
    const btnReset = document.getElementById('btnResetAnalista');
    if (btnReset) btnReset.style.display = 'inline-block';
    return;
  }

  const promedioPorDia = aFiltrado.promedioCodigosPorDia || (aFiltrado.codigosContados / (aFiltrado.diasActivos || 1));
  const promedioPiezasFiltrado = calcularPromedioPiezasPorDia(aFiltrado.piezasContadas, aFiltrado.diasActivos || 1);
  const efectividadFiltrado = calcularEfectividad(aFiltrado.conteosOk, aFiltrado.codigosContados);
  const colorEfectividad = getEfectividadColor(efectividadFiltrado);

  const codigosEl = document.getElementById('analistaCodigos');
  const piezasEl = document.getElementById('analistaPiezas');
  const okEl = document.getElementById('analistaOk');
  const difEl = document.getElementById('analistaDif');
  const promedioEl = document.getElementById('analistaPromedio');
  const diasEl = document.getElementById('analistaDiasTotal');
  const diasLabelEl = document.getElementById('analistaDiasLabel');
  const promedioPiezasEl = document.getElementById('analistaPromedioPiezas');
  const efectividadEl = document.getElementById('analistaEfectividad');
  
  if (codigosEl) codigosEl.textContent = fmt(aFiltrado.codigosContados);
  if (piezasEl) piezasEl.textContent = fmt(aFiltrado.piezasContadas);
  if (okEl) okEl.textContent = fmt(aFiltrado.conteosOk);
  if (difEl) difEl.textContent = fmt(aFiltrado.conteosDiferencia);
  if (promedioEl) promedioEl.textContent = promedioPorDia.toFixed(2);
  if (diasEl) diasEl.textContent = fmt(aFiltrado.diasActivos || 1);
  if (diasLabelEl) diasLabelEl.textContent = 'Días activos en ' + tiendaNombre;
  if (promedioPiezasEl) promedioPiezasEl.textContent = promedioPiezasFiltrado.toFixed(2);
  if (efectividadEl) {
    efectividadEl.textContent = efectividadFiltrado.toFixed(1) + '%';
    efectividadEl.style.color = colorEfectividad;
  }
  
  if (chartRef) {
    chartRef.data.datasets[0].data = [aFiltrado.conteosOk, aFiltrado.conteosDiferencia];
    chartRef.update();
  }
  
  document.querySelectorAll('[data-tienda]').forEach(el => {
    el.classList.remove('filtrado');
    if (el.dataset.tienda === tiendaNombre) el.classList.add('filtrado');
  });
  
  const info = document.getElementById('filtroInfo');
  const nombreSpan = document.getElementById('filtroNombre');
  if (info && nombreSpan) {
    nombreSpan.textContent = tiendaNombre + ` (${fmt(aFiltrado.codigosContados)} códigos, ${promedioPorDia.toFixed(2)}/día)`;
    info.classList.add('visible');
  }
  
  const btnReset = document.getElementById('btnResetAnalista');
  if (btnReset) btnReset.style.display = 'inline-block';
}

function resetFiltroAnalista(a, datosGlobales) {
  vistaActual.tiendaFiltro = null;
  
  const promedioPiezasGlobal = calcularPromedioPiezasPorDia(datosGlobales.piezasContadas, datosGlobales.diasActivos || 1);
  const efectividadGlobal = calcularEfectividad(datosGlobales.conteosOk, datosGlobales.codigosContados);
  const colorEfectividad = getEfectividadColor(efectividadGlobal);
  
  const codigosEl = document.getElementById('analistaCodigos');
  const piezasEl = document.getElementById('analistaPiezas');
  const okEl = document.getElementById('analistaOk');
  const difEl = document.getElementById('analistaDif');
  const promedioEl = document.getElementById('analistaPromedio');
  const diasEl = document.getElementById('analistaDiasTotal');
  const diasLabelEl = document.getElementById('analistaDiasLabel');
  const promedioPiezasEl = document.getElementById('analistaPromedioPiezas');
  const efectividadEl = document.getElementById('analistaEfectividad');
  
  if (codigosEl) codigosEl.textContent = fmt(datosGlobales.codigosContados);
  if (piezasEl) piezasEl.textContent = fmt(datosGlobales.piezasContadas);
  if (okEl) okEl.textContent = fmt(datosGlobales.conteosOk);
  if (difEl) difEl.textContent = fmt(datosGlobales.conteosDiferencia);
  if (promedioEl) promedioEl.textContent = datosGlobales.promedioCodigosPorDia.toFixed(2);
  if (diasEl) diasEl.textContent = fmt(datosGlobales.diasActivos);
  if (diasLabelEl) diasLabelEl.textContent = 'Días activos (total, todas las tiendas)';
  if (promedioPiezasEl) promedioPiezasEl.textContent = promedioPiezasGlobal.toFixed(2);
  if (efectividadEl) {
    efectividadEl.textContent = efectividadGlobal.toFixed(1) + '%';
    efectividadEl.style.color = colorEfectividad;
  }
  
  if (chartRef) {
    chartRef.data.datasets[0].data = [datosGlobales.conteosOk, datosGlobales.conteosDiferencia];
    chartRef.update();
  }
  
  document.querySelectorAll('[data-tienda]').forEach(el => el.classList.remove('filtrado'));
  
  const info = document.getElementById('filtroInfo');
  if (info) info.classList.remove('visible');
  
  const btnReset = document.getElementById('btnResetAnalista');
  if (btnReset) btnReset.style.display = 'none';
}

function actualizarFiltros() {
  const selT = $('selTienda');
  const selA = $('selAnalista');
  if (vistaActual.tipo === 'tienda') {
    selT.value = vistaActual.nombre;
    selA.value = '';
  } else if (vistaActual.tipo === 'analista') {
    selA.value = vistaActual.nombre;
    selT.value = '';
  } else {
    selT.value = '';
    selA.value = '';
  }
}

async function loadFiltros() {
  const m = await cargarModeloCompleto();
  const selT = $('selTienda'), selA = $('selAnalista');
  selT.innerHTML = '<option value="">Todas / vista general</option>';
  selA.innerHTML = '<option value="">Todos / vista general</option>';
  
  if (m.tiendas) {
    m.tiendas.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.nombre;
      opt.textContent = t.nombre + (t.activa ? '' : ' (inactiva)');
      selT.appendChild(opt);
    });
  }
  
  if (m.analistas) {
    m.analistas.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.nombre;
      opt.textContent = a.nombre + (a.activo ? '' : ' (sin inventario activo)');
      selA.appendChild(opt);
    });
  }
}

async function loadResumen() {
  const m = await cargarModeloCompleto();
  let r = m.resumen;
  if (!r && m.tiendas) {
    const activas = m.tiendas.filter(t => t.activa);
    r = {
      tiendasActivas: activas.length,
      analistasActivos: m.analistas ? m.analistas.filter(a => a.activo).length : 0,
      codigosContados: activas.reduce((s, t) => s + t.codigosContados, 0),
      piezasContadas: activas.reduce((s, t) => s + t.piezasContadas, 0),
      itemsConDiferencia: activas.reduce((s, t) => s + t.itemsConDiferencia, 0),
      itemsSinDiferencia: activas.reduce((s, t) => s + t.itemsSinDiferencia, 0),
      generadoEn: new Date().toISOString()
    };
  }
  if (r) {
    $('kTiendas').textContent = fmt(r.tiendasActivas);
    $('kAnalistas').textContent = fmt(r.analistasActivos);
    $('kCodigos').textContent = fmt(r.codigosContados);
    $('kPiezas').textContent = fmt(r.piezasContadas);
    $('kDif').textContent = fmt(r.itemsConDiferencia);
    $('kOk').textContent = fmt(r.itemsSinDiferencia);
    $('lastUpdate').textContent = 'Actualizado ' + new Date(r.generadoEn).toLocaleTimeString('es-VE');
  }
}

$('selTienda').addEventListener('change', async e => {
  if (e.target.value) {
    $('selAnalista').value = '';
    await renderTienda(e.target.value);
    document.querySelector('.wrap').scrollIntoView({ behavior: 'smooth' });
  } else {
    await renderVistaGeneral();
  }
});

$('selAnalista').addEventListener('change', async e => {
  if (e.target.value) {
    $('selTienda').value = '';
    await renderAnalista(e.target.value);
    document.querySelector('.wrap').scrollIntoView({ behavior: 'smooth' });
  } else {
    await renderVistaGeneral();
  }
});

$('btnClear').addEventListener('click', async () => {
  $('selTienda').value = '';
  $('selAnalista').value = '';
  await renderVistaGeneral();
});

// ==================== BOTÓN REFRESCAR ====================

$('btnRefresh').addEventListener('click', async function() {
  this.classList.add('spinning');
  modeloGlobal = null;
  showLoading();
  $('lastUpdate').textContent = 'Refrescando...';
  
  try {
    await cargarModeloCompleto();
    await Promise.all([loadResumen(), loadFiltros()]);
    
    if (vistaActual.tipo === 'tienda') {
      await renderTienda(vistaActual.nombre);
    } else if (vistaActual.tipo === 'analista') {
      await renderAnalista(vistaActual.nombre);
    } else {
      await renderVistaGeneral();
    }
    
    $('lastUpdate').textContent = '✅ Actualizado ' + new Date().toLocaleTimeString('es-VE');
  } catch (err) {
    console.error('Error al refrescar:', err);
    $('lastUpdate').textContent = '⚠️ Error al refrescar';
    $('content').innerHTML = `
      <div class="empty-state">
        ⚠️ Error al refrescar los datos. Intenta de nuevo.
        <br><small>${err.message}</small>
      </div>`;
  } finally {
    hideLoading();
    setTimeout(() => {
      this.classList.remove('spinning');
    }, 900);
  }
});

// ==================== RELOJ Y FECHA EN TIEMPO REAL ====================

function actualizarRelojYFecha() {
  const ahora = new Date();
  
  const dia = String(ahora.getDate()).padStart(2, '0');
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const anio = ahora.getFullYear();
  const fechaStr = dia + '/' + mes + '/' + anio;
  
  let horas = ahora.getHours();
  const minutos = String(ahora.getMinutes()).padStart(2, '0');
  const segundos = String(ahora.getSeconds()).padStart(2, '0');
  const ampm = horas >= 12 ? 'p.m.' : 'a.m.';
  
  horas = horas % 12;
  horas = horas ? horas : 12;
  
  const dateEl = document.getElementById('clockDate');
  const hEl = document.getElementById('clockHours');
  const mEl = document.getElementById('clockMinutes');
  const sEl = document.getElementById('clockSeconds');
  const ampmEl = document.getElementById('clockAmPm');
  
  if (dateEl) dateEl.textContent = fechaStr;
  if (hEl) hEl.textContent = String(horas);
  if (mEl) mEl.textContent = minutos;
  if (sEl) sEl.textContent = segundos;
  if (ampmEl) ampmEl.textContent = ampm;
}

// ==================== INICIO ====================

let dashboardYaIniciado = false;

async function iniciarDashboard(){
  if (dashboardYaIniciado) return;
  dashboardYaIniciado = true;

  actualizarRelojYFecha();
  setInterval(actualizarRelojYFecha, 1000);

  try {
    await cargarModeloCompleto();
    await Promise.all([loadResumen(), loadFiltros()]);
    await renderVistaGeneral();
  } catch (err) {
    console.error('Error en init:', err);
    $('content').innerHTML = `
      <div class="empty-state">
        ⚠️ Error al cargar los datos. Verifica tu conexión o recarga la página.
        <br><small>${err.message}</small>
      </div>`;
  }
  hideLoading();
}

// Footer hide/show on scroll and touch
(function(){
  const footer = document.querySelector('.footer');
  if(!footer) return;
  let lastScroll = window.scrollY || 0;
  let ticking = false;

  window.addEventListener('scroll', () => {
    const current = window.scrollY || 0;
    if (!ticking) {
      window.requestAnimationFrame(() => {
        if (current > lastScroll && current > 50) {
          footer.classList.add('hidden');
        } else {
          footer.classList.remove('hidden');
        }
        lastScroll = current;
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });

  // Mobile touch gestures: detect vertical swipe to hide/show footer
  let touchStartY = 0;
  window.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
  window.addEventListener('touchmove', e => {
    const currentY = e.touches[0].clientY;
    if (currentY < touchStartY - 10) footer.classList.add('hidden');
    if (currentY > touchStartY + 10) footer.classList.remove('hidden');
  }, { passive: true });

})();
