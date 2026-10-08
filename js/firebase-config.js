/**
 * firebase-config.js
 * Configuración centralizada de Firebase para CARCOVE S.A.S.
 * Importado como ES Module por app.js y firma.js
 */

import { initializeApp }  from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import { getAnalytics }   from "https://www.gstatic.com/firebasejs/13.0.0/firebase-analytics.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyCRGvro_69DPeJsJN3P2xr_INpYfH2n6jQ",
  authDomain:        "carcove-22337.firebaseapp.com",
  projectId:         "carcove-22337",
  storageBucket:     "carcove-22337.firebasestorage.app",
  messagingSenderId: "946389246952",
  appId:             "1:946389246952:web:4fc6120da8d181d6f2ba5d",
  measurementId:     "G-HWPS7Z89KS"
};

export const app = initializeApp(firebaseConfig);
export const db  = getFirestore(app);

// Analytics solo en producción (no bloquea si falla)
try { getAnalytics(app); } catch (_) { /* silencioso en localhost */ }
