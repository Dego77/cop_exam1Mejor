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

// Persists one AI chat message and broadcasts it (with its author) to everyone in the project
// room, so collaborators see who asked the AI what - and its reply - in real time, like a group chat.
async function saveAndBroadcastChat(req: AuthRequest, data: ChatMessageData) {
  const message = await prisma.aIChatHistory.create({
    data,
    include: { user: { select: CHAT_AUTHOR_SELECT } },
  });
  req.app.get('io')?.to(data.projectId).emit('ai-chat-message', message);
  return message;
}

type ChatMessageRecord = Awaited<ReturnType<typeof saveAndBroadcastChat>>;

// Owner or collaborator of the project
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

// Private chat: the AI works exactly the same, but the conversation is neither stored nor
// broadcast to collaborators (arrives as boolean in JSON or 'true' in multipart FormData).
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

// Builds the "Current Canvas Diagram Context" sent to Gemini, resolving each connector's
// sourceNodeId/targetNodeId (meaningless DB ids to the model) into class names, and including
// existing relationships alongside classes. Without this, Gemini has no way to know what
// relationships already exist, so it can't correctly use connectorsToDelete/connectorsModified
// (it would only ever be able to create new ones, never reference an existing one by name).
// Built fresh from the DB on every call instead of trusting whatever the frontend last sent, so
// it's always accurate for the diagram state at request time.
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

// A relationship is many-to-many when BOTH ends carry a many-valued multiplicity. Mirrors the
// same "strip a leading visibility prefix" normalization ea-exporter.service.ts's
// buildMultiplicityXml already uses on the frontend, so both layers agree on what counts as "*".
function isManyToMany(mult?: string | null): boolean {
  if (!mult) return false;
  const clean = mult.trim().replace(/^[+\-#~]\s*/, '');
  return clean === '*' || clean === '1..*' || clean === '0..*';
}

// Deterministic fallback for when Gemini doesn't follow the "IMPLICIT ASSOCIATION CLASS" prompt
// rule: synthesizes the same junction node the manual "Clase de Asociación" canvas tool creates
// (see editor.component.ts's onCreateConnector, which this mirrors - same naming and midpoint
// positioning convention) so AI-generated many-to-many relationships always get modeled the same
// way as a manually-drawn one, regardless of what Gemini actually returned.
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

// Shared by handleTextPrompt and handleVoicePrompt so relationship-creation logic (including the
// many-to-many -> association class synthesis above) lives in exactly one place. Voice used to
// have none of this at all, which is why it could never create a relationship.
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
      // Gemini didn't name/create a junction class itself - if the cardinality is M:N on both
      // ends, synthesize the same association-class node the manual canvas tool would.
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

// Finds an existing connector between two named classes (either direction), optionally narrowed
// by relationship type - shared by the deletion and edit paths below.
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
    // Case-insensitive: Gemini doesn't always reproduce the exact PascalCase enum value
    // ("Association") it was given in the schema/context, especially reasoning from audio.
    return !type || (c.type || '').toLowerCase() === type.toLowerCase();
  });
}

// Reads the first present key from `item`, tolerating the kind of field-name variance Gemini
// sometimes introduces (especially transcribing+reasoning from audio in one pass) instead of
// following the schema's exact property names for removal/deletion payloads.
function resolveName(item: any, ...keys: string[]): string | undefined {
  for (const k of keys) {
    if (item && item[k]) return item[k];
  }
  return undefined;
}

// Shared by handleTextPrompt and handleVoicePrompt: deletes/edits an EXISTING relationship by
// the two class names Gemini reported in 'connectorsToDelete'/'connectorsModified'. Until now
// neither mode could do this at all - only create new relationships.
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

// Shared by handleTextPrompt and handleVoicePrompt: applies classesToDelete, attributesToRemove,
// methodsToRemove, classesModified and classesGenerated against the diagram's nodes, in that
// order, within a single in-memory `existingNodes` snapshot that is kept up to date after every
// write. Centralizing this (instead of duplicating it per-handler, as before) fixes two bugs at
// once: (1) text and voice can no longer drift apart, since there is only one implementation left
// to fix; (2) previously each handler re-read a STALE copy of a class's attributes/methods in
// every one of these five blocks, so e.g. "editing" an attribute - which the AI expresses as
// removing the old one in attributesToRemove AND adding the new one via classesModified in the
// SAME response, per the system prompt - silently undid itself: the classesModified block still
// saw the pre-removal attribute list and overwrote the DB with it, restoring the attribute the
// attributesToRemove block had just deleted a moment earlier in the same request.
async function applyClassMutations(
  diagramId: string,
  existingNodes: any[],
  aiResponse: any
): Promise<{ createdNodes: any[]; updatedNodes: any[]; deletedNodeIds: string[] }> {
  const createdNodes: any[] = [];
  const updatedNodes: any[] = [];
  const deletedNodeIds: string[] = [];

  // classesToDelete
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

  // attributesToRemove
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

  // methodsToRemove
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

  // classesModified (add attributes/methods to an existing class)
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

  // classesGenerated (create a new class, or merge into an existing same-named one)
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

  // classesToRename - processed LAST so any attribute/method/merge operation earlier in this same
  // response (which necessarily still refers to the class by its pre-rename name, since that's
  // what Current Canvas Diagram Context showed the model) resolves correctly before the name
  // changes. Relationships are unaffected: connectors reference nodes by DB id, not by name.
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

  // classesToReposition - moves an existing class to new canvas coordinates. Gemini computes
  // positionX/positionY using the current positions already included in Current Canvas Diagram
  // Context (see buildDiagramContext), so it can reason about relative moves ("ponla a la derecha
  // de Y") as well as absolute ones ("colócala en x:400, y:300").
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

    // Save & broadcast the prompt first so collaborators see it right away
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

    // Only the owner or collaborators of the project can read its shared AI chat
    if (!(await userCanAccessProject(projectId, userId))) {
      res.status(403).json({ error: 'No tienes acceso al historial de este proyecto.' });
      return;
    }

    // "New Chat → Para mí": hide everything before this user's own reset
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

// New Chat: scope=me resets the chat only for the requesting user; scope=all wipes the
// project's AI chat history for every member and notifies the connected collaborators.
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

