# Plan de implementación: chat grupal con Agente IA

El encargo anterior era un ejemplo de cómo debería comportarse un chat de equipo con una IA. Este plan lo traduce a ClassForge, con el código y los servicios que ya existen. No se agregan bases, colas ni formatos que el proyecto no usa.

## Dónde vive hoy cada parte del ejemplo

| Idea del ejemplo | En este proyecto |
| --- | --- |
| Historial persistente (PostgreSQL si no hay otra base) | Ya es PostgreSQL con Prisma. El chat está en `AIChatHistory` (`Backend/prisma/schema.prisma`): sala, autor, fecha, texto y propuestas. |
| Canal efímero para presencia y estados (Redis era solo un ejemplo) | Socket.IO en `Backend/src/sockets/collaboration.socket.ts`. La sala y quién está conectado viven en el mapa `roomUsers` de ese proceso. No hay Redis y no se instala. |
| Identidad estable para permisos | JWT y `User.id`. El backend ya rechaza en `decideAIProposal` si otro usuario intenta aplicar la propuesta. |
| La IA no modifica el diagrama sola | Las propuestas quedan en el JSON `proposals` hasta Permitir o No permitir. |
| Misma conversación para toda la sala | `saveAndBroadcastChat` guarda el mensaje y emite `ai-chat-message` a la sala del proyecto. |
| Panel junto al diagrama | Barra derecha del editor, `Frontend/src/app/pages/editor/editor.component.ts` y `right-sidebar.component.ts`. |

Se dejan como están el agente de soporte (`Backend/src/services/support-ai.service.ts`), la paleta, el lienzo, la exportación, la voz, la foto y el chat privado.

## Qué se cambia y qué no

### Contexto que recibe Agente IA

Hoy `promptContext`, en `Backend/src/controllers/ai.controller.ts`, lee todos los mensajes del proyecto y `formatConversationHistory` los recorta solo si pasan de 28 000 caracteres. El diagrama entra por `buildDiagramContext` con nombres, atributos, métodos y posiciones, sin ids. Borrar una relación busca por los dos nombres de clase, así que dos líneas entre las mismas clases no se distinguen.

No se crea una tabla de resumen ni una segunda llamada al modelo para resumir. En un hilo de esta app el historial cabe en los últimos mensajes, y un resumen aparte puede perder una decisión del equipo.

Sí se ajusta el armado que ya existe:

- `promptContext` manda los últimos 30 mensajes enteros. El número queda en una constante del controlador para poder bajarlo si la llamada se alarga.
- `buildDiagramContext` incluye `nodeId` en cada clase y `connectorId` en cada relación, además de los nombres.
- El editor pasa al panel la clase seleccionada, que hoy no llega. Si hay una, se añade al prompt como elemento seleccionado.
- El modelo sigue respondiendo con el JSON que ya entiende el servidor (`message`, `classesToDelete`, `connectorsToDelete`, etc.). No se reemplaza por `mensaje_chat` / `comandos_diagrama`: ese formato obligaría a reescribir el aplicador y dejaría inutilizables las propuestas ya guardadas.

Para cumplir “borrar por id exacto” dentro de ese JSON:

- `classesToDelete` puede traer el `nodeId`.
- `connectorsToDelete` debe traer el `connectorId`. Si solo vienen nombres y hay más de una relación entre esas clases, el servidor rechaza el comando y lo explica en el mensaje. No borra “la primera que encuentre”.
- Renombrar una clase usa el `nodeId` cuando el modelo lo tenga. Crear una clase sigue por nombre, porque todavía no existe un id.

### Conversación

Hoy cualquier texto del chat llama a Gemini. El mensaje se pinta al instante, pero sin id: cuando el servidor lo confirma, el socket lo ignora por ser propio y el provisional no se reemplaza.

Cambios:

- Columna opcional `clientMessageId` en `AIChatHistory`. El cliente crea el id, pinta el mensaje y, al llegar el broadcast con el mismo id, sustituye el provisional. No se inserta otra vez.
- Escribir `@` ofrece a Agente IA, a los usuarios que ya están en `room-users` y a `@all`.
- Solo `@Agente IA` dispara `POST /api/ai/chat`. Una mención a una persona o a `@all` se guarda y se publica como mensaje del equipo, sin llamar al modelo.
- La respuesta de la IA sigue asociada al `userId` de quien preguntó, como ahora.
- Saludo con el historial que ya está en la base: si esa persona no tiene aún una respuesta de IA en el proyecto, el servidor antepone `Hola {nombre}`. Si ya tiene una, antepone solo `{nombre}` y quita un “Hola” que haya escrito el modelo. No hace falta otra tabla.

Voz, foto, chat privado y “nuevo chat” no cambian de flujo. Una consulta grupal usa los mensajes del proyecto guardados en `AIChatHistory`, no la vista ocultada por “Para mí”.

### Estados que no se guardan

Siguen en Socket.IO, en la misma sala del proyecto. No se persisten.

- Evento nuevo `chat-typing`. El panel muestra “Nombre está escribiendo…” y lo quita a los 3 segundos. El modo ver también lo muestra.
- El evento que ya existe, `ai-chat-thinking`, pasa a decir “Agente IA está respondiendo a Nombre” para toda la sala, incluido quien preguntó. Se apaga al llegar la respuesta y también si Gemini falla.
- Si el modelo no devuelve un JSON válido, el mensaje de la persona ya quedó guardado. Se publica un mensaje de error de Agente IA, sin propuestas y sin tocar el diagrama.

### Propuestas y diagrama

La regla de permisos ya está: la interfaz muestra Permitir y No permitir solo a quien hizo la consulta, y el backend compara `message.userId` con el usuario del JWT.

Se refuerza el camino actual, sin un motor de comandos nuevo:

- Antes de mutar, la propuesta se marca en una transacción. Si ya no está pendiente, la segunda petición no vuelve a escribir el diagrama.
- Al aplicar, el servidor avisa a toda la sala con el evento `diagram-reloaded` que ya existe. Cada cliente, incluido quien aplicó, carga el diagrama una vez desde la API. Se deja el parche local seguido de otra recarga, que podía aplicar el cambio dos veces.
- Borrar una clase por `nodeId` también borra los conectores de ese nodo. El texto de la propuesta nombra esas relaciones, reutilizando la idea de `buildDeletionConfirmation`.
- Atributos, métodos, renombre y relaciones nuevas siguen en `applyClassMutations` y `applyConnectorsGenerated`. La validación nueva rechaza un id que ya no está en el diagrama.

### Presentación

En el panel del editor y en el visor (`Frontend/src/app/pages/viewer/viewer.component.ts`):

- Tres estilos con las variables CSS actuales: mensaje de participante, respuesta de Agente IA y aviso de sistema cuando una propuesta se aplica o se descarta.
- Saltos de línea visibles. `**texto**` se parte en nodos de Angular, sin `innerHTML`.
- En las respuestas de la IA se resaltan los nombres de clase que existen en el diagrama de ese momento.
- Avatares e iniciales del chat usan `getColorForUser` del editor, la misma paleta que la barra de colaboradores. Hoy el chat calcula un HSL distinto.
- El panel se puede cerrar: el ancho pasa a 0 y queda una pestaña para abrirlo, sin tapar la paleta ni el lienzo.

No hay tema claro en `Frontend/src/styles.css`. El chat sigue el tema oscuro que ya usa el editor. No se inventa un modo claro.

## Orden de trabajo

1. `clientMessageId`, mención `@Agente IA` como único disparador del modelo y saludo único por integrante, sobre `ai.controller.ts` y el panel derecho.
2. Sugerencias al escribir `@`, colores de la lista de participantes, `chat-typing` y el texto de `ai-chat-thinking`.
3. Últimos 30 mensajes, ids en `buildDiagramContext` y la clase seleccionada que envía el editor.
4. Borrado y renombre por id, rechazo si la relación es ambigua, transacción al decidir y una sola recarga del diagrama.
5. Texto con negrita segura, clases resaltadas, avisos de sistema y panel que se cierra.
6. Pruebas con `node:test` del validador de ids (id inexistente, dos relaciones entre las mismas clases, borrado de clase con sus conectores, JSON inválido, otro usuario decidiendo). Luego `npm test` en el backend, `npx tsc --noEmit` y la compilación del frontend.

## Fuera de este plan

- Redis, u otra cola. Socket.IO ya reparte presencia, escritura y “está respondiendo”.
- Una tabla de resumen del hilo. El tope pasa a ser cantidad de mensajes, no un resumen generado.
- Cambiar el JSON que ya devuelve Gemini y ya aplica el servidor.
- Pasar voz y foto a otro formato de comandos.
- Un tema claro para toda la aplicación.
- Dejar escribir o aplicar propuestas desde el modo ver. Ese visor sigue en solo lectura y sí muestra mensajes, menciones, “está escribiendo” y el indicador de Agente IA.
