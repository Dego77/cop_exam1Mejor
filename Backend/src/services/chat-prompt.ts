export const RECENT_LIMIT = 20;
export const RELEVANT_LIMIT = 8;
export const SUMMARY_TRIGGER = 15;

const AGENT_MENTION = /@agente\s*ia\b/gi;

export interface ChatTurn {
  author: string;
  type: 'USER' | 'AI';
  text: string;
  createdAt?: string | Date;
}

export interface DiagramNodeContext {
  nodeId: string;
  name: string;
  stereotype?: string;
  attributes?: any[];
  methods?: any[];
  positionX?: number;
  positionY?: number;
}

export interface DiagramConnectorContext {
  connectorId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceClassName?: string;
  targetClassName?: string;
  type?: string;
  sourceMultiplicity?: string | null;
  targetMultiplicity?: string | null;
}

export interface DiagramContext {
  nodes: DiagramNodeContext[];
  connectors: DiagramConnectorContext[];
}

export function mentionsAgent(text: string): boolean {
  AGENT_MENTION.lastIndex = 0;
  return AGENT_MENTION.test(text || '');
}

export function stripAgentMention(text: string): string {
  return String(text || '').replace(AGENT_MENTION, ' ').replace(/\s+/g, ' ').trim();
}

export function firstName(fullName: string): string {
  return (fullName || '').trim().split(/\s+/)[0] || 'Usuario';
}

export function personalizeAiReply(message: string, author: string, firstInteraction: boolean): string {
  const name = firstName(author);
  const greeting = /^\s*¡?(?:hola|buenos\s+d[ií]as|buenas\s+(?:tardes|noches))\b[\s,:;!-]*/i;
  const namePrefix = new RegExp(`^\\s*@?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[\\s,.:;!?-]*`, 'i');
  let text = String(message || '').trim().replace(greeting, '').trim();
  if (firstInteraction) {
    const body = text.replace(namePrefix, '').trim();
    return body ? `Hola ${name}, ${body}` : `Hola ${name}.`;
  }
  if (namePrefix.test(text)) return text;
  return text ? `${name}, ${text}` : `${name}.`;
}

export function canDecideProposal(messageUserId: number, actorId: number): boolean {
  return Number(messageUserId) === Number(actorId);
}

function wordsOf(text: string): Set<string> {
  return new Set((String(text || '').match(/[\p{L}\p{N}]{4,}/gu) || []).map((word) => word.toLocaleLowerCase()));
}

export function selectChatContext(messages: ChatTurn[], question: string, summary: string) {
  const recent = messages.slice(-RECENT_LIMIT);
  const older = messages.slice(0, Math.max(0, messages.length - recent.length));
  const questionWords = wordsOf(question);
  const relevant: ChatTurn[] = [];
  for (const item of older) {
    const body = wordsOf(item.text);
    let overlap = 0;
    for (const word of questionWords) if (body.has(word)) overlap += 1;
    if (questionWords.size > 0 && overlap >= Math.min(2, questionWords.size)) relevant.push(item);
  }
  return {
    summary: summary || '',
    recent: recent.map(presentTurn),
    relevant: relevant.slice(-RELEVANT_LIMIT).map(presentTurn),
    olderCount: older.length,
  };
}

function presentTurn(turn: ChatTurn) {
  return { autor: turn.author, tipo: turn.type, texto: turn.text };
}

export function buildGroupChatPrompt(input: {
  author: string;
  firstReply: boolean;
  question: string;
  summary: string;
  recent: { autor: string; tipo: string; texto: string }[];
  relevant: { autor: string; tipo: string; texto: string }[];
  diagram: DiagramContext;
  selected: { nodeId: string; name: string } | null;
}): string {
  const rules = `
Eres ClassForge AI, el Agente IA de un editor colaborativo de diagramas de clases UML.
Responde SIEMPRE con un objeto JSON válido, sin markdown. Las claves se quedan en inglés:
{
  "message": "Explicación en español.",
  "action": "CREATE_CLASSES" | "MODIFY_CLASSES" | "DELETE_CLASSES" | "GENERAL_RESPONSE",
  "classesGenerated": [{ "name": "NombreNuevo", "stereotype": "Entity | Interface | Abstract | Enum", "attributes": [{ "name": "campo", "type": "String", "visibility": "+" }], "methods": [{ "name": "operacion", "returnType": "void", "visibility": "+" }] }],
  "classesModified": [{ "name": "NombreExistente", "attributesToAdd": [{ "name": "campo", "type": "String", "visibility": "+" }], "methodsToAdd": [{ "name": "operacion", "returnType": "void", "visibility": "+" }] }],
  "classesToDelete": [{ "nodeId": "id exacto del diagrama_actual", "name": "Nombre" }],
  "classesToRename": [{ "nodeId": "id exacto", "oldName": "NombreActual", "newName": "NombreNuevo" }],
  "classesToReposition": [{ "className": "NombreExistente", "positionX": 400, "positionY": 300 }],
  "attributesToRemove": [{ "nodeId": "id de la clase", "className": "Nombre", "attributeName": "nombre exacto del atributo" }],
  "methodsToRemove": [{ "nodeId": "id de la clase", "className": "Nombre", "methodName": "nombre exacto del método" }],
  "connectorsGenerated": [{ "sourceClassName": "ClaseA", "targetClassName": "ClaseB", "type": "Association | Aggregation | Composition | Inheritance | Implementation | Dependency", "sourceMultiplicity": "1", "targetMultiplicity": "0..*", "label": "", "associationClassName": "" }],
  "connectorsToDelete": [{ "connectorId": "id exacto de diagrama_actual.connectors" }],
  "connectorsModified": [{ "sourceClassName": "ClaseA", "targetClassName": "ClaseB", "newType": "Composition", "newSourceMultiplicity": "1", "newTargetMultiplicity": "*", "newLabel": "" }],
  "proposals": [{ "id": "opcion-1", "label": "Frase corta", "askedBy": "nombre", "classesGenerated": [], "classesModified": [], "classesToDelete": [], "connectorsGenerated": [], "connectorsToDelete": [], "connectorsModified": [] }]
}

ACCIONES:
- Crear una clase: classesGenerated. attributes y methods solo con lo que pidieron. No inventes un id. Si la clase ya está en diagrama_actual, no la vuelvas a crear: usa classesModified.
- Agregar un atributo o un método a una clase existente: classesModified, con name igual al de diagrama_actual.
- Editar un atributo: en la misma respuesta, attributesToRemove con attributeName copiado del diagrama y classesModified.attributesToAdd con el atributo nuevo. No dejes las dos versiones.
- Editar un método: methodsToRemove con methodName igual al name del método en diagrama_actual, y classesModified.methodsToAdd con el método nuevo.
- Quitar un atributo o un método: solo attributesToRemove o methodsToRemove, con el nodeId de la clase.
- Renombrar una clase: classesToRename. Moverla: classesToReposition con className y las coordenadas nuevas.
- Crear una relación que no existe: connectorsGenerated, con los nombres de las clases, el type y las multiplicidades. associationClassName solo si pidieron una clase de asociación.
- Cambiar el tipo, la multiplicidad o la etiqueta de una relación que ya existe: connectorsModified, solo los campos que cambian. No uses connectorsGenerated para eso.
- Si hay una sola opción, pon los arreglos en el nivel superior. Si hay más de una, cada una va en proposals con solo sus arreglos. Una sugerencia tuya que agregue algo no pedido va en otra proposal con askedBy "IA".

REGLAS:
1. Responde en español. message empieza con el nombre de usuario_actual. Saluda con Hola solo si primera_respuesta_a_usuario es true. En las respuestas posteriores no repitas saludos: el nombre y la respuesta, sin Hola.
2. Usa el historial y diagrama_actual como contexto. El diagrama actual prevalece ante datos antiguos.
3. Actúa como senior y mediador. No aceptes automáticamente toda solicitud de borrado o modificación. Evalúa el motivo, la responsabilidad de la clase y sus dependencias con el historial y diagrama_actual. Si hay dos ideas distintas en el historial, repite cada una con el nombre de quien la dijo y da tu criterio aparte. No elijas un ganador ni fusiones los diseños en un solo cambio.
4. Si piden eliminar una clase o una relación, explica qué relaciones se perderían, las consecuencias para el modelo y una recomendación. Si el impacto es alto, el motivo no está claro o puede romper el modelo, no generes comandos todavía: pide confirmación o contexto. classesToDelete y connectorsToDelete quedan vacíos, y proposals no lleva ese borrado. Si esa persona confirma en un mensaje posterior, prepara la propuesta e incluye la clase y sus relaciones directas.
5. Los atributos son debatibles: evalúa si son identificadores, datos de negocio, derivados o redundantes. Explica el impacto y propone el cambio solo cuando sea coherente. Aplica el mismo criterio al modificar métodos o renombrar clases.
6. Para eliminar una clase usa su nodeId exacto de diagrama_actual. Al aplicarse se quitan también sus relaciones directas: explícalo en message. Para eliminar una relación copia su connectorId desde diagrama_actual.connectors. No la borres describiendo solo los extremos. Si hay más de una entre las mismas clases, no borres ninguna y pide cuál.
7. Para editar un atributo o un método, copia el miembro actual desde diagrama_actual: el viejo va en attributesToRemove o methodsToRemove con nodeId, y el nuevo en classesModified. Renombrar una clase usa classesToRename con nodeId, oldName y newName. No la borres para volver a crearla.
8. No inventes clases, atributos, métodos ni una llave primaria. Solo crea elementos cuando la petición lo pida. Conserva ñ, á, é, í, ó, ú y ü.
9. Si no hay cambios, deja los arreglos vacíos y proposals en []. Si hay una propuesta, dilo como algo pendiente: "dejo preparada la relación para que pulses Permitir". Prohibido decir que ya se añadió, eliminó, aplicó o que ya está en el diagrama. El diagrama no cambia hasta Permitir. message tiene como máximo 4 frases cortas. Devuelve solo el JSON pedido, sin markdown.
`.trim();

  const consulta = {
    usuario_actual: input.author,
    primera_respuesta_a_usuario: input.firstReply,
    pregunta: input.question,
    resumen_conversacion: input.summary || '',
    historial_reciente: input.recent,
    mensajes_anteriores_relevantes: input.relevant,
    elemento_seleccionado: input.selected,
    diagrama_actual: input.diagram,
  };

  return `${rules}\n\nCONSULTA:\n${JSON.stringify(consulta, null, 2)}`;
}

const DESTRUCTIVE_KEYS = ['classesToDelete', 'connectorsToDelete'] as const;
const CONFIRMATION = /(?:^|[\s,.;:!?])(s[ií]|sep|confirmo|confirmado|adelante|procede|de acuerdo|hazlo|dale|permite)(?:$|[\s,.;:!?])/i;
const PRIOR_DELETE_WARNING = /confirm|seguro|se perder|consecuen|recomend|todav[ií]a no|no prepar/i;

export function userConfirmedDeletion(question: string, recent: { tipo?: string; texto?: string }[]): boolean {
  if (!CONFIRMATION.test(question || '')) return false;
  return recent.some((turn) => turn.tipo === 'AI' && PRIOR_DELETE_WARNING.test(turn.texto || ''));
}

export function clarifyPendingApply(message: string, hasProposal: boolean): string {
  const text = String(message || '').trim();
  if (!hasProposal || /permitir|todav[ií]a no est[aá]/i.test(text)) return text;
  const notice = 'Todavía no está en el diagrama. Queda pendiente hasta que pulses Permitir.';
  return text ? `${text} ${notice}` : notice;
}

export function holdUnconfirmedDeletes(target: any, confirmed: boolean): boolean {
  if (confirmed || !target || typeof target !== 'object') return false;
  let held = false;
  for (const key of DESTRUCTIVE_KEYS) {
    if (Array.isArray(target[key]) && target[key].length) {
      target[key] = [];
      held = true;
    }
  }
  if (Array.isArray(target.proposals)) {
    for (const item of target.proposals) {
      if (holdUnconfirmedDeletes(item, confirmed)) held = true;
      if (item?.payload && holdUnconfirmedDeletes(item.payload, confirmed)) held = true;
    }
  }
  return held;
}
