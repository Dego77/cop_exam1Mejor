// El backend corre en el mismo servidor que sirve el frontend, puerto 3000.
// Así no hay que cambiar la IP en el código cuando AWS asigna una nueva.
export const API_BASE = `${window.location.protocol}//${window.location.hostname}:3000`;
