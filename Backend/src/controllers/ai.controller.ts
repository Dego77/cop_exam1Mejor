import { Response } from 'express';
import { prisma } from '../config/prisma';
import { AuthRequest } from '../middlewares/auth.middleware';
import { AIAgentService, AIConversationTurn, AIServiceResponse, addressMessage } from '../services/ai.service';
import { SupportAIAgentService } from '../services/support-ai.service';

const CHAT_AUTHOR_SELECT = { id: true, fullName: true, avatarUrl: true };

type ChatMessageData = {
  projectId: string;
  userId: number;
  sender: 'USER' | 'AI';
  mode: 'CHAT' | 'VOICE' | 'PHOTO';
  content: string;
  mediaUrl?: string;
  proposals?: any;
};

// Guarda un mensaje del chat de IA y lo envía, con su autor, a todos los que están en el proyecto,
// para que vean en el momento quién preguntó y qué respondió la IA.
async function saveAndBroadcastChat(req: AuthRequest, data: ChatMessageData) {
  const message = await prisma.aIChatHistory.create({
    data,
    include: { user: { select: CHAT_AUTHOR_SELECT } },
  });
  req.app.get('io')?.to(data.projectId).emit('ai-chat-message', message);
  return message;
}

type ChatMessageRecord = Awaited<ReturnType<typeof saveAndBroadcastChat>>;

// Dueño o colaborador del proyecto
async function userCanAccessProject(projectId: string, userId: number): Promise<boolean> {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      OR: [
        { ownerId: userId },
        { collaborators: { some: { userId } } },
      ],
    },
    select: { id: true },
  });
  return !!project;
}

// Chat privado: la IA trabaja igual, pero la conversación no se guarda ni se envía a los
// colaboradores. Llega como booleano en JSON o como 'true' en FormData.
function isPrivateRequest(req: AuthRequest): boolean {
  return req.body?.isPrivate === true || req.body?.isPrivate === 'true';
}

const MUTATION_KEYS = [
  'classesGenerated', 'classesModified', 'classesToDelete', 'classesToRename',
  'classesToReposition', 'attributesToRemove', 'methodsToRemove',
  'connectorsGenerated', 'connectorsToDelete', 'connectorsModified',
];

function payloadFrom(source: any): any {
  const payload: any = {};
  for (const key of MUTATION_KEYS) {
    if (Array.isArray(source?.[key]) && source[key].length > 0) payload[key] = source[key];
  }
  return payload;
}

function payloadHasWork(payload: any): boolean {
  return MUTATION_KEYS.some((key) => Array.isArray(payload?.[key]) && payload[key].length > 0);
}

function clientHistory(req: AuthRequest): AIConversationTurn[] {
  const raw = req.body?.history;
  if (typeof raw === 'string') {
    try { return clientHistory({ body: { history: JSON.parse(raw) } } as AuthRequest); } catch { return []; }
  }
  if (!Array.isArray(raw)) return [];
  return raw.slice(-80).map((turn: any) => ({
    authorName: String(turn?.authorName || turn?.fullName || 'Usuario'),
    sender: turn?.sender === 'AI' ? 'AI' as const : 'USER' as const,
    content: String(turn?.content || ''),
  }));
}

async function promptContext(req: AuthRequest, projectId: string, userId: number, isPrivate: boolean, excludeMessageId?: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
  const askerName = user?.fullName?.trim() || 'Usuario';
  if (isPrivate) return { askerName, history: clientHistory(req) };
  const rows = await prisma.aIChatHistory.findMany({
    where: { projectId },
    include: { user: { select: { fullName: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const history: AIConversationTurn[] = rows
    .filter((row) => row.id !== excludeMessageId)
    .map((row) => ({
      authorName: row.user?.fullName || 'Usuario',
      sender: row.sender === 'AI' ? 'AI' : 'USER',
      content: row.content,
    }));
  return { askerName, history };
}

function buildStoredProposals(ai: any, askerName: string, replaceDiagram = false) {
  if (replaceDiagram) {
    const payload = payloadFrom(ai);
    if (!payloadHasWork(payload)) return [];
    return [{
      id: 'foto',
      label: 'Importar el pizarrón detectado',
      askedBy: askerName,
      status: 'pending',
      replaceDiagram: true,
      payload,
    }];
  }

  const incoming = Array.isArray(ai?.proposals) ? ai.proposals : [];
  const stored = incoming.map((item: any, index: number) => {
    const direct = payloadFrom(item);
    const nested = payloadFrom(item?.payload || {});
    return {
      id: String(item?.id || `opcion-${index + 1}`).slice(0, 40),
      label: String(item?.label || `Opción ${index + 1}`).slice(0, 180),
      askedBy: String(item?.askedBy || askerName).slice(0, 80),
      status: 'pending',
      replaceDiagram: false,
      payload: payloadHasWork(direct) ? direct : nested,
    };
  }).filter((item: any) => payloadHasWork(item.payload));

  const seen = new Set<string>();
  const unique = stored.map((item: any) => {
    let id = item.id;
    while (seen.has(id)) id = `${id}-2`;
    seen.add(id);
    return { ...item, id };
  });
  if (unique.length) return unique;

  const top = payloadFrom(ai);
  if (!payloadHasWork(top)) return [];
  return [{
    id: 'pedido',
    label: `Cambio pedido por ${askerName}`,
    askedBy: askerName,
    status: 'pending',
    replaceDiagram: false,
    payload: top,
  }];
}

async function applyMutationPayload(diagramId: string, payload: any) {
  const existingNodes = await prisma.node.findMany({ where: { diagramId } });
  const mutationResult = await applyClassMutations(diagramId, existingNodes, payload || {});
  const allDiagramNodes = await prisma.node.findMany({ where: { diagramId } });
  let createdConnectors: any[] = [];
  if (payload?.connectorsGenerated?.length) {
    const result = await applyConnectorsGenerated(diagramId, allDiagramNodes, payload.connectorsGenerated);
    createdConnectors = result.createdConnectors;
    mutationResult.createdNodes.push(...result.createdAssocNodes);
  }
  const editResult = await applyConnectorDeletionsAndEdits(diagramId, allDiagramNodes, payload || {});
  return {
    createdNodes: mutationResult.createdNodes,
    updatedNodes: mutationResult.updatedNodes,
    deletedNodeIds: mutationResult.deletedNodeIds,
    createdConnectors,
    deletedConnectorIds: editResult.deletedConnectorIds,
    updatedConnectors: editResult.updatedConnectors,
  };
}

function emitAIThinking(req: AuthRequest, projectId: string, user: { id: number; fullName: string }, thinking: boolean) {
  req.app.get('io')?.to(projectId).emit('ai-chat-thinking', { projectId, userId: user.id, fullName: user.fullName, thinking });
}

// Arma el "Current Canvas Diagram Context" que se envía a Gemini. Cambia el sourceNodeId y el
// targetNodeId de cada conector (ids de la base que el modelo no entiende) por nombres de clase,
// e incluye las relaciones junto con las clases. Sin eso, Gemini no sabe qué relaciones ya existen
// y no puede usar connectorsToDelete ni connectorsModified: solo podría crear líneas nuevas.
// Se arma desde la base en cada llamada, no desde lo último que mandó el frontend, para que
// coincida con el diagrama en ese momento.
function buildDiagramContext(diagram: any): { nodes: any[]; connectors: any[] } {
  const nodes = (diagram?.nodes || []).map((n: any) => ({
    name: n.name,
    stereotype: n.stereotype || 'Entity',
    attributes: n.attributes || [],
    methods: n.methods || [],
    positionX: n.positionX,
    positionY: n.positionY,
  }));
  const nodesById = new Map<string, any>((diagram?.nodes || []).map((n: any) => [n.id, n]));
  const connectors = (diagram?.connectors || [])
    .map((c: any) => ({
      sourceClassName: nodesById.get(c.sourceNodeId)?.name,
      targetClassName: nodesById.get(c.targetNodeId)?.name,
      type: c.type,
      sourceMultiplicity: c.sourceMultiplicity,
      targetMultiplicity: c.targetMultiplicity,
    }))
    .filter((c: any) => c.sourceClassName && c.targetClassName);
  return { nodes, connectors };
}

// Una relación es muchos a muchos cuando LOS DOS extremos tienen multiplicidad de muchos. Quita el
// prefijo de visibilidad (+, -, #) igual que buildMultiplicityXml en ea-exporter.service.ts, para
// que el frontend y el backend cuenten "*" de la misma forma.
function isManyToMany(mult?: string | null): boolean {
  if (!mult) return false;
  const clean = mult.trim().replace(/^[+\-#~]\s*/, '');
  return clean === '*' || clean === '1..*' || clean === '0..*';
}

// Respaldo cuando Gemini no sigue la regla de clase de asociación implícita. Crea el mismo nodo
// intermedio que la herramienta manual "Clase de Asociación" del lienzo (onCreateConnector en
// editor.component.ts: el mismo nombre y el mismo punto medio), para que un muchos a muchos de la
// IA quede igual que uno dibujado a mano, aunque Gemini no lo haya devuelto.
async function synthesizeAssociationClassNode(diagramId: string, srcNode: any, tgtNode: any) {
  const midX = ((srcNode.positionX || 0) + (tgtNode.positionX || 0)) / 2;
  const midY = Math.max(srcNode.positionY || 0, tgtNode.positionY || 0) + 170;
  const name = srcNode.name !== tgtNode.name ? `${srcNode.name}_${tgtNode.name}` : 'ClaseAsociacion';
  return prisma.node.create({
    data: {
      diagramId,
      name,
      stereotype: 'AssociationClass',
      attributes: [],
      methods: [],
      positionX: midX,
      positionY: midY,
    },
  });
}

// Lo comparten el texto y la voz, para que crear relaciones (incluido el muchos a muchos de arriba)
// viva en un solo lugar. Antes la voz no creaba relaciones.
async function applyConnectorsGenerated(
  diagramId: string,
  allDiagramNodes: any[],
  connectorsGenerated: any[]
): Promise<{ createdConnectors: any[]; createdAssocNodes: any[] }> {
  const createdConnectors: any[] = [];
  const createdAssocNodes: any[] = [];

  for (const conn of connectorsGenerated) {
    const srcName = conn.sourceClassName || conn.sourceNodeName || conn.source;
    const tgtName = conn.targetClassName || conn.targetNodeName || conn.target;
    const assocName = conn.associationClassName || conn.associationClassNode || conn.associationClass;

    const srcNode = allDiagramNodes.find(n => n.name.toLowerCase() === srcName?.toLowerCase());
    const tgtNode = allDiagramNodes.find(n => n.name.toLowerCase() === tgtName?.toLowerCase());
    let assocNode = assocName ? allDiagramNodes.find(n => n.name.toLowerCase() === assocName?.toLowerCase()) : undefined;

    if (srcNode && tgtNode) {
      let effectiveType: string = conn.type || 'Association';
      // Gemini no nombró la clase intermedia. Si la cardinalidad es M:N en los dos extremos,
      // se crea el mismo nodo de clase de asociación que crearía la herramienta manual.
      if (!assocNode && effectiveType === 'Association' && isManyToMany(conn.sourceMultiplicity) && isManyToMany(conn.targetMultiplicity)) {
        assocNode = await synthesizeAssociationClassNode(diagramId, srcNode, tgtNode);
        createdAssocNodes.push(assocNode);
        allDiagramNodes.push(assocNode);
        effectiveType = 'AssociationClass';
      }

      const newConn = await prisma.connector.create({
        data: {
          diagramId,
          sourceNodeId: srcNode.id,
          targetNodeId: tgtNode.id,
          type: effectiveType,
          sourceMultiplicity: conn.sourceMultiplicity !== undefined ? conn.sourceMultiplicity : '',
          targetMultiplicity: conn.targetMultiplicity !== undefined ? conn.targetMultiplicity : '',
          label: conn.label || '',
          associationClassNodeId: assocNode ? assocNode.id : undefined,
        },
      });
      createdConnectors.push({
        id: newConn.id,
        sourceNodeId: newConn.sourceNodeId,
        targetNodeId: newConn.targetNodeId,
        type: newConn.type,
        sourceMultiplicity: newConn.sourceMultiplicity,
        targetMultiplicity: newConn.targetMultiplicity,
        label: newConn.label,
        associationClassNodeId: assocNode ? assocNode.id : undefined,
      });
    }
  }

  return { createdConnectors, createdAssocNodes };
}

// Busca un conector que ya existe entre dos clases (en cualquier dirección). Si viene el tipo,
// lo usa para distinguir. Lo comparten el borrado y la edición de relaciones.
function findConnectorByNames(
  connectors: any[],
  nodesById: Map<string, any>,
  srcName?: string,
  tgtName?: string,
  type?: string
): any | undefined {
  if (!srcName || !tgtName) return undefined;
  const a = srcName.trim().toLowerCase();
  const b = tgtName.trim().toLowerCase();
  return connectors.find(c => {
    const cSrcName = (nodesById.get(c.sourceNodeId)?.name || '').toLowerCase();
    const cTgtName = (nodesById.get(c.targetNodeId)?.name || '').toLowerCase();
    const namesMatch = (cSrcName === a && cTgtName === b) || (cSrcName === b && cTgtName === a);
    if (!namesMatch) return false;
    // Sin distinguir mayúsculas: Gemini no siempre repite el valor exacto del esquema
    // ("Association"), sobre todo cuando razona a partir de un audio.
    return !type || (c.type || '').toLowerCase() === type.toLowerCase();
  });
}

// Lee la primera clave que sí venga en `item`. Tolera que Gemini cambie el nombre del campo
// (pasa sobre todo en la voz) en vez de usar el nombre exacto del esquema al borrar.
function resolveName(item: any, ...keys: string[]): string | undefined {
  for (const k of keys) {
    if (item && item[k]) return item[k];
  }
  return undefined;
}

// Lo comparten el texto y la voz: borra o edita una relación que YA existe, usando los dos nombres
// de clase que Gemini mandó en 'connectorsToDelete' o 'connectorsModified'. Antes ninguno de los
// dos modos podía hacer esto: solo creaban relaciones nuevas.
async function applyConnectorDeletionsAndEdits(
  diagramId: string,
  allDiagramNodes: any[],
  aiResponse: any
): Promise<{ deletedConnectorIds: string[]; updatedConnectors: any[] }> {
  const deletedConnectorIds: string[] = [];
  const updatedConnectors: any[] = [];

  const hasWork = (aiResponse.connectorsToDelete && aiResponse.connectorsToDelete.length > 0) ||
    (aiResponse.connectorsModified && aiResponse.connectorsModified.length > 0);
  if (!hasWork) return { deletedConnectorIds, updatedConnectors };

  const existingConnectors = await prisma.connector.findMany({ where: { diagramId } });
  const nodesById = new Map(allDiagramNodes.map(n => [n.id, n]));

  if (aiResponse.connectorsToDelete && aiResponse.connectorsToDelete.length > 0) {
    for (const item of aiResponse.connectorsToDelete) {
      const srcName = resolveName(item, 'sourceClassName', 'sourceNodeName', 'source');
      const tgtName = resolveName(item, 'targetClassName', 'targetNodeName', 'target');
      const match = findConnectorByNames(existingConnectors, nodesById, srcName, tgtName, item.type);
      if (match) {
        await prisma.connector.delete({ where: { id: match.id } }).catch(() => {});
        deletedConnectorIds.push(match.id);
        const idx = existingConnectors.findIndex(c => c.id === match.id);
        if (idx !== -1) existingConnectors.splice(idx, 1);
      }
    }
  }

  if (aiResponse.connectorsModified && aiResponse.connectorsModified.length > 0) {
    for (const item of aiResponse.connectorsModified) {
      const srcName = resolveName(item, 'sourceClassName', 'sourceNodeName', 'source');
      const tgtName = resolveName(item, 'targetClassName', 'targetNodeName', 'target');
      const match = findConnectorByNames(existingConnectors, nodesById, srcName, tgtName);
      if (match) {
        const data: any = {};
        if (item.newType !== undefined) data.type = item.newType;
        if (item.newSourceMultiplicity !== undefined) data.sourceMultiplicity = item.newSourceMultiplicity;
        if (item.newTargetMultiplicity !== undefined) data.targetMultiplicity = item.newTargetMultiplicity;
        if (item.newLabel !== undefined) data.label = item.newLabel;
        if (Object.keys(data).length > 0) {
          const updated = await prisma.connector.update({ where: { id: match.id }, data });
          updatedConnectors.push(updated);
        }
      }
    }
  }

  return { deletedConnectorIds, updatedConnectors };
}

// Lo comparten el texto y la voz. Aplica, en este orden, classesToDelete, attributesToRemove,
// methodsToRemove, classesModified y classesGenerated sobre los nodos del diagrama. Todo ocurre
// sobre la misma lista en memoria `existingNodes`, que se actualiza después de cada escritura.
// Tener una sola copia evita dos fallos: (1) texto y voz ya no pueden divergir; (2) antes cada
// bloque releía una copia vieja de atributos y métodos. Editar un atributo (quitar el viejo en
// attributesToRemove y agregar el nuevo en classesModified, en la MISMA respuesta) se deshacía
// solo: classesModified seguía viendo la lista de antes del borrado y la volvía a guardar.
async function applyClassMutations(
  diagramId: string,
  existingNodes: any[],
  aiResponse: any
): Promise<{ createdNodes: any[]; updatedNodes: any[]; deletedNodeIds: string[] }> {
  const createdNodes: any[] = [];
  const updatedNodes: any[] = [];
  const deletedNodeIds: string[] = [];

  // classesToDelete: borrar clases enteras
  if (aiResponse.classesToDelete && aiResponse.classesToDelete.length > 0) {
    for (const clsName of aiResponse.classesToDelete) {
      const matchNode = existingNodes.find(n => n.name.toLowerCase() === clsName?.toLowerCase());
      if (matchNode) {
        await prisma.node.delete({ where: { id: matchNode.id } });
        deletedNodeIds.push(matchNode.id);
        const idx = existingNodes.indexOf(matchNode);
        if (idx !== -1) existingNodes.splice(idx, 1);
      }
    }
  }

  // attributesToRemove: quitar atributos
  if (aiResponse.attributesToRemove && aiResponse.attributesToRemove.length > 0) {
    for (const item of aiResponse.attributesToRemove) {
      const clsName = resolveName(item, 'className', 'class', 'name', 'entityName');
      const attrName = resolveName(item, 'attributeName', 'attribute', 'name', 'fieldName');
      const matchNode = existingNodes.find(n => n.name.toLowerCase() === clsName?.toLowerCase());
      if (matchNode) {
        const currentAttrs = (matchNode.attributes as any[]) || [];
        const updatedAttrs = currentAttrs.filter(a => a.name?.toLowerCase() !== attrName?.toLowerCase());
        const updated = await prisma.node.update({
          where: { id: matchNode.id },
          data: { attributes: updatedAttrs },
        });
        matchNode.attributes = updatedAttrs;
        updatedNodes.push(updated);
      }
    }
  }

  // methodsToRemove: quitar métodos
  if (aiResponse.methodsToRemove && aiResponse.methodsToRemove.length > 0) {
    for (const item of aiResponse.methodsToRemove) {
      const clsName = resolveName(item, 'className', 'class', 'name', 'entityName');
      const methName = resolveName(item, 'methodName', 'method', 'name', 'functionName');
      const matchNode = existingNodes.find(n => n.name.toLowerCase() === clsName?.toLowerCase());
      if (matchNode) {
        const currentMeths = (matchNode.methods as any[]) || [];
        const updatedMeths = currentMeths.filter(m => m.name?.toLowerCase() !== methName?.toLowerCase());
        const updated = await prisma.node.update({
          where: { id: matchNode.id },
          data: { methods: updatedMeths },
        });
        matchNode.methods = updatedMeths;
        updatedNodes.push(updated);
      }
    }
  }

  // classesModified: agregar atributos o métodos a una clase que ya existe
  if (aiResponse.classesModified && aiResponse.classesModified.length > 0) {
    for (const mod of aiResponse.classesModified) {
      const matchNode = existingNodes.find(n => n.name.toLowerCase() === mod.name?.toLowerCase());
      if (matchNode) {
        const currentAttrs = (matchNode.attributes as any[]) || [];
        const currentMeths = (matchNode.methods as any[]) || [];
        const newAttrs = mod.attributesToAdd || mod.attributes || [];
        const newMeths = mod.methodsToAdd || mod.methods || [];

        const updatedAttrs = [...currentAttrs];
        for (const a of newAttrs) {
          if (!updatedAttrs.some(x => x.name?.toLowerCase() === a.name?.toLowerCase())) {
            updatedAttrs.push(a);
          }
        }

        const updatedMeths = [...currentMeths];
        for (const m of newMeths) {
          if (!updatedMeths.some(x => x.name?.toLowerCase() === m.name?.toLowerCase())) {
            updatedMeths.push(m);
          }
        }

        const updated = await prisma.node.update({
          where: { id: matchNode.id },
          data: { attributes: updatedAttrs, methods: updatedMeths },
        });
        matchNode.attributes = updatedAttrs;
        matchNode.methods = updatedMeths;
        updatedNodes.push(updated);
      }
    }
  }

  // classesGenerated: crear una clase nueva, o fusionarla si ya existe una con el mismo nombre
  if (aiResponse.classesGenerated && aiResponse.classesGenerated.length > 0) {
    let currentX = 100;
    let currentY = 150;

    for (const cls of aiResponse.classesGenerated) {
      const matchNode = existingNodes.find(n => n.name.toLowerCase() === cls.name?.toLowerCase());
      if (matchNode) {
        const currentAttrs = (matchNode.attributes as any[]) || [];
        const currentMeths = (matchNode.methods as any[]) || [];
        const newAttrs = cls.attributes || [];
        const newMeths = cls.methods || [];

        const updatedAttrs = [...currentAttrs];
        for (const a of newAttrs) {
          if (!updatedAttrs.some(x => x.name?.toLowerCase() === a.name?.toLowerCase())) {
            updatedAttrs.push(a);
          }
        }

        const updatedMeths = [...currentMeths];
        for (const m of newMeths) {
          if (!updatedMeths.some(x => x.name?.toLowerCase() === m.name?.toLowerCase())) {
            updatedMeths.push(m);
          }
        }

        const updated = await prisma.node.update({
          where: { id: matchNode.id },
          data: { attributes: updatedAttrs, methods: updatedMeths },
        });
        matchNode.attributes = updatedAttrs;
        matchNode.methods = updatedMeths;
        updatedNodes.push(updated);
      } else {
        const node = await prisma.node.create({
          data: {
            diagramId,
            name: cls.name,
            stereotype: cls.stereotype || 'Entity',
            attributes: cls.attributes || [],
            methods: cls.methods || [],
            positionX: currentX,
            positionY: currentY,
          },
        });
        createdNodes.push(node);
        existingNodes.push(node);
        currentX += 250;
      }
    }
  }

  // classesToRename va AL FINAL. Así, lo que esta misma respuesta haga antes con atributos, métodos
  // o fusiones sigue usando el nombre viejo, que es el que vio el modelo en el contexto. Las
  // relaciones no se afectan: los conectores apuntan al id del nodo, no al nombre.
  if (aiResponse.classesToRename && aiResponse.classesToRename.length > 0) {
    for (const item of aiResponse.classesToRename) {
      const oldName = resolveName(item, 'oldName', 'currentName', 'from', 'className');
      const newName = resolveName(item, 'newName', 'to');
      const matchNode = existingNodes.find(n => n.name.toLowerCase() === oldName?.toLowerCase());
      if (matchNode && newName) {
        const updated = await prisma.node.update({
          where: { id: matchNode.id },
          data: { name: newName },
        });
        matchNode.name = newName;
        updatedNodes.push(updated);
      }
    }
  }

  // classesToReposition mueve una clase a nuevas coordenadas. Gemini calcula positionX y positionY
  // con las posiciones que ya vienen en el contexto (buildDiagramContext), así que entiende tanto
  // "ponla a la derecha de Y" como "colócala en x:400, y:300".
  if (aiResponse.classesToReposition && aiResponse.classesToReposition.length > 0) {
    for (const item of aiResponse.classesToReposition) {
      const clsName = resolveName(item, 'className', 'class', 'name');
      const matchNode = existingNodes.find(n => n.name.toLowerCase() === clsName?.toLowerCase());
      const posX = item.positionX;
      const posY = item.positionY;
      if (matchNode && posX !== undefined && posX !== null && !isNaN(posX) && posY !== undefined && posY !== null && !isNaN(posY)) {
        const updated = await prisma.node.update({
          where: { id: matchNode.id },
          data: { positionX: Number(posX), positionY: Number(posY) },
        });
        matchNode.positionX = Number(posX);
        matchNode.positionY = Number(posY);
        updatedNodes.push(updated);
      }
    }
  }

  return { createdNodes, updatedNodes, deletedNodeIds };
}

export const handleTextPrompt = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId, prompt, model } = req.body;
    const userId = req.user!.id;

    if (!projectId || !prompt) {
      res.status(400).json({ error: 'projectId y prompt son requeridos.' });
      return;
    }

    let diagram = await prisma.diagram.findFirst({
      where: { projectId },
      include: { nodes: true, connectors: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (!diagram) {
      diagram = await prisma.diagram.create({
        data: { projectId, name: 'Main Diagram' },
        include: { nodes: true, connectors: true },
      });
    }

    const isPrivate = isPrivateRequest(req);

    // Se guarda y se envía el mensaje primero, para que los demás lo vean de inmediato
    let userMessage: ChatMessageRecord | null = null;
    if (!isPrivate) {
      userMessage = await saveAndBroadcastChat(req, { projectId, userId, sender: 'USER', mode: 'CHAT', content: prompt });
      emitAIThinking(req, projectId, userMessage.user, true);
    }

    const { askerName, history } = await promptContext(req, projectId, userId, isPrivate, userMessage?.id);
    const contextToUse = buildDiagramContext(diagram);
    let aiResponse: AIServiceResponse;
    try {
      aiResponse = await AIAgentService.processTextPrompt(prompt, contextToUse, model, { askerName, history });
    } finally {
      if (userMessage) emitAIThinking(req, projectId, userMessage.user, false);
    }

    aiResponse.message = addressMessage(aiResponse.message, askerName);
    const proposals = aiResponse.error ? [] : buildStoredProposals(aiResponse, askerName);

    let aiMessage: ChatMessageRecord | null = null;
    if (!isPrivate) {
      aiMessage = await saveAndBroadcastChat(req, { projectId, userId, sender: 'AI', mode: 'CHAT', content: aiResponse.message, proposals });
    }

    res.json({
      aiResponse,
      proposals,
      userMessage,
      aiMessage,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al procesar prompt de IA: ' + error.message });
  }
};

export const handlePhotoPrompt = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId, model } = req.body;
    const userId = req.user!.id;
    const file = req.file;

    if (!projectId || !file) {
      res.status(400).json({ error: 'projectId y archivo de imagen son requeridos.' });
      return;
    }

    let diagram = await prisma.diagram.findFirst({
      where: { projectId },
      include: { nodes: true, connectors: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (!diagram) {
      diagram = await prisma.diagram.create({
        data: { projectId, name: 'Main Diagram' },
        include: { nodes: true, connectors: true },
      });
    }

    const isPrivate = isPrivateRequest(req);

    let userMessage: ChatMessageRecord | null = null;
    if (!isPrivate) {
      userMessage = await saveAndBroadcastChat(req, { projectId, userId, sender: 'USER', mode: 'PHOTO', content: 'Imagen de boceto subida', mediaUrl: file.path });
      emitAIThinking(req, projectId, userMessage.user, true);
    }

    const { askerName, history } = await promptContext(req, projectId, userId, isPrivate, userMessage?.id);
    let aiResponse: AIServiceResponse;
    try {
      aiResponse = await AIAgentService.processPhotoPrompt(file.path, file.mimetype, model, { askerName, history });
    } finally {
      if (userMessage) emitAIThinking(req, projectId, userMessage.user, false);
    }

    aiResponse.message = addressMessage(aiResponse.message, askerName);
    const proposals = aiResponse.error ? [] : buildStoredProposals(aiResponse, askerName, true);

    let aiMessage: ChatMessageRecord | null = null;
    if (!isPrivate) {
      aiMessage = await saveAndBroadcastChat(req, { projectId, userId, sender: 'AI', mode: 'PHOTO', content: aiResponse.message, proposals });
    }

    res.json({
      aiResponse,
      proposals,
      createdNodes: [],
      createdConnectors: [],
      userMessage,
      aiMessage,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al procesar imagen en IA: ' + error.message });
  }
};

export const handleVoicePrompt = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId, model } = req.body;
    const userId = req.user?.id;
    const file = req.file;

    if (!projectId || !file) {
      res.status(400).json({ error: 'projectId y archivo de voz son requeridos.' });
      return;
    }

    let diagram = await prisma.diagram.findFirst({
      where: { projectId },
      include: { nodes: true, connectors: true },
    });

    if (!diagram) {
      diagram = await prisma.diagram.create({
        data: { projectId, name: 'Main Diagram' },
        include: { nodes: true, connectors: true },
      });
    }

    const isPrivate = isPrivateRequest(req);

    let userMessage: ChatMessageRecord | null = null;
    if (userId && !isPrivate) {
      userMessage = await saveAndBroadcastChat(req, { projectId, userId, sender: 'USER', mode: 'VOICE', content: 'Nota de voz enviada', mediaUrl: file.path });
      emitAIThinking(req, projectId, userMessage.user, true);
    }

    const asker = userId
      ? await promptContext(req, projectId, userId, isPrivate, userMessage?.id)
      : { askerName: 'Usuario', history: [] as AIConversationTurn[] };
    const contextToUse = buildDiagramContext(diagram);
    let aiResponse: AIServiceResponse;
    try {
      aiResponse = await AIAgentService.processVoicePrompt(file.path, file.mimetype, contextToUse, model, asker);
    } finally {
      if (userMessage) emitAIThinking(req, projectId, userMessage.user, false);
    }

    aiResponse.message = addressMessage(aiResponse.message, asker.askerName);
    const proposals = aiResponse.error ? [] : buildStoredProposals(aiResponse, asker.askerName);

    let aiMessage: ChatMessageRecord | null = null;
    if (userId && !isPrivate) {
      aiMessage = await saveAndBroadcastChat(req, { projectId, userId, sender: 'AI', mode: 'VOICE', content: aiResponse.message, proposals });
    }

    res.json({
      aiResponse,
      proposals,
      userMessage,
      aiMessage,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al procesar nota de voz: ' + error.message });
  }
};

export const getAIChatHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const userId = req.user!.id;

    // Solo el dueño o los colaboradores pueden leer el chat de IA del proyecto
    if (!(await userCanAccessProject(projectId, userId))) {
      res.status(403).json({ error: 'No tienes acceso al historial de este proyecto.' });
      return;
    }

    // "Nuevo chat → Para mí": oculta todo lo anterior al reinicio de este usuario
    const clear = await prisma.aIChatClear.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });

    const history = await prisma.aIChatHistory.findMany({
      where: { projectId, ...(clear ? { createdAt: { gt: clear.clearedAt } } : {}) },
      include: { user: { select: CHAT_AUTHOR_SELECT } },
      orderBy: { createdAt: 'asc' },
    });

    res.json(history);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al obtener historial IA: ' + error.message });
  }
};

// Nuevo chat: scope=me reinicia el chat solo para quien lo pidió. scope=all borra el historial
// de IA del proyecto para todos y avisa a los colaboradores conectados.
export const clearAIChatHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const userId = req.user!.id;
    const scope = req.query.scope === 'me' ? 'me' : 'all';

    if (!(await userCanAccessProject(projectId, userId))) {
      res.status(403).json({ error: 'No tienes acceso al historial de este proyecto.' });
      return;
    }

    if (scope === 'me') {
      await prisma.aIChatClear.upsert({
        where: { projectId_userId: { projectId, userId } },
        create: { projectId, userId },
        update: { clearedAt: new Date() },
      });
    } else {
      await prisma.aIChatHistory.deleteMany({ where: { projectId } });
      await prisma.aIChatClear.deleteMany({ where: { projectId } });

      const by = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, fullName: true } });
      req.app.get('io')?.to(projectId).emit('ai-chat-cleared', { projectId, by });
    }

    res.json({ ok: true, scope });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al reiniciar el chat IA: ' + error.message });
  }
};

async function applyPhotoDiagram(diagramId: string, payload: any) {
  const detectedClasses = payload?.classesGenerated || payload?.classes || payload?.nodes || [];
  const detectedConnectors = payload?.connectorsGenerated || payload?.connectors || payload?.relationships || [];
  const createdNodes: any[] = [];
  let createdConnectors: any[] = [];
  if (!detectedClasses.length) {
    return { createdNodes, createdConnectors, updatedNodes: [], deletedNodeIds: [], deletedConnectorIds: [], updatedConnectors: [], replaced: true };
  }

  await prisma.connector.deleteMany({ where: { diagramId } }).catch(() => {});
  await prisma.node.deleteMany({ where: { diagramId } }).catch(() => {});

  const nodeResults = await Promise.all(detectedClasses.map((cls: any, idx: number) => {
    const posX = (cls.positionX !== undefined && cls.positionX !== null && !isNaN(cls.positionX))
      ? Number(cls.positionX)
      : 80 + (idx % 3) * 320;
    const posY = (cls.positionY !== undefined && cls.positionY !== null && !isNaN(cls.positionY))
      ? Number(cls.positionY)
      : 80 + Math.floor(idx / 3) * 260;
    return prisma.node.create({
      data: {
        diagramId,
        name: cls.name || cls.className || `Class_${idx + 1}`,
        stereotype: cls.stereotype || 'Entity',
        attributes: cls.attributes || [],
        methods: cls.methods || [],
        positionX: posX,
        positionY: posY,
      },
    }).then((node) => ({ node, originalCls: cls }));
  }));

  const tempIdToNodeMap = new Map<string, any>();
  const nameToNodesMap = new Map<string, any[]>();
  for (const resItem of nodeResults) {
    createdNodes.push(resItem.node);
    if (resItem.originalCls.tempId) tempIdToNodeMap.set(String(resItem.originalCls.tempId).toLowerCase(), resItem.node);
    if (resItem.originalCls.id) tempIdToNodeMap.set(String(resItem.originalCls.id).toLowerCase(), resItem.node);
    const lowerName = (resItem.node.name || '').trim().toLowerCase();
    const list = nameToNodesMap.get(lowerName) || [];
    list.push(resItem.node);
    nameToNodesMap.set(lowerName, list);
  }

  const findNode = (tempIdRef?: string, classNameRef?: string): any | undefined => {
    if (tempIdRef) {
      const foundByTemp = tempIdToNodeMap.get(String(tempIdRef).toLowerCase());
      if (foundByTemp) return foundByTemp;
    }
    if (classNameRef) {
      const matches = nameToNodesMap.get(classNameRef.trim().toLowerCase());
      if (matches && matches.length > 0) return matches.shift();
    }
    return undefined;
  };

  const connectorPayloads: any[] = [];
  for (const conn of detectedConnectors) {
    const srcNode = findNode(conn.sourceTempId || conn.sourceId, conn.sourceClassName || conn.sourceNodeName || conn.source || conn.sourceClass);
    const tgtNode = findNode(conn.targetTempId || conn.targetId, conn.targetClassName || conn.targetNodeName || conn.target || conn.targetClass);
    let assocNode = findNode(conn.associationClassTempId || conn.associationClassId, conn.associationClassName || conn.associationClassNode || conn.associationClass);
    if (!srcNode || !tgtNode) continue;

    let type = conn.type || 'Association';
    if (!assocNode && type === 'Association' && isManyToMany(conn.sourceMultiplicity) && isManyToMany(conn.targetMultiplicity)) {
      assocNode = await synthesizeAssociationClassNode(diagramId, srcNode, tgtNode);
      createdNodes.push(assocNode);
      type = 'AssociationClass';
    }

    let finalSrcId = srcNode.id;
    let finalTgtId = tgtNode.id;
    let finalSrcMult = conn.sourceMultiplicity != null ? String(conn.sourceMultiplicity) : '';
    let finalTgtMult = conn.targetMultiplicity != null ? String(conn.targetMultiplicity) : '';
    if (type === 'Composition' || type === 'Aggregation') {
      const srcLower = (srcNode.name || '').toLowerCase();
      if (srcLower === 'cliente' || srcLower.includes('cliente') || srcLower.includes('parent') || srcLower.includes('padre')) {
        finalSrcId = tgtNode.id;
        finalTgtId = srcNode.id;
        const tempM = finalSrcMult;
        finalSrcMult = finalTgtMult;
        finalTgtMult = tempM;
      }
    }
    connectorPayloads.push({
      diagramId,
      sourceNodeId: finalSrcId,
      targetNodeId: finalTgtId,
      type,
      sourceMultiplicity: finalSrcMult,
      targetMultiplicity: finalTgtMult,
      label: conn.label || '',
      associationClassNodeId: assocNode ? assocNode.id : undefined,
    });
  }

  if (connectorPayloads.length > 0) {
    const savedConnectors = await Promise.all(connectorPayloads.map((item) => prisma.connector.create({ data: item })));
    createdConnectors = savedConnectors.map((connector) => ({
      id: connector.id,
      sourceNodeId: connector.sourceNodeId,
      targetNodeId: connector.targetNodeId,
      type: connector.type,
      sourceMultiplicity: connector.sourceMultiplicity,
      targetMultiplicity: connector.targetMultiplicity,
      label: connector.label,
      associationClassNodeId: connector.associationClassNodeId || undefined,
    }));
  }

  return { createdNodes, createdConnectors, updatedNodes: [], deletedNodeIds: [], deletedConnectorIds: [], updatedConnectors: [], replaced: true };
}

export const decideAIProposal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId, messageId, proposalId, decision } = req.body;
    const userId = req.user!.id;
    if (!projectId || (decision !== 'apply' && decision !== 'reject')) {
      res.status(400).json({ error: 'projectId y decision son requeridos.' });
      return;
    }
    if (!(await userCanAccessProject(projectId, userId))) {
      res.status(403).json({ error: 'No tienes acceso a este proyecto.' });
      return;
    }

    const actor = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
    const decidedBy = actor?.fullName || 'Usuario';
    let proposal = req.body?.proposal;
    let message: any = null;

    if (messageId) {
      message = await prisma.aIChatHistory.findFirst({
        where: { id: messageId, projectId, sender: 'AI' },
        include: { user: { select: CHAT_AUTHOR_SELECT } },
      });
      if (!message) {
        res.status(404).json({ error: 'No se encontró la respuesta de la IA.' });
        return;
      }
      const list = Array.isArray(message.proposals) ? message.proposals.map((item: any) => ({ ...item })) : [];
      proposal = list.find((item: any) => item.id === proposalId);
      if (!proposal) {
        res.status(404).json({ error: 'No se encontró esa opción.' });
        return;
      }
      if (proposal.status && proposal.status !== 'pending') {
        res.json({ aiMessage: message, alreadyDecided: true });
        return;
      }

      let applied: any = {};
      if (decision === 'apply') {
        let diagram = await prisma.diagram.findFirst({ where: { projectId }, orderBy: { updatedAt: 'desc' } });
        if (!diagram) diagram = await prisma.diagram.create({ data: { projectId, name: 'Main Diagram' } });
        applied = proposal.replaceDiagram
          ? await applyPhotoDiagram(diagram.id, proposal.payload)
          : await applyMutationPayload(diagram.id, proposal.payload);
      }

      proposal.status = decision === 'apply' ? 'applied' : 'rejected';
      proposal.decidedBy = decidedBy;
      message = await prisma.aIChatHistory.update({
        where: { id: message.id },
        data: { proposals: list },
        include: { user: { select: CHAT_AUTHOR_SELECT } },
      });
      req.app.get('io')?.to(projectId).emit('ai-chat-message', message);
      res.json({ aiMessage: message, ...applied, replaced: !!proposal.replaceDiagram && decision === 'apply' });
      return;
    }

    if (decision === 'apply' && proposal) {
      let diagram = await prisma.diagram.findFirst({ where: { projectId }, orderBy: { updatedAt: 'desc' } });
      if (!diagram) diagram = await prisma.diagram.create({ data: { projectId, name: 'Main Diagram' } });
      const applied = proposal.replaceDiagram
        ? await applyPhotoDiagram(diagram.id, proposal.payload)
        : await applyMutationPayload(diagram.id, proposal.payload);
      res.json({ ...applied, replaced: !!proposal.replaceDiagram });
      return;
    }

    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al decidir la propuesta: ' + error.message });
  }
};

export const handleSupportPrompt = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { prompt, isInteractiveMode, model } = req.body;

    if (!prompt) {
      res.status(400).json({ error: 'El campo prompt es obligatorio.' });
      return;
    }

    const response = await SupportAIAgentService.processSupportPrompt(prompt, isInteractiveMode, model);
    res.json(response);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al procesar consulta de soporte: ' + error.message });
  }
};

