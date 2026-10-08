/**
 * firma.js — CARCOVE S.A.S.
 * Módulo de firma digital del pasajero.
 *
 * Flujo:
 *  1. Lee el ?id= de la URL para identificar el viaje en Firestore.
 *  2. Carga y muestra los datos del viaje (SIN mostrar el precio).
 *  3. Renderiza un <canvas> HTML5 para que el pasajero dibuje su firma.
 *  4. Guarda la firma como Base64 en Firestore (updateDoc).
 */

import { db } from "./firebase-config.js";
import {
  doc, getDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

/* ── Estado ── */
let viajeData    = null;
let viajeId      = null;
let firmaDibujada = false;

/* ── Canvas ── */
let canvas, ctx;
let drawing = false;
let lastX   = 0;
let lastY   = 0;

/* ──────────────────────────────────────────────
   INIT — arrancar cuando el DOM esté listo
────────────────────────────────────────────── */
async function init() {
  const params  = new URLSearchParams(window.location.search);
  viajeId       = params.get("id");

  if (!viajeId) {
    mostrarError("No se proporcionó un ID de viaje en la URL.");
    return;
  }

  mostrarEstadoCarga();

  try {
    const snap = await getDoc(doc(db, "vouchers", viajeId));
    if (!snap.exists()) {
      mostrarError("El voucher solicitado no existe o ya fue eliminado.");
      return;
    }
    viajeData = { id: snap.id, ...snap.data() };

    if (viajeData.firmado && viajeData.firma) {
      mostrarFirmaExistente();
    } else {
      renderizarFormulario();
    }
  } catch (err) {
    console.error(err);
    mostrarError("Error al consultar Firestore: " + err.message);
  }
}

/* ──────────────────────────────────────────────
   ESTADOS DE PANTALLA
────────────────────────────────────────────── */
function mostrarEstadoCarga() {
  const main = document.getElementById("firma-main");
  if (!main) return;
  main.innerHTML = `
    <div class="status-loading" style="text-align:center;padding:60px 20px;">
      <div class="loading-ring" style="width:48px;height:48px;border-width:4px;margin:0 auto 16px;border-top-color:var(--crimson);"></div>
      <p style="color:rgba(255,255,255,0.7);font-size:14px;font-weight:600;">Cargando información del viaje…</p>
    </div>`;
}

function mostrarError(msg) {
  const main = document.getElementById("firma-main");
  if (!main) return;
  main.innerHTML = `
    <div style="text-align:center;padding:60px 20px;">
      <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
      <h2 style="color:#fff;font-size:18px;font-weight:700;margin-bottom:10px;">Voucher no disponible</h2>
      <p style="color:rgba(255,255,255,0.65);font-size:14px;line-height:1.55;">${msg}</p>
    </div>`;
}

function mostrarFirmaExistente() {
  const main = document.getElementById("firma-main");
  if (!main) return;
  main.innerHTML = `
    <div class="viaje-info-card" style="background:var(--white);border-radius:var(--radius-lg);padding:20px;box-shadow:var(--shadow-md);">
      <div style="text-align:center;margin-bottom:16px;">
        <div style="font-size:48px;margin-bottom:8px;">✅</div>
        <h2 style="font-size:18px;font-weight:800;color:var(--gray-800);">Voucher ya firmado</h2>
        <p style="font-size:13px;color:var(--gray-400);margin-top:6px;">Este voucher ya cuenta con la firma del pasajero.</p>
      </div>
      <div style="border-top:1px solid var(--gray-100);padding-top:14px;margin-top:4px;">
        ${detalleFila("Voucher",       viajeData.codigoVoucher)}
        ${detalleFila("Funcionario",   viajeData.pasajero)}
        ${detalleFila("Origen",        viajeData.lugarSalida)}
        ${detalleFila("Destino",       viajeData.lugarDestino)}
        ${detalleFila("Fecha",         formatearFecha(viajeData.fecha))}
      </div>
      <div style="margin-top:16px;">
        <p style="font-size:10.5px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Firma registrada</p>
        <img src="${viajeData.firma}" alt="Firma del pasajero" style="width:100%;border-radius:var(--radius-sm);border:1.5px solid var(--gray-200);" />
      </div>
    </div>
    <div style="margin-top:16px;text-align:center;">
      <p class="legal-notice"><strong>CARCOVE S.A.S.</strong> está comprometida con la Ley 679 de 2001 y rechaza rotundamente la explotación, la pornografía y el turismo sexual con niños, niñas y adolescentes en Colombia.</p>
    </div>`;
}

/* ──────────────────────────────────────────────
   RENDERIZAR FORMULARIO DE FIRMA
────────────────────────────────────────────── */
function renderizarFormulario() {
  const main = document.getElementById("firma-main");
  if (!main) return;

  const v = viajeData;

  main.innerHTML = `
    <!-- Info del viaje (SIN PRECIO) -->
    <div class="viaje-info-card" style="background:var(--white);border-radius:var(--radius-lg);overflow:hidden;box-shadow:var(--shadow-md);margin-bottom:16px;">
      <div style="background:linear-gradient(135deg,var(--crimson-dark),var(--crimson));padding:13px 16px;display:flex;align-items:center;gap:10px;">
        <div style="width:36px;height:36px;background:rgba(255,255,255,0.18);border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>
        </div>
        <div>
          <div style="color:#fff;font-size:13.5px;font-weight:700;">Detalle del Servicio</div>
          <div style="color:rgba(255,255,255,0.72);font-size:11px;">Voucher ${v.codigoVoucher || "—"}</div>
        </div>
      </div>
      <div style="padding:16px;">
        ${detalleFila("Empresa",     v.empresa)}
        ${detalleFila("Tipo",        v.tipoServicio)}
        ${detalleFila("Funcionario", v.pasajero)}
        ${v.cedula ? detalleFila("Cédula", v.cedula) : ""}
        ${detalleFila("Fecha",       formatearFecha(v.fecha))}
        ${detalleFila("Salida",      v.lugarSalida)}
        ${detalleFila("Destino",     v.lugarDestino)}
        ${v.observaciones ? detalleFila("Observaciones", v.observaciones) : ""}
        <!-- ⚠️ El precio NO se muestra aquí intencionalmente -->
      </div>
    </div>

    <!-- Aviso para el pasajero -->
    <div style="background:var(--info-bg,#e8f0fe);border-left:4px solid var(--info,#1a56db);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:14px;font-size:13px;color:var(--info,#1a56db);font-weight:600;line-height:1.45;">
      ✍️ Por favor dibuja tu firma en el recuadro de abajo para confirmar que recibiste el servicio de transporte.
    </div>

    <!-- Canvas de firma -->
    <div style="background:var(--white);border-radius:var(--radius-lg);box-shadow:var(--shadow-md);overflow:hidden;margin-bottom:14px;">
      <div style="padding:12px 16px;border-bottom:1px solid var(--gray-100);background:var(--off-white);">
        <p style="font-size:13px;font-weight:700;color:var(--gray-800);">Firma del pasajero</p>
        <p style="font-size:11px;color:var(--gray-400);">Dibuja con el dedo o el mouse</p>
      </div>
      <div style="position:relative;padding:12px;">
        <div class="canvas-wrap" style="margin:0;">
          <canvas id="canvas-firma" height="180" style="display:block;width:100%;touch-action:none;cursor:crosshair;border:2px dashed var(--gray-200);border-radius:var(--radius-sm);background:#fafafa;"></canvas>
          <div class="canvas-hint" id="canvas-hint">
            <span>✍️ Firma aquí</span>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button id="btn-limpiar-canvas" onclick="limpiarCanvas()"
                  style="flex:1;padding:10px;background:var(--gray-100);color:var(--gray-600);border:1.5px solid var(--gray-200);border-radius:var(--radius-sm);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">
            🗑️ Limpiar
          </button>
          <button id="btn-guardar-firma" onclick="guardarFirma()"
                  style="flex:2;padding:10px;background:linear-gradient(135deg,var(--crimson),var(--crimson-dark));color:#fff;border:none;border-radius:var(--radius-sm);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:var(--shadow-crimson);">
            ✅ Confirmar y Enviar Firma
          </button>
        </div>
      </div>
    </div>

    <!-- Nota legal -->
    <div style="background:var(--white);border-radius:var(--radius-md);padding:14px;box-shadow:var(--shadow-sm);margin-bottom:16px;">
      <p class="legal-notice">
        <strong>CARCOVE S.A.S.</strong> está comprometida con la Ley 679 de 2001 y rechaza rotundamente la explotación, la pornografía y el turismo sexual con niños, niñas y adolescentes en Colombia.
      </p>
    </div>`;

  // Inicializar canvas después del render
  requestAnimationFrame(() => {
    inicializarCanvas();
  });
}

/* ──────────────────────────────────────────────
   CANVAS — INICIALIZACIÓN Y EVENTOS
────────────────────────────────────────────── */
function inicializarCanvas() {
  canvas = document.getElementById("canvas-firma");
  if (!canvas) return;

  // Ajustar tamaño real del canvas (evitar pixelado)
  const rect = canvas.getBoundingClientRect();
  const dpr  = window.devicePixelRatio || 1;
  canvas.width  = Math.round(rect.width  * dpr);
  canvas.height = Math.round(canvas.offsetHeight * dpr);
  ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.strokeStyle = "#1a1a22";
  ctx.lineWidth   = 2.2;
  ctx.lineCap     = "round";
  ctx.lineJoin    = "round";

  /* Eventos táctiles y de mouse */
  canvas.addEventListener("mousedown",  onStart);
  canvas.addEventListener("mousemove",  onMove);
  canvas.addEventListener("mouseup",    onEnd);
  canvas.addEventListener("mouseleave", onEnd);
  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  canvas.addEventListener("touchmove",  onTouchMove,  { passive: false });
  canvas.addEventListener("touchend",   onEnd);
}

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };
}

function onStart(e) {
  drawing = true;
  const p = getPos(e);
  lastX = p.x; lastY = p.y;
  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ocultarHint();
}

function onMove(e) {
  if (!drawing) return;
  const p = getPos(e);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  lastX = p.x; lastY = p.y;
  firmaDibujada = true;
}

function onEnd() { drawing = false; ctx.beginPath(); }

function onTouchStart(e) {
  e.preventDefault();
  const t = e.touches[0];
  onStart({ clientX: t.clientX, clientY: t.clientY });
}

function onTouchMove(e) {
  e.preventDefault();
  const t = e.touches[0];
  onMove({ clientX: t.clientX, clientY: t.clientY });
}

function ocultarHint() {
  const h = document.getElementById("canvas-hint");
  if (h) h.classList.add("hidden");
}

export function limpiarCanvas() {
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  firmaDibujada = false;
  const h = document.getElementById("canvas-hint");
  if (h) h.classList.remove("hidden");
}

/* ──────────────────────────────────────────────
   GUARDAR FIRMA EN FIRESTORE
────────────────────────────────────────────── */
export async function guardarFirma() {
  if (!firmaDibujada) {
    mostrarToastFirma("Por favor dibuja tu firma antes de continuar", "warning");
    return;
  }
  if (!viajeId) {
    mostrarToastFirma("Error: ID de viaje no encontrado", "error");
    return;
  }

  const firmaBase64 = canvas.toDataURL("image/png");
  const btn = document.getElementById("btn-guardar-firma");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Guardando firma…"; }

  try {
    await updateDoc(doc(db, "vouchers", viajeId), {
      firma:   firmaBase64,
      firmado: true,
      firmadoEn: new Date().toISOString()
    });
    mostrarExitoFirma(firmaBase64);
  } catch (err) {
    console.error(err);
    mostrarToastFirma("Error al guardar la firma: " + err.message, "error");
    if (btn) { btn.disabled = false; btn.textContent = "✅ Confirmar y Enviar Firma"; }
  }
}

/* ──────────────────────────────────────────────
   PANTALLA DE ÉXITO TRAS FIRMAR
────────────────────────────────────────────── */
function mostrarExitoFirma(firmaBase64) {
  const main = document.getElementById("firma-main");
  if (!main) return;
  main.innerHTML = `
    <div style="background:var(--white);border-radius:var(--radius-lg);padding:28px 20px;box-shadow:var(--shadow-md);text-align:center;margin-bottom:16px;">
      <div style="width:68px;height:68px;background:var(--success-bg);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:32px;">✅</div>
      <h2 style="font-size:20px;font-weight:800;color:var(--gray-800);margin-bottom:8px;">¡Firma Registrada!</h2>
      <p style="font-size:14px;color:var(--gray-600);line-height:1.55;margin-bottom:20px;">
        Tu firma ha sido guardada correctamente en nuestra plataforma. El voucher queda completamente registrado.
      </p>
      <div style="border-top:1px solid var(--gray-100);padding-top:16px;margin-top:4px;">
        <p style="font-size:10.5px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Tu firma</p>
        <img src="${firmaBase64}" alt="Firma guardada" style="width:100%;border-radius:var(--radius-sm);border:1.5px solid var(--gray-200);" />
      </div>
    </div>
    <div style="background:var(--white);border-radius:var(--radius-md);padding:14px;box-shadow:var(--shadow-sm);">
      <p class="legal-notice">
        <strong>CARCOVE S.A.S.</strong> está comprometida con la Ley 679 de 2001 y rechaza rotundamente la explotación, la pornografía y el turismo sexual con niños, niñas y adolescentes en Colombia.
      </p>
    </div>`;
}

/* ──────────────────────────────────────────────
   HELPERS UI
────────────────────────────────────────────── */
function detalleFila(key, value) {
  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--gray-100);gap:12px;">
      <span style="font-size:10.5px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;flex-shrink:0;">${key}</span>
      <span style="font-size:13px;font-weight:600;color:var(--gray-800);text-align:right;">${value || "—"}</span>
    </div>`;
}

function formatearFecha(str) {
  if (!str) return "—";
  try { return new Date(str).toLocaleString("es-CO", { dateStyle: "long", timeStyle: "short" }); }
  catch { return str; }
}

function mostrarToastFirma(msg, tipo = "info") {
  // Toast minimalista en firma.html (sin contenedor completo de app)
  const existing = document.getElementById("firma-toast");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.id    = "firma-toast";
  const colors = { error:"#c0392b", warning:"#d68000", success:"#1a8a4a", info:"#1a56db" };
  el.style.cssText = `
    position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:${colors[tipo]||colors.info};color:#fff;
    padding:12px 20px;border-radius:12px;font-size:13px;font-weight:600;
    box-shadow:0 8px 24px rgba(0,0,0,0.2);z-index:999;max-width:90%;text-align:center;
    animation:toastIn 0.28s ease both;`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

/* ──────────────────────────────────────────────
   EXPONER FUNCIONES AL DOM
────────────────────────────────────────────── */
window.limpiarCanvas  = limpiarCanvas;
window.guardarFirma   = guardarFirma;

/* ──────────────────────────────────────────────
   ARRANCAR
────────────────────────────────────────────── */
init().catch(console.error);
