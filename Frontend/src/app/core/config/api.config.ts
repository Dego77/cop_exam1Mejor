// El backend corre en el mismo servidor que sirve el frontend, puerto 3000.
// Así no hay que cambiar la IP en el código cuando AWS asigna una nueva.
export const API_BASE = `${window.location.protocol}//${window.location.hostname}:3000`;

// ID de cliente OAuth de Google (Google Cloud → Credenciales). Es público, no es un secreto.
// Solo funciona en orígenes autorizados: localhost o un dominio con HTTPS.
export const GOOGLE_CLIENT_ID = '';
