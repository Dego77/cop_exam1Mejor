export interface DiagramSnapshot {
  nodes: { id: string; name: string }[];
  connectors: {
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    type?: string;
    sourceClassName?: string;
    targetClassName?: string;
  }[];
}

function asList(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

function sameName(a: unknown, b: unknown): boolean {
  return String(a || '').trim().toLocaleLowerCase() === String(b || '').trim().toLocaleLowerCase();
}

export function validateMutationPayload(payload: any, diagram: DiagramSnapshot): { payload: any; notes: string[] } {
  const notes: string[] = [];
  const next = { ...(payload || {}) };
  const nodes = diagram?.nodes || [];
  const connectors = diagram?.connectors || [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  if (asList(next.classesToDelete).length) {
    const kept: any[] = [];
    for (const entry of next.classesToDelete) {
      const nodeId = entry && typeof entry === 'object' ? entry.nodeId : undefined;
      const name = typeof entry === 'string' ? entry : entry?.name;
      if (nodeId) {
        const node = nodesById.get(nodeId);
        if (!node) {
          notes.push('No eliminé una clase porque ese id ya no está en el diagrama.');
          continue;
        }
        kept.push({ nodeId: node.id, name: node.name });
        continue;
      }
      const matches = nodes.filter((node) => sameName(node.name, name));
      if (matches.length === 1) kept.push({ nodeId: matches[0].id, name: matches[0].name });
      else if (!matches.length) notes.push(`No eliminé la clase ${name || ''} porque no está en el diagrama.`);
      else notes.push(`No eliminé la clase ${name} porque hay más de una con ese nombre.`);
    }
    next.classesToDelete = kept;
  }

  if (asList(next.classesToRename).length) {
    const kept: any[] = [];
    for (const entry of next.classesToRename) {
      const requestedId = entry?.nodeId;
      const newName = String(entry?.newName || entry?.to || '').trim();
      let node = requestedId ? nodesById.get(requestedId) : undefined;
      if (!node && entry?.oldName) {
        const matches = nodes.filter((item) => sameName(item.name, entry.oldName));
        if (matches.length === 1) node = matches[0];
        else if (matches.length > 1) {
          notes.push(`No renombré ${entry.oldName} porque hay más de una clase con ese nombre.`);
          continue;
        }
      }
      if (!node || !newName) {
        notes.push('No renombré una clase porque no está en el diagrama.');
        continue;
      }
      kept.push({ nodeId: node.id, oldName: node.name, newName });
    }
    next.classesToRename = kept;
  }

  if (asList(next.connectorsToDelete).length) {
    const kept: any[] = [];
    for (const entry of next.connectorsToDelete) {
      const connectorId = entry?.connectorId || (typeof entry === 'object' ? entry?.id : undefined);
      if (connectorId && typeof entry === 'object' && (entry.connectorId || !entry.sourceClassName)) {
        const found = connectors.find((item) => item.id === connectorId);
        if (!found) {
          notes.push('No eliminé una relación porque ese id ya no está en el diagrama.');
          continue;
        }
        kept.push({ connectorId: found.id });
        continue;
      }
      const source = entry?.sourceClassName;
      const target = entry?.targetClassName;
      const matches = connectors.filter((item) => {
        const direct = sameName(item.sourceClassName, source) && sameName(item.targetClassName, target);
        const swapped = sameName(item.sourceClassName, target) && sameName(item.targetClassName, source);
        if (!direct && !swapped) return false;
        if (entry?.type && item.type && !sameName(item.type, entry.type)) return false;
        return true;
      });
      if (matches.length === 1) kept.push({ connectorId: matches[0].id });
      else if (!matches.length) notes.push(`No eliminé la relación entre ${source || '?'} y ${target || '?'} porque no está en el diagrama.`);
      else notes.push(`Hay más de una relación entre ${source} y ${target}. No borré ninguna.`);
    }
    next.connectorsToDelete = kept;
  }

  return { payload: next, notes };
}

export function affectedConnectors(nodeId: string, diagram: DiagramSnapshot) {
  return (diagram.connectors || [])
    .filter((item) => item.sourceNodeId === nodeId || item.targetNodeId === nodeId)
    .map((item) => item.id);
}
