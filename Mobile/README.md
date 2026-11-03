# ClassForge Viewer (app móvil · Modo Ver)

La app abre la página web de ClassForge en `/view`: el dueño o un colaborador ve el diagrama y el chat de la IA en tiempo real, sin poder editar.

## Configurar el servidor
En `capacitor.config.json`, `server.url` apunta al frontend desplegado (por defecto `http://3.138.124.211:4200/view`). Si cambia la IP o el puerto, edítalo y ejecuta:

```bash
npm run android:sync
```

## Generar el APK
```bash
npm install            # solo la primera vez
npm run android:sync
npm run android:open   # abre Android Studio
```
En Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.

## Probar sin APK
Desde el navegador del celular, en la misma red: `http://<IP-del-servidor>:4200/view`.
