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
  associationClassName?: string | null;
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
- Crear una clase: classesGenerated. attributes y methods solo con lo que pidieron o con lo que una recomendación haya nombrado. El atributo id, si va, queda primero en la lista. Si la clase ya está en diagrama_actual, no la vuelvas a crear: usa classesModified.
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
4. Si piden eliminar una clase o una relación, explica qué relaciones se perderían y deja el comando para que pulsen Permitir. No lo apliques directo. Para eliminar una clase usa su nodeId. Para eliminar una relación copia su connectorId. Si hay más de una entre las mismas clases, no borres ninguna y pide cuál.
5. Si piden recomendación, criterio, un concepto o qué agregar, explica con las clases del diagrama y nombra atributo y tipo. Esa sugerencia va en proposals con askedBy "IA". No se aplica sola. Prohibido quedarte en "atributos esenciales", "información mínima" o "buenas prácticas" sin decir cuáles campos son. Si el atributo ya existe, no lo repitas. Si no puedes nombrar el atributo, no armes propuesta.
6. Para eliminar una clase usa su nodeId exacto de diagrama_actual. Al aplicarse se quitan también sus relaciones directas: explícalo en message.
7. Para editar un atributo o un método, copia el miembro actual desde diagrama_actual: el viejo va en attributesToRemove o methodsToRemove con nodeId, y el nuevo en classesModified. Renombrar una clase usa classesToRename con nodeId, oldName y newName. No la borres para volver a crearla.
8. No inventes clases ni miembros cuando el pedido es crear o dibujar solo lo que nombraron. Si piden recomendación, sí propones los atributos concretos que falten. Conserva ñ, á, é, í, ó, ú y ü.
   Identificadores: en una clase entidad el atributo id va primero. Si ya existe, di en qué posición está y no lo dupliques. Si no es el primero, prepara dejarlo primero. Si no existe y preguntaron por la llave, o pidieron recomendación para persistir esa entidad, propon "id: Long" al inicio.
   Clase de asociación: si un conector trae associationClassName, el tipo es AssociationClass o las dos multiplicidades son de muchos, esa clase se identifica por las entidades que une. No le des un id propio. Sus atributos son datos de la relación, no una copia de las llaves de los padres. Si ya tiene id, explica por qué sobra y prepara quitarlo.
9. Si el pedido ordena agregar una clase, un atributo, un método o una relación que todavía no existe, dilo como algo que ya queda en el diagrama. No pidas Permitir. Una pregunta de recomendación o de concepto no es un pedido de dibujar: explícala y deja la sugerencia en Permitir. Si la clase ya existe, no la pongas en classesGenerated y dilo. Si el atributo, el método o la relación del mismo tipo ya existen, no los repitas y dilo. Pide Permitir también para borrar, quitar, editar, renombrar o cambiar una relación existente. message tiene como máximo 6 frases cortas. Devuelve solo el JSON pedido, sin markdown.
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

const ADVICE = /recomiend|recomend|sugier|qu[eé]\s+es\b|qu[eé]\s+significa|expl[ií]c(?:ame|a\b)|qu[eé]\s+opinas|criterio|opini[oó]n|consejo|conviene|deber[ií]a|d[oó]nde\s+est[aá]|normaliz|qu[eé]\s+falta|cu[aá]l(?:es)?\s+agreg|qu[eé]\s+agreg|c[oó]mo\s+(?:puedo|se)\b|crees\s+que|est[aá]\s+bien/i;
const ORDER = /(?:^|[\s,.;:!?¿¡])(a[nñ]ade|agrega|crea|elimina|borra|quita|renombra|mueve|cambia|pon(?:le)?|coloca|aplica|relaciona|saca|actualiza|corrige)(?:$|[\s,.;:!?])/i;

export function asksForAdvice(question: string): boolean {
  const text = String(question || '');
  return ADVICE.test(text) && !ORDER.test(text);
}

export function userConfirmedDeletion(question: string, recent: { tipo?: string; texto?: string }[]): boolean {
  if (!CONFIRMATION.test(question || '')) return false;
  return recent.some((turn) => turn.tipo === 'AI' && PRIOR_DELETE_WARNING.test(turn.texto || ''));
}

export function describeDirectApply(message: string, applied: boolean, pending: boolean): string {
  let text = String(message || '').trim();
  if (!pending) {
    text = text
      .replace(/\s*Dejo preparad[oa][^.?!]*Permitir[^.?!]*[.?!]?/gi, '')
      .replace(/\s*Todavía no está en el diagrama\.[^.?!]*Permitir[^.?!]*[.?!]?/gi, '')
      .trim();
  }
  if (applied && !/ya qued[oó] en el diagrama/i.test(text)) {
    text = `${text} Eso ya quedó en el diagrama.`.trim();
  }
  if (!applied && pending) text = text.replace(/ya qued[oó] en el diagrama\.?/gi, '').replace(/\s{2,}/g, ' ').trim();
  return text;
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
