import { Injectable, NgZone } from '@angular/core';
import { GOOGLE_CLIENT_ID } from '../config/api.config';

export interface GoogleAccount {
  email: string;
  name: string;
  picture?: string;
}

declare const google: any;

// Abre el selector de cuentas de Google y devuelve correo y nombre.
// Google nunca entrega la contraseña: solo sirve para rellenar el formulario.
@Injectable({ providedIn: 'root' })
export class GoogleAccountService {
  constructor(private zone: NgZone) {}

  pickAccount(): Promise<GoogleAccount> {
    return new Promise((resolve, reject) => {
      if (!GOOGLE_CLIENT_ID) {
        reject(new Error('Google aún no está configurado (falta el Client ID).'));
        return;
      }
      if (!this.isOriginAllowed()) {
        reject(new Error('Google no está disponible en esta dirección. Ábrelo desde localhost o un dominio con HTTPS.'));
        return;
      }
      if (typeof google === 'undefined' || !google.accounts?.oauth2) {
        reject(new Error('No se pudo cargar Google. Revisa tu conexión e inténtalo de nuevo.'));
        return;
      }

      const client = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'openid email profile',
        prompt: 'select_account',
        callback: async (resp: any) => {
          if (resp?.error || !resp?.access_token) {
            this.zone.run(() => reject(new Error('No se pudo obtener la cuenta de Google.')));
            return;
          }
          try {
            const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${resp.access_token}` }
            });
            if (!res.ok) throw new Error();
            const info = await res.json();
            // El token solo se usa para leer el correo; se revoca enseguida
            google.accounts.oauth2.revoke(resp.access_token, () => {});
            this.zone.run(() => resolve({ email: info.email, name: info.name || '', picture: info.picture }));
          } catch {
            this.zone.run(() => reject(new Error('No se pudo leer el correo de la cuenta de Google.')));
          }
        },
        // La persona cerró la ventana o el navegador bloqueó el popup
        error_callback: (err: any) => {
          const closed = err?.type === 'popup_closed';
          this.zone.run(() => reject(new Error(closed ? '' : 'El navegador bloqueó la ventana de Google. Permite los popups e inténtalo de nuevo.')));
        }
      });

      client.requestAccessToken();
    });
  }

  // Google solo acepta localhost o HTTPS como origen; por IP con http rechaza la petición
  private isOriginAllowed(): boolean {
    const { protocol, hostname } = window.location;
    return protocol === 'https:' || hostname === 'localhost' || hostname === '127.0.0.1';
  }
}
