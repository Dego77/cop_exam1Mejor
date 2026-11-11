// Backend corriendo en el servidor AWS (IP pública: 18.207.168.32)
export const API_BASE = typeof window !== 'undefined' && window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
  ? `${window.location.protocol}//${window.location.hostname}:3000`
  : 'http://18.207.168.32:3000';

// ID de cliente OAuth de Google (Google Cloud → Credenciales). Es público, no es un secreto.
// Solo funciona en orígenes autorizados: localhost o un dominio con HTTPS.
export const GOOGLE_CLIENT_ID = '';
