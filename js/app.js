/**
 * app.js — CARCOVE S.A.S.
 * Lógica principal del conductor:
 *  · Formulario + validación + Firestore
 *  · Generación de link de firma (GitHub Pages compatible)
 *  · PDF con jsPDF (incluye firma Base64)
 *  · Exportación Excel con SheetJS (12 columnas IDOM)
 *  · Historial con búsqueda y modal de detalle
 */

import { db } from "./firebase-config.js";
import {
  collection, addDoc, getDocs, getDoc, doc,
  orderBy, query, serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

/* ──────────────────────────────────────────────
   ESTADO GLOBAL
────────────────────────────────────────────── */
let viajesCache   = [];
let ultimoDato    = null;  // para PDF inmediato
let voucherActual = 1;

/* Centros de costos por empresa */
const CECOS = {
  IDOM:        ["IDOM-001 General","IDOM-002 Proyectos","IDOM-003 Consultoría","IDOM-004 Infraestructura"],
  EPM:         ["EPM-G01 Generación","EPM-T02 Transmisión","EPM-D03 Distribución","EPM-C04 Corporativo"],
  BANCOLOMBIA: ["BC-100 Banca Personal","BC-200 Banca Empresas","BC-300 Banca Corporativa","BC-400 TI"],
  ECOPETROL:   ["EC-OPE Operaciones","EC-EXP Exploración","EC-REF Refinación","EC-ADM Administrativo"],
  AVIANCA:     ["AV-OPS Operaciones","AV-MNT Mantenimiento","AV-COM Comercial"],
  NUTRESA:     ["NU-COM Comercial","NU-LOG Logística","NU-PRD Producción"],
  OTRA:        ["OTRO-GEN General","OTRO-PRY Proyecto","OTRO-ADM Administrativo"]
};

/* ──────────────────────────────────────────────
   HELPERS DE NÚMEROS A LETRAS (Español / COP)
────────────────────────────────────────────── */
const UNI  = ["","uno","dos","tres","cuatro","cinco","seis","siete","ocho","nueve",
              "diez","once","doce","trece","catorce","quince","dieciséis",
              "diecisiete","dieciocho","diecinueve"];
const DEC  = ["","","veinte","treinta","cuarenta","cincuenta",
              "sesenta","setenta","ochenta","noventa"];
const CENT = ["","ciento","doscientos","trescientos","cuatrocientos","quinientos",
              "seiscientos","setecientos","ochocientos","novecientos"];

function decLetras(n) {
  if (n < 20) return UNI[n];
  if (n < 30) return n === 20 ? "veinte" : "veinti" + UNI[n - 20];
  const d = Math.floor(n / 10), u = n % 10;
  return u === 0 ? DEC[d] : `${DEC[d]} y ${UNI[u]}`;
}
function centLetras(n) {
  if (n === 100) return "cien";
  if (n < 100)   return decLetras(n);
  const c = Math.floor(n / 100), r = n % 100;
  return r === 0 ? CENT[c] : `${CENT[c]} ${decLetras(r)}`;
}
export function numeroALetras(num) {
  const n = Math.floor(Math.abs(num));
  if (n === 0) return "cero";
  const B = Math.floor(n / 1e9);
  const M = Math.floor((n % 1e9) / 1e6);
  const K = Math.floor((n % 1e6) / 1e3);
  const R = n % 1e3;
  let r = "";
  if (B) r += (B === 1 ? "mil " : centLetras(B) + " mil ") + "millones ";
  if (M) r += M === 1 ? "un millón " : centLetras(M) + " millones ";
  if (K) r += K === 1 ? "mil " : centLetras(K) + " mil ";
  if (R) r += centLetras(R);
  const s = r.trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ──────────────────────────────────────────────
   NAVEGACIÓN DE TABS
────────────────────────────────────────────── */
export function switchTab(tab) {
  document.querySelectorAll(".nav-tab").forEach(t => {
    t.classList.remove("active");
    t.setAttribute("aria-selected", "false");
  });
  document.querySelectorAll(".panel").forEach(p => {
    p.classList.remove("active");
    p.style.display = "none";
  });
  const t = document.getElementById(`tab-${tab}`);
  const p = document.getElementById(`panel-${tab}`);
  if (t) { t.classList.add("active"); t.setAttribute("aria-selected","true"); }
  if (p) { p.style.display = "block"; p.classList.add("active"); }
  if (tab === "historial") cargarHistorial();
}

/* ──────────────────────────────────────────────
   FECHA / HORA / VOUCHER AUTOMÁTICOS
────────────────────────────────────────────── */
function setFechaAhora() {
  const el = document.getElementById("inp-fecha");
  if (!el) return;
  const now    = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  el.value     = new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

async function calcularVoucher() {
  try {
    const snap = await getDocs(collection(db, "vouchers"));
    const max  = snap.docs.reduce((m, d) => Math.max(m, parseInt(d.data().numeroVoucher) || 0), 0);
    voucherActual = max + 1;
  } catch { voucherActual = 1; }
  const code = "CCV-" + String(voucherActual).padStart(5, "0");
  const elInp = document.getElementById("inp-voucher");
  const elHdr = document.getElementById("header-voucher-num");
  if (elInp) elInp.value = code;
  if (elHdr) elHdr.textContent = code;
}

/* ──────────────────────────────────────────────
   CENTROS DE COSTOS DINÁMICOS
────────────────────────────────────────────── */
export function actualizarCecos() {
  const emp = document.getElementById("sel-empresa")?.value ?? "";
  const rowCustom = document.getElementById("row-empresa-custom");
  if (rowCustom) rowCustom.style.display = emp === "OTRA" ? "block" : "none";
  const sel = document.getElementById("sel-ceco");
  if (!sel) return;
  sel.innerHTML = '<option value="">— Seleccionar CeCo —</option>';
  (CECOS[emp] || []).forEach(cc => {
    const o = document.createElement("option");
    o.value = cc; o.textContent = cc;
    sel.appendChild(o);
  });
  const otro = document.createElement("option");
  otro.value = "OTRO"; otro.textContent = "Otro / No aplica";
  sel.appendChild(otro);
}

/* ──────────────────────────────────────────────
   FORMATEO DE MILES EN INPUT
────────────────────────────────────────────── */
export function formatearValor(input) {
  let valor = input.value.replace(/\D/g, "");
  if (valor !== "") {
    valor = parseInt(valor, 10).toLocaleString("es-CO");
  }
  input.value = valor;
}

/* ──────────────────────────────────────────────
   ACTUALIZAR LETRAS EN TIEMPO REAL
────────────────────────────────────────────── */
export function actualizarLetras() {
  const strVal = document.getElementById("inp-valor")?.value || "";
  const val = parseFloat(strVal.replace(/\D/g, "")) || 0;
  const el  = document.getElementById("letras-display");
  if (!el) return;
  if (val <= 0) { el.innerHTML = '<span class="lbl">Letras:</span> —'; return; }
  el.innerHTML = `<span class="lbl">Letras:</span> ${numeroALetras(val)} pesos m/l`;
}

/* ──────────────────────────────────────────────
   LIMPIAR FORMULARIO
────────────────────────────────────────────── */
export function limpiarFormulario(resetVoucher = true) {
  ["sel-empresa","sel-tipo","sel-ceco"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  ["inp-empresa-custom","inp-pasajero","inp-cedula","inp-salida",
   "inp-destino","inp-valor","inp-observaciones"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const rowCustom = document.getElementById("row-empresa-custom");
  if (rowCustom) rowCustom.style.display = "none";
  const sel = document.getElementById("sel-ceco");
  if (sel) sel.innerHTML = '<option value="">— Seleccionar CeCo —</option>';
  const letrasEl = document.getElementById("letras-display");
  if (letrasEl) letrasEl.innerHTML = '<span class="lbl">Letras:</span> —';
  const shareBox = document.getElementById("share-box-wrap");
  if (shareBox) shareBox.style.display = "none";
  setFechaAhora();
  if (resetVoucher) calcularVoucher();
}

/* ──────────────────────────────────────────────
   GUARDAR VOUCHER EN FIRESTORE
────────────────────────────────────────────── */
export async function guardarVoucher() {
  const empresa      = document.getElementById("sel-empresa")?.value ?? "";
  const empresaCustom= (document.getElementById("inp-empresa-custom")?.value ?? "").trim();
  const ceco         = document.getElementById("sel-ceco")?.value ?? "";
  const tipo         = document.getElementById("sel-tipo")?.value ?? "";
  const pasajero     = (document.getElementById("inp-pasajero")?.value ?? "").trim();
  const cedula       = (document.getElementById("inp-cedula")?.value ?? "").trim();
  const salida       = (document.getElementById("inp-salida")?.value ?? "").trim();
  const destino      = (document.getElementById("inp-destino")?.value ?? "").trim();
  const valor        = parseFloat((document.getElementById("inp-valor")?.value || "").replace(/\D/g, "")) || 0;
  const obs          = (document.getElementById("inp-observaciones")?.value ?? "").trim();
  const fechaRaw     = document.getElementById("inp-fecha")?.value ?? "";
  const voucher      = document.getElementById("inp-voucher")?.value ?? "";

  /* Validaciones */
  if (!empresa)                       return toast("Selecciona la empresa contratante", "error");
  if (empresa === "OTRA" && !empresaCustom) return toast("Ingresa el nombre de la empresa", "error");
  if (!ceco)                          return toast("Selecciona el Centro de Costos", "error");
  if (!tipo)                          return toast("Selecciona el tipo de servicio", "error");
  if (!pasajero)                      return toast("Ingresa el nombre del funcionario", "error");
  if (!salida)                        return toast("Ingresa el lugar de salida", "error");
  if (!destino)                       return toast("Ingresa el lugar de destino", "error");
  if (valor <= 0)                     return toast("Ingresa un valor de servicio válido", "error");

  const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                 "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const fObj  = fechaRaw ? new Date(fechaRaw) : new Date();
  const letrasValor = document.getElementById("letras-display")?.textContent
                        .replace("Letras: ","").trim() || numeroALetras(valor) + " pesos m/l";

  const datos = {
    numeroVoucher: voucherActual,
    codigoVoucher: voucher,
    fecha:         fechaRaw,
    mes:           MESES[fObj.getMonth()],
    empresa:       empresa === "OTRA" ? empresaCustom : empresa,
    centroCostos:  ceco,
    tipoServicio:  tipo,
    pasajero,
    cedula,
    lugarSalida:   salida,
    lugarDestino:  destino,
    valor,
    valorLetras:   letrasValor,
    observaciones: obs,
    firma:         null,
    firmado:       false,
    creadoEn:      serverTimestamp()
  };

  mostrarLoading("Guardando en Firestore…");
  const btn = document.getElementById("btn-guardar");
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Guardando…'; }

  try {
    const docRef = await addDoc(collection(db, "vouchers"), datos);
    toast("✅ Voucher guardado correctamente", "success");
    ultimoDato = { ...datos, id: docRef.id };

    /* Generar link de firma compatible con GitHub Pages */
    const firmaUrl = generarUrlFirma(docRef.id);
    mostrarShareBox(firmaUrl, docRef.id);

    viajesCache = [];
    await calcularVoucher();
    limpiarFormulario(false);

    /* PDF automático */
    setTimeout(() => generarPDF(ultimoDato), 800);

  } catch (err) {
    console.error(err);
    toast("Error al guardar: " + err.message, "error");
  } finally {
    ocultarLoading();
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
          <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
        </svg> Guardar y Generar PDF`;
    }
  }
}

/* ──────────────────────────────────────────────
   URL DE FIRMA — GitHub Pages compatible
────────────────────────────────────────────── */
function generarUrlFirma(docId) {
  // Funciona en: localhost, file://, GitHub Pages, cualquier hosting estático
  const origin   = window.location.origin;
  // pathname puede ser "/mi-repo/index.html" → tomamos el directorio base
  const dir      = window.location.pathname.replace(/\/[^/]*$/, "");
  return `${origin}${dir}/firma.html?id=${docId}`;
}

function mostrarShareBox(url, docId) {
  const wrap = document.getElementById("share-box-wrap");
  const link = document.getElementById("share-link-text");
  const btnWA = document.getElementById("btn-whatsapp");
  const btnCopy = document.getElementById("btn-copy-link");
  if (!wrap) return;
  if (link)   link.textContent = url;
  if (btnWA)  btnWA.onclick    = () => window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent("🚗 CARCOVE S.A.S. — Por favor firma tu voucher de transporte aquí:\n" + url)}`, "_blank");
  if (btnCopy) btnCopy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copiado al portapapeles 📋", "info");
    } catch { toast("No se pudo copiar: " + url, "warning"); }
  };
  wrap.style.display = "block";
  wrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ──────────────────────────────────────────────
   HISTORIAL
────────────────────────────────────────────── */
export async function cargarHistorial() {
  const list = document.getElementById("historial-list");
  if (!list) return;
  list.innerHTML = `<div style="text-align:center;padding:28px;color:var(--gray-400);">
    <div class="loading-ring" style="width:32px;height:32px;border-width:3px;margin:0 auto 12px;"></div>
    <p style="font-size:13px;">Cargando registros…</p></div>`;
  try {
    const q    = query(collection(db, "vouchers"), orderBy("creadoEn", "desc"));
    const snap = await getDocs(q);
    viajesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderHistorial(viajesCache);
    actualizarStats(viajesCache);
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><p style="color:var(--error-color,#c0392b)">Error: ${err.message}</p></div>`;
  }
}

function actualizarStats(v) {
  const total = v.length;
  const suma  = v.reduce((s, x) => s + (x.valor || 0), 0);
  const firmados = v.filter(x => x.firmado).length;
  const statTotal  = document.getElementById("stat-total");
  const statValor  = document.getElementById("stat-valor");
  const statFirmas = document.getElementById("stat-firmas");
  if (statTotal)  statTotal.textContent  = total;
  if (statValor)  statValor.textContent  = "$" + suma.toLocaleString("es-CO");
  if (statFirmas) statFirmas.textContent = `${firmados}/${total}`;
}

function renderHistorial(viajes) {
  const list = document.getElementById("historial-list");
  if (!list) return;
  if (!viajes.length) {
    list.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <h3>Sin registros</h3><p>Los vouchers guardados aparecerán aquí.</p></div>`;
    return;
  }
  list.innerHTML = viajes.map(v => {
    const fecha  = v.fecha ? new Date(v.fecha).toLocaleDateString("es-CO",{day:"2-digit",month:"short",year:"numeric"}) : "—";
    const tipoCls= (v.tipoServicio||"").includes("Aeropuerto") ? "tipo-aero" : "tipo-otro";
    const valor  = (v.valor||0).toLocaleString("es-CO");
    const firmBadge = v.firmado
      ? '<span class="vc-firma-badge firmado">✅ Firmado</span>'
      : '<span class="vc-firma-badge pendiente">⏳ Sin firma</span>';
    return `
      <div class="viaje-card" role="button" tabindex="0"
           onclick="window.__abrirDetalle('${v.id}')"
           onkeydown="if(event.key==='Enter')window.__abrirDetalle('${v.id}')">
        <div class="vc-head">
          <span class="vc-voucher">${v.codigoVoucher||"—"}</span>
          <span class="vc-fecha">${fecha}</span>
        </div>
        <div class="vc-pasajero">${v.pasajero||"—"} ${v.cedula ? `<small style="color:var(--gray-400);font-weight:500;">C.C. ${v.cedula}</small>` : ""}</div>
        <div class="vc-ruta">📍 ${v.lugarSalida||"—"} → ${v.lugarDestino||"—"}</div>
        <div class="vc-foot">
          <span class="vc-tipo ${tipoCls}">${v.tipoServicio||"—"}</span>
          <div style="display:flex;align-items:center;gap:8px;">
            ${firmBadge}
            <span style="font-size:13px;font-weight:800;color:var(--success)">$${valor}</span>
          </div>
        </div>
      </div>`;
  }).join("");
}

export function filtrarViajes() {
  const q = (document.getElementById("inp-buscar")?.value || "").toLowerCase();
  const f = viajesCache.filter(v =>
    [v.pasajero, v.codigoVoucher, v.empresa, v.lugarSalida, v.lugarDestino, v.cedula]
      .some(x => (x || "").toLowerCase().includes(q))
  );
  renderHistorial(f);
  actualizarStats(f);
}

/* ──────────────────────────────────────────────
   MODAL DETALLE
────────────────────────────────────────────── */
async function abrirDetalle(id) {
  // Busca en cache primero, luego Firestore
  let v = viajesCache.find(x => x.id === id);
  if (!v) {
    try {
      const snap = await getDoc(doc(db, "vouchers", id));
      if (snap.exists()) v = { id: snap.id, ...snap.data() };
    } catch(e) { toast("Error al cargar detalle: " + e.message, "error"); return; }
  }
  if (!v) return toast("Voucher no encontrado", "error");

  const fecha  = v.fecha ? new Date(v.fecha).toLocaleString("es-CO",{dateStyle:"long",timeStyle:"short"}) : "—";
  const valor  = (v.valor||0).toLocaleString("es-CO");
  const firmaUrl = generarUrlFirma(v.id);

  const body = document.getElementById("modal-detalle-body");
  const title = document.getElementById("modal-detalle-title");
  if (title) title.textContent = `Voucher ${v.codigoVoucher || ""}`;
  if (body) body.innerHTML = `
    <div>
      ${fila("Empresa",       v.empresa)}
      ${fila("CeCo",          v.centroCostos)}
      ${fila("Tipo",          v.tipoServicio)}
      ${fila("Funcionario",   v.pasajero)}
      ${fila("Cédula",        v.cedula||"—")}
      ${fila("Fecha",         fecha)}
      ${fila("Salida",        v.lugarSalida)}
      ${fila("Destino",       v.lugarDestino)}
      ${fila("Valor",         "$ " + valor + " COP")}
      ${fila("En letras",     v.valorLetras||"—")}
      ${fila("Estado firma",  v.firmado ? "✅ Firmado" : "⏳ Pendiente")}
      ${v.observaciones ? fila("Observaciones", v.observaciones) : ""}
    </div>
    ${v.firma ? `<div style="margin:14px 0;"><p style="font-size:11px;color:var(--gray-400);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Firma del pasajero</p><img src="${v.firma}" class="firma-preview" alt="Firma"/></div>` : ""}
    <div style="background:var(--gray-100);border-radius:var(--radius-sm);padding:10px 12px;margin-bottom:14px;">
      <p style="font-size:10px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Link de firma</p>
      <p style="font-size:11px;color:var(--gray-600);word-break:break-all;">${firmaUrl}</p>
    </div>
    <div class="btn-row">
      <div class="btn-row-2">
        <button class="btn btn-primary btn-sm" id="btn-pdf-modal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Descargar PDF
        </button>
        <button class="btn btn-info btn-sm" id="btn-wa-modal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          WhatsApp
        </button>
      </div>
    </div>`;

  document.getElementById("btn-pdf-modal")?.addEventListener("click", () => {
    generarPDF(v);
    cerrarModal("modal-detalle");
  });
  document.getElementById("btn-wa-modal")?.addEventListener("click", () => {
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent("🚗 CARCOVE S.A.S. — Firma tu voucher aquí:\n" + firmaUrl)}`, "_blank");
  });

  abrirModal("modal-detalle");
}

// Exposición al DOM (workaround para onclick en innerHTML)
window.__abrirDetalle = abrirDetalle;

function fila(k, v) {
  return `<div class="detail-row"><span class="dk">${k}</span><span class="dv">${v||"—"}</span></div>`;
}

/* ──────────────────────────────────────────────
   MODAL helpers
────────────────────────────────────────────── */
function abrirModal(id) { document.getElementById(id)?.classList.add("open"); }
export function cerrarModal(id) { document.getElementById(id)?.classList.remove("open"); }

/* ──────────────────────────────────────────────
   GENERAR RECIBO DE CAJA DESDE EL FORMULARIO
────────────────────────────────────────────── */
export function generarReciboDesdeFormulario() {
  const empresa      = document.getElementById("sel-empresa")?.value ?? "";
  const empresaCustom= (document.getElementById("inp-empresa-custom")?.value ?? "").trim();
  const pasajero     = (document.getElementById("inp-pasajero")?.value ?? "").trim();
  const salida       = (document.getElementById("inp-salida")?.value ?? "").trim();
  const destino      = (document.getElementById("inp-destino")?.value ?? "").trim();
  const valor        = parseFloat((document.getElementById("inp-valor")?.value || "").replace(/\D/g, "")) || 0;
  const fechaRaw     = document.getElementById("inp-fecha")?.value ?? "";
  
  if (!pasajero || !salida || !destino || valor <= 0) {
    return toast("Para generar el recibo, completa al menos: Funcionario, Salida, Destino y Valor.", "warning");
  }

  const fObj  = fechaRaw ? new Date(fechaRaw) : new Date();
  const letrasValor = document.getElementById("letras-display")?.textContent
                        .replace("Letras: ","").trim() || numeroALetras(valor) + " pesos m/l";

  const datosRecibo = {
    numeroVoucher: voucherActual,
    fecha:         fObj,
    empresa:       empresa === "OTRA" ? empresaCustom : empresa,
    pasajero,
    ruta:          `${salida} - ${destino}`,
    valor,
    valorLetras:   letrasValor
  };

  generarReciboCajaPDF(datosRecibo);
}

/* ──────────────────────────────────────────────
   DIBUJAR EL PDF DEL RECIBO DE CAJA
────────────────────────────────────────────── */
export function generarReciboCajaPDF(datos) {
  if (!window.jspdf) return toast("jsPDF no está cargado aún, intenta en un momento", "warning");
  const { jsPDF } = window.jspdf;
  // Recibo apaisado (landscape) tamaño media carta aprox (A5 landscape es muy similar)
  const doc = new jsPDF({ unit: "mm", format: "a5", orientation: "landscape" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  // Bordes generales del recibo
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.4);
  doc.rect(5, 5, W - 10, H - 10);

  // Encabezado Izquierda
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(0, 51, 102); // Azul oscuro
  doc.text("CARLOS ARTURO CONGOTE VELASQUEZ", 10, 15);
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text("RÉGIMEN SIMPLIFICADO", 10, 21);
  doc.text("RUT: 98.553.451-8", 10, 26);
  doc.text("Celulares: 310 517 95 02 / 300 616 36 59", 10, 31);
  doc.text("Correo: carcove4@hotmail.com", 10, 36);

  // Encabezado Derecha
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("RECIBO DE CAJA", W - 10, 18, { align: "right" });
  
  doc.setTextColor(200, 0, 0); // Rojo
  doc.setFontSize(12);
  doc.text(`Nº ${datos.numeroVoucher || "—"}`, W - 10, 25, { align: "right" });
  doc.setTextColor(0, 0, 0);

  // Línea separadora encabezado
  doc.setLineWidth(0.3);
  doc.line(5, 42, W - 5, 42);

  // Datos del Servicio
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Fecha:", 10, 50);
  doc.text("Empresa:", 10, 57);
  doc.text("Usuario:", 10, 64);

  doc.setFont("helvetica", "normal");
  const fechaFmt = datos.fecha ? datos.fecha.toLocaleDateString("es-CO", { day:"2-digit", month:"long", year:"numeric" }) : "—";
  doc.text(fechaFmt, 30, 50);
  doc.text(datos.empresa || "—", 30, 57);
  doc.text(datos.pasajero || "—", 30, 64);

  // Tabla Central
  const yTabla = 72;
  doc.setLineWidth(0.3);
  doc.rect(10, yTabla, W - 20, 25); // Contenedor de tabla
  doc.line(10, yTabla + 7, W - 10, yTabla + 7); // Separador de header
  doc.line(W - 45, yTabla, W - 45, yTabla + 25); // Separador de columna valor

  doc.setFont("helvetica", "bold");
  doc.text("DESCRIPCIÓN", 12, yTabla + 5);
  doc.text("VALOR", W - 43, yTabla + 5);

  doc.setFont("helvetica", "normal");
  const rutaLines = doc.splitTextToSize(datos.ruta || "—", W - 60);
  doc.text(rutaLines, 12, yTabla + 12);
  
  doc.text("$ " + (datos.valor || 0).toLocaleString("es-CO"), W - 43, yTabla + 12);

  // Pie del Recibo
  const yPie = 105;
  doc.setFont("helvetica", "bold");
  doc.text("LA SUMA DE:", 10, yPie);
  doc.text("TOTAL $", W - 45, yPie);

  doc.setFont("helvetica", "normal");
  doc.text((datos.valor || 0).toLocaleString("es-CO"), W - 10, yPie, { align: "right" });
  
  const letrasLines = doc.splitTextToSize(datos.valorLetras || "—", W - 60);
  doc.text(letrasLines, 35, yPie);

  // Firma
  doc.setLineWidth(0.3);
  doc.line(10, H - 15, 70, H - 15);
  doc.setFont("helvetica", "bold");
  doc.text("FIRMA", 10, H - 10);

  const nombre = `ReciboCaja_CCV${datos.numeroVoucher || ""}_${(datos.pasajero || "Pasajero").split(" ")[0]}.pdf`;
  doc.save(nombre);
  toast("📄 Recibo de Caja generado: " + nombre, "success");
}

/* ──────────────────────────────────────────────
   GENERAR PDF (jsPDF) — incluye firma Base64
────────────────────────────────────────────── */
export function generarPDF(datos) {
  if (!window.jspdf) return toast("jsPDF no está cargado aún, intenta en un momento", "warning");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a5", orientation: "portrait" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  const ROJO  = [163, 0, 0];
  const GRIS  = [39, 39, 47];
  const MGRIS = [105, 105, 118];
  const LGRIS = [238, 238, 242];
  const BLANC = [255, 255, 255];

  /* ---- Cabecera ---- */
  doc.setFillColor(...ROJO);
  doc.rect(0, 0, W, 35, "F");

  // ===== LOGO DEL PDF =====
  try {
    const logoUrl = "assets/Logotipo minimalista CARCOVE en rojo y negro.png"; 
    doc.addImage(logoUrl, "PNG", 10, 5, 90, 20);
  } catch (e) {
    console.warn("No se pudo cargar el logo:", e);
    // fallback si falla
    doc.setFillColor(255, 255, 255, 0.12);
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(0.5);
    doc.circle(15, 16, 8, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...BLANC);
    doc.text("CC", 15, 18, { align: "center" });
  }

  // Nombre empresa (comentado)
  // doc.setFontSize(13);
  // doc.text("CARCOVE S.A.S.", 28, 12);

  // Badge voucher
  doc.setFillColor(255, 255, 255, 0.18);
  doc.roundedRect(W - 46, 5, 42, 15, 3, 3, "F");
  doc.setFontSize(6.5);
  doc.setFont("helvetica", "normal");
  doc.text("VOUCHER", W - 25, 10.5, { align: "center" });
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(datos.codigoVoucher || "—", W - 25, 17, { align: "center" });


  /* ---- Cuerpo ---- */
  let y = 41;

  function linea() {
    doc.setDrawColor(...LGRIS); doc.setLineWidth(0.25);
    doc.line(8, y, W - 8, y); y += 4;
  }

  function campo(label, value, negrita = false) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(6.5); doc.setTextColor(...MGRIS);
    doc.text(label.toUpperCase(), 10, y);
    doc.setFont("helvetica", negrita ? "bold" : "normal");
    doc.setFontSize(9); doc.setTextColor(...GRIS);
    const lines = doc.splitTextToSize(String(value || "—"), W - 22);
    doc.text(lines, 10, y + 4.5);
    y += 6 + lines.length * 4.5;
  }

  function seccion(titulo) {
    doc.setFillColor(...LGRIS); doc.rect(0, y - 1, W, 8, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...ROJO);
    doc.text(titulo, 10, y + 4.5); y += 11;
  }

  /* Fila fecha/tipo */
  const fechaFmt = datos.fecha
    ? new Date(datos.fecha).toLocaleString("es-CO", { dateStyle: "long", timeStyle: "short" })
    : "—";
  doc.setFillColor(...LGRIS); doc.roundedRect(8, y, W - 16, 16, 2, 2, "F");
  doc.setFont("helvetica","bold"); doc.setFontSize(6.5); doc.setTextColor(...MGRIS);
  doc.text("FECHA Y HORA", 12, y + 5);
  doc.text("TIPO DE SERVICIO", W / 2 + 2, y + 5);
  doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...GRIS);
  doc.text(fechaFmt, 12, y + 11.5);
  doc.setFont("helvetica","bold"); doc.setTextColor(...ROJO);
  doc.text(datos.tipoServicio || "—", W / 2 + 2, y + 11.5);
  y += 22;

  seccion("EMPRESA CONTRATANTE");
  campo("Empresa", datos.empresa);
  campo("Centro de Costos / N.° Encargo", datos.centroCostos);
  linea();

  seccion("FUNCIONARIO / PASAJERO");
  campo("Nombre completo", datos.pasajero, true);
  if (datos.cedula) campo("Cédula de ciudadanía", datos.cedula);
  linea();

  seccion("RUTA DEL SERVICIO");
  campo("Lugar de salida", datos.lugarSalida);
  campo("Lugar de destino / Recorrido", datos.lugarDestino);
  if (datos.observaciones) campo("Observaciones", datos.observaciones);
  linea();

  /* Valor */
  doc.setFillColor(...ROJO); doc.roundedRect(8, y, W - 16, 24, 2, 2, "F");
  doc.setFont("helvetica","bold"); doc.setFontSize(6.5); doc.setTextColor(255,255,255,0.68);
  doc.text("VALOR DEL SERVICIO", 12, y + 6);
  doc.setFontSize(14); doc.setTextColor(...BLANC);
  doc.text("$ " + (datos.valor || 0).toLocaleString("es-CO"), 12, y + 14);
  doc.setFontSize(7); doc.setFont("helvetica","italic"); doc.setTextColor(255,255,255,0.85);
  const letLines = doc.splitTextToSize(datos.valorLetras || "—", W - 30);
  doc.text(letLines, 12, y + 20);
  y += 30;

  /* Firma del pasajero */
  if (datos.firma) {
    if (y > H - 55) { doc.addPage(); y = 15; }
    doc.setFillColor(...LGRIS); doc.rect(0, y - 1, W, 8, "F");
    doc.setFont("helvetica","bold"); doc.setFontSize(7.5); doc.setTextColor(...ROJO);
    doc.text("FIRMA DEL PASAJERO", 10, y + 4.5); y += 10;
    try {
      // Dibujar la firma centrada
      doc.addImage(datos.firma, "PNG", W/2 - 35, y, 70, 35);
      y += 40;
    } catch(_) {}
  } else {
    /* Firmas manuales (solo si no hay firma digital) */
    y = Math.max(y, H - 52);
    doc.setDrawColor(...LGRIS); doc.setLineWidth(0.25);
    doc.line(10, y + 16, 62, y + 16);
    doc.line(W - 62, y + 16, W - 10, y + 16);
    doc.setFont("helvetica","normal"); doc.setFontSize(6.5); doc.setTextColor(...MGRIS);
    doc.text("Firma del Conductor", 36, y + 20, { align: "center" });
    doc.text("Firma del Funcionario / Pasajero", W - 36, y + 20, { align: "center" });
  }

  /* Pie de página */
  doc.setFillColor(...ROJO); doc.rect(0, H - 21, W, 21, "F");
  doc.setFont("helvetica","italic"); doc.setFontSize(5.5); doc.setTextColor(...BLANC);
  const pie = "CARCOVE S.A.S. está comprometida con la Ley 679 de 2001 y rechaza rotundamente la explotación, la pornografía y el turismo sexual con niños, niñas y adolescentes en Colombia.";
  const pLines = doc.splitTextToSize(pie, W - 14);
  doc.text(pLines, W / 2, H - 14, { align: "center" });
  doc.setFontSize(6); doc.setFont("helvetica","normal");
  doc.text("www.carcove.co  ·  Generado: " + new Date().toLocaleString("es-CO"), W / 2, H - 5, { align: "center" });

  const nombre = `Voucher_${datos.codigoVoucher || "CCV"}_${(datos.pasajero || "Pasajero").split(" ")[0]}.pdf`;
  doc.save(nombre);
  toast("📄 PDF descargado: " + nombre, "success");
}

/* ──────────────────────────────────────────────
   EXPORTAR EXCEL — 12 columnas IDOM exactas
────────────────────────────────────────────── */
export async function exportarExcel() {
  if (!window.XLSX) return toast("SheetJS no está cargado", "warning");
  mostrarLoading("Preparando planilla Excel…");
  try {
    let datos = viajesCache;
    if (!datos.length) {
      const snap = await getDocs(collection(db, "vouchers"));
      datos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      viajesCache = datos;
    }
    const mes = document.getElementById("exp-mes")?.value;
    if (mes) datos = datos.filter(v => (v.fecha || "").startsWith(mes));
    if (!datos.length) {
      ocultarLoading();
      return toast("No hay registros para el período seleccionado", "warning");
    }

    const COLS = [
      "Mes","Fecha Servicio","No. Soporte","Hora de Servicio",
      "Lugar de Salida","Lugar de Llegada","Ida y Vuelta","No. De Paradas",
      "Valor","Nombre Funcionario","No. Encargo/CeCo","Observaciones"
    ];

    const filas = datos.map(v => {
      const fo   = v.fecha ? new Date(v.fecha) : null;
      return {
        "Mes":               v.mes || "",
        "Fecha Servicio":    fo ? fo.toLocaleDateString("es-CO") : "",
        "No. Soporte":       v.codigoVoucher || "",
        "Hora de Servicio":  fo ? fo.toLocaleTimeString("es-CO",{hour:"2-digit",minute:"2-digit"}) : "",
        "Lugar de Salida":   v.lugarSalida  || "",
        "Lugar de Llegada":  v.lugarDestino || "",
        "Ida y Vuelta":      "",
        "No. De Paradas":    "",
        "Valor":             v.valor || 0,
        "Nombre Funcionario":v.pasajero     || "",
        "No. Encargo/CeCo":  v.centroCostos || "",
        "Observaciones":     v.observaciones|| ""
      };
    });

    const wb  = XLSX.utils.book_new();
    const ws  = XLSX.utils.json_to_sheet(filas, { header: COLS });
    ws["!cols"] = [
      {wch:12},{wch:15},{wch:13},{wch:16},
      {wch:27},{wch:27},{wch:12},{wch:14},
      {wch:14},{wch:28},{wch:22},{wch:32}
    ];
    XLSX.utils.book_append_sheet(wb, ws, "Planilla IDOM");

    /* Hoja de resumen */
    const wsR = XLSX.utils.aoa_to_sheet([
      ["REPORTE DE SERVICIOS - CARCOVE S.A.S."],
      ["NIT:", "901.370.095-4"],
      ["R.N.T.:", "57814"],
      ["Fecha generación:", new Date().toLocaleString("es-CO")],
      ["Total registros:", filas.length],
      ["Total valor COP:", filas.reduce((s,f) => s + (f["Valor"]||0), 0)],
      [],
      ["AVISO LEGAL:"],
      ["CARCOVE S.A.S. está comprometida con la Ley 679 de 2001 y rechaza rotundamente la explotación,"],
      ["la pornografía y el turismo sexual con niños, niñas y adolescentes en Colombia."]
    ]);
    wsR["!cols"] = [{wch:32},{wch:54}];
    XLSX.utils.book_append_sheet(wb, wsR, "Resumen");

    const archivo = `CARCOVE_Planilla_IDOM${mes ? "_" + mes : ""}_${Date.now()}.xlsx`;
    XLSX.writeFile(wb, archivo);
    toast("📊 Planilla Excel descargada correctamente", "success");
  } catch (err) {
    console.error(err);
    toast("Error al exportar: " + err.message, "error");
  } finally { ocultarLoading(); }
}

/* ──────────────────────────────────────────────
   PDF DEL ÚLTIMO VOUCHER
────────────────────────────────────────────── */
export function regenerarPDF() {
  if (ultimoDato) { generarPDF(ultimoDato); return; }
  if (viajesCache.length) { generarPDF(viajesCache[0]); return; }
  toast("No hay vouchers recientes para regenerar", "warning");
}

/* ──────────────────────────────────────────────
   UI HELPERS
────────────────────────────────────────────── */
export function mostrarLoading(msg = "Procesando…") {
  const el = document.getElementById("loading-overlay");
  const tx = document.getElementById("loading-msg");
  if (tx) tx.textContent = msg;
  if (el) el.classList.add("show");
}
export function ocultarLoading() {
  document.getElementById("loading-overlay")?.classList.remove("show");
}

export function toast(msg, tipo = "info") {
  const container = document.getElementById("toast-container");
  if (!container) { console.warn(msg); return; }
  const ICONS = {
    success: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    error:   `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    warning: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info:    `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
  };
  const el = document.createElement("div");
  el.className = `toast toast-${tipo}`;
  el.innerHTML = `${ICONS[tipo] || ICONS.info}<div class="toast-msg">${msg}</div>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add("exit");
    el.addEventListener("animationend", () => el.remove());
  }, 4500);
}

/* ──────────────────────────────────────────────
   INIT
────────────────────────────────────────────── */
async function init() {
  setFechaAhora();
  await calcularVoucher();
  setInterval(setFechaAhora, 30_000);
}

init().catch(console.error);
