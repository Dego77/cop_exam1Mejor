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
  appliedChanges?: AppliedChange[];
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
1. Responde en español natural, cálido y directo, como colega del equipo. message empieza con el nombre de usuario_actual. Saluda con Hola solo si primera_respuesta_a_usuario es true. En las respuestas posteriores no repitas saludos: el nombre y la respuesta, sin Hola.
2. Usa el historial y diagrama_actual como contexto. El diagrama actual prevalece ante datos antiguos.
3. Actúa como senior y mediador. No aceptes automáticamente toda solicitud de borrado o modificación. Evalúa el motivo, la responsabilidad de la clase y sus dependencias con el historial y diagrama_actual. Si hay dos ideas distintas en el historial, repite cada una con el nombre de quien la dijo y da tu criterio aparte. No elijas un ganador ni fusiones los diseños en un solo cambio.
4. Si piden eliminar una clase o una relación, explica qué relaciones se perderían y deja el comando en una propuesta para que la persona decida. No lo apliques directo. Para eliminar una clase usa su nodeId. Para eliminar una relación copia su connectorId. Si hay más de una entre las mismas clases, no borres ninguna y pide cuál.
5. Si piden recomendación, criterio, un concepto o qué agregar, explica con las clases del diagrama y nombra atributo y tipo. Esa sugerencia va en proposals con askedBy "IA". No se aplica sola. Prohibido quedarte en "atributos esenciales", "información mínima" o "buenas prácticas" sin decir cuáles campos son. Si el atributo ya existe, no lo repitas. Si no puedes nombrar el atributo, no armes propuesta.
6. Para eliminar una clase usa su nodeId exacto de diagrama_actual. Al aplicarse se quitan también sus relaciones directas: explícalo en message.
7. Para editar un atributo o un método, copia el miembro actual desde diagrama_actual: el viejo va en attributesToRemove o methodsToRemove con nodeId, y el nuevo en classesModified. Renombrar una clase usa classesToRename con nodeId, oldName y newName. No la borres para volver a crearla.
8. Si piden crear o dibujar únicamente elementos concretos, no inventes clases ni miembros. Si describen el propósito de una clase pero dejan abiertos sus atributos, relación o nombre, propón un diseño mínimo y concreto adecuado al caso; explica la propuesta en message, elige un nombre provisional que encaje mejor, deja una sola propuesta con ese nombre y pregunta si prefieren la alternativa. No llames "esenciales" a campos sin enumerarlos. Conserva ñ, á, é, í, ó, ú y ü.
   Identificadores: en una clase entidad el atributo id va primero. Si ya existe, di en qué posición está y no lo dupliques. Si no es el primero, prepara dejarlo primero. Si no existe y preguntaron por la llave, o pidieron recomendación para persistir esa entidad, propon "id: Long" al inicio.
   Clase de asociación: si un conector trae associationClassName, el tipo es AssociationClass o las dos multiplicidades son de muchos, esa clase se identifica por las entidades que une. No le des un id propio. Sus atributos son datos de la relación, no una copia de las llaves de los padres. Si ya tiene id, explica por qué sobra y prepara quitarlo.
9. Si el pedido ordena agregar elementos concretos que no existen, dilo como algo que ya queda en el diagrama. Una pregunta de recomendación o de concepto no es una orden de dibujar: explícala y deja la sugerencia en proposals con askedBy "IA". Si el nombre o el diseño está abierto a elección, prepara la propuesta pendiente y pregunta qué opción prefiere la persona. Si la clase ya existe, no la pongas en classesGenerated y dilo. Si el atributo, el método o la relación del mismo tipo ya existen, no los repitas y dilo. Deja también pendientes los borrados, las ediciones, los renombres y los cambios de relaciones.
10. cambios_aplicados son los cambios que sí quedaron en el diagrama, del más antiguo al más nuevo. El que tiene ultimo_cambio true es el último. No digas que no hubo cambios si esa lista tiene elementos. message tiene como máximo 4 frases breves. Cuando incluyas una propuesta, resume con naturalidad los cambios concretos y pregunta algo útil si falta una decisión. La tarjeta de propuesta muestra las acciones disponibles; no digas "adjunto", "dejo la propuesta preparada" ni repitas el texto de sus botones. Devuelve solo el JSON pedido, sin markdown.
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
    cambios_aplicados: (input.appliedChanges || []).map((change, index, all) => ({
      etiqueta: change.label,
      pedido_por: change.askedBy,
      aplicado_por: change.decidedBy || change.askedBy,
      ultimo_cambio: index === all.length - 1,
      resumen: change.summary,
    })),
  };

  return `${rules}\n\nCONSULTA:\n${JSON.stringify(consulta, null, 2)}`;
}

const DESTRUCTIVE_KEYS = ['classesToDelete', 'connectorsToDelete'] as const;
const CONFIRMATION = /(?:^|[\s,.;:!?])(s[ií]|sep|confirmo|confirmado|adelante|procede|de acuerdo|hazlo|dale|permite)(?:$|[\s,.;:!?])/i;
const PRIOR_DELETE_WARNING = /confirm|seguro|se perder|consecuen|recomend|todav[ií]a no|no prepar/i;

const ADVICE = /recomiend|recomend|sugier|qu[eé]\s+es\b|qu[eé]\s+significa|expl[ií]c(?:ame|a\b)|qu[eé]\s+opinas|criterio|opini[oó]n|consejo|conviene|deber[ií]a|d[oó]nde\s+est[aá]|normaliz|qu[eé]\s+falta|cu[aá]l(?:es)?\s+agreg|qu[eé]\s+agreg|c[oó]mo\s+(?:puedo|se)\b|crees\s+que|est[aá]\s+bien/i;
const ORDER = /(?:^|[\s,.;:!?¿¡])(a[nñ]ade|agrega|crea|elimina|borra|quita|renombra|mueve|cambia|pon(?:le)?|coloca|aplica|relaciona|saca|actualiza|corrige)(?:$|[\s,.;:!?])/i;

const CLASS_NAME_CHOICE = /\b(?:clase|entidad)\s+[\p{L}\p{N}_-]+\s+(?:o|\/)\s+[\p{L}\p{N}_-]+/iu;

export function asksForAdvice(question: string): boolean {
  const text = String(question || '');
  return (ADVICE.test(text) && !ORDER.test(text)) || CLASS_NAME_CHOICE.test(text);
}

export interface AppliedChange {
  label: string;
  askedBy: string;
  decidedBy?: string;
  summary: string;
  payload: any;
}

const UNDO_LAST = /deshac|deshaz|revierte|revertir/i;
const UNDO_TARGET = /últim|ultim|lo que (?:hiciste|hicieron|se hizo)|el cambio/i;

export function asksToUndoLast(question: string): boolean {
  const text = String(question || '');
  return UNDO_LAST.test(text) && UNDO_TARGET.test(text);
}

export function summarizePayload(payload: any): string {
  const parts: string[] = [];
  for (const item of asArray(payload?.classesGenerated)) parts.push(`creó la clase ${item?.name || item}`);
  for (const item of asArray(payload?.classesModified)) {
    const attributes = asArray(item?.attributesToAdd || item?.attributes).map((attr) => attr?.name).filter(Boolean);
    const methods = asArray(item?.methodsToAdd || item?.methods).map((method) => method?.name).filter(Boolean);
    if (attributes.length) parts.push(`agregó ${attributes.join(', ')} a ${item?.name}`);
    if (methods.length) parts.push(`agregó el método ${methods.join(', ')} a ${item?.name}`);
  }
  for (const item of asArray(payload?.classesToDelete)) parts.push(`eliminó la clase ${item?.name || item}`);
  for (const item of asArray(payload?.classesToRename)) parts.push(`renombró ${item?.oldName} a ${item?.newName}`);
  for (const item of asArray(payload?.attributesToRemove)) parts.push(`quitó ${item?.attributeName} de ${item?.className}`);
  for (const item of asArray(payload?.methodsToRemove)) parts.push(`quitó el método ${item?.methodName} de ${item?.className}`);
  for (const item of asArray(payload?.connectorsGenerated)) parts.push(`creó la relación entre ${item?.sourceClassName} y ${item?.targetClassName}`);
  for (const item of asArray(payload?.connectorsToDelete)) parts.push(`eliminó una relación${item?.sourceClassName ? ` entre ${item.sourceClassName} y ${item.targetClassName}` : ''}`);
  for (const item of asArray(payload?.connectorsModified)) parts.push(`cambió la relación entre ${item?.sourceClassName} y ${item?.targetClassName}`);
  return parts.join('; ') || 'cambió el diagrama';
}

export function collectAppliedChanges(messages: { proposals?: any }[]): AppliedChange[] {
  const changes: AppliedChange[] = [];
  for (const message of messages) {
    const list = Array.isArray(message?.proposals) ? message.proposals : [];
    for (const item of list) {
      if (item?.status !== 'applied' || item?.replaceDiagram || !item?.payload) continue;
      changes.push({
        label: String(item.label || 'Cambio aplicado'),
        askedBy: String(item.askedBy || ''),
        decidedBy: item.decidedBy ? String(item.decidedBy) : undefined,
        summary: summarizePayload(item.payload),
        payload: item.payload,
      });
    }
  }
  return changes.slice(-5);
}

export function inverseChange(payload: any): any {
  const inverse: any = {};
  const created = asArray(payload?.classesGenerated);
  if (created.length) inverse.classesToDelete = created.map((item) => ({ name: item?.name || item }));
  const attributesToRemove: any[] = [];
  const methodsToRemove: any[] = [];
  for (const item of asArray(payload?.classesModified)) {
    for (const attr of asArray(item?.attributesToAdd || item?.attributes)) {
      if (attr?.name) attributesToRemove.push({ className: item?.name, attributeName: attr.name });
    }
    for (const method of asArray(item?.methodsToAdd || item?.methods)) {
      if (method?.name) methodsToRemove.push({ className: item?.name, methodName: method.name });
    }
  }
  if (attributesToRemove.length) inverse.attributesToRemove = attributesToRemove;
  if (methodsToRemove.length) inverse.methodsToRemove = methodsToRemove;
  const connectors = asArray(payload?.connectorsGenerated);
  if (connectors.length) {
    inverse.connectorsToDelete = connectors.map((item) => ({
      sourceClassName: item?.sourceClassName,
      targetClassName: item?.targetClassName,
      type: item?.type,
    }));
  }
  const renamed = asArray(payload?.classesToRename);
  if (renamed.length) {
    inverse.classesToRename = renamed
      .filter((item) => item?.oldName && item?.newName)
      .map((item) => ({ nodeId: item.nodeId, oldName: item.newName, newName: item.oldName }));
  }
  const deleted = asArray(payload?.classesToDelete);
  if (deleted.length) {
    inverse.classesGenerated = deleted
      .map((item) => ({ name: typeof item === 'string' ? item : item?.name, stereotype: 'Entity', attributes: [], methods: [] }))
      .filter((item) => item.name);
  }
  return inverse;
}

function asArray(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

export function userConfirmedDeletion(question: string, recent: { tipo?: string; texto?: string }[]): boolean {
  if (!CONFIRMATION.test(question || '')) return false;
  return recent.some((turn) => turn.tipo === 'AI' && PRIOR_DELETE_WARNING.test(turn.texto || ''));
}

export function describeDirectApply(message: string, applied: boolean, pending: boolean): string {
  let text = String(message || '').trim();
  if (!pending) {
    text = text
      .replace(/\s*Dejo preparad[oa][^.?!]*(?:Permitir|Aplicar al diagrama)[^.?!]*[.?!]?/gi, '')
      .replace(/\s*Todavía no está en el diagrama\.[^.?!]*(?:Permitir|Aplicar al diagrama)[^.?!]*[.?!]?/gi, '')
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
  if (!hasProposal || text) return text;
  return 'Te dejé una propuesta concreta para revisar.';
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
