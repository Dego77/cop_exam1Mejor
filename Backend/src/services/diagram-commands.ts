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

const SAFE_CHANGE_KEYS = ['classesGenerated', 'classesModified', 'connectorsGenerated', 'classesToReposition'] as const;
const CRITICAL_CHANGE_KEYS = [
  'classesToDelete', 'connectorsToDelete', 'classesToRename',
  'attributesToRemove', 'methodsToRemove', 'connectorsModified',
] as const;

export interface ReviewDiagram {
  nodes: { id: string; name: string; attributes?: { name?: string }[]; methods?: { name?: string }[] }[];
  connectors: { sourceClassName?: string; targetClassName?: string; type?: string }[];
}

function memberName(item: any): string {
  return String(item?.name || '').trim();
}

function namesOf(items: { name?: string }[] | undefined): Set<string> {
  return new Set((items || []).map((item) => memberName(item).toLocaleLowerCase()).filter(Boolean));
}

export function reviewDiagramChange(payload: any, diagram: ReviewDiagram): { safe: any; critical: any; notes: string[] } {
  const notes: string[] = [];
  const source = { ...(payload || {}) };
  const nodes = diagram?.nodes || [];
  const connectors = diagram?.connectors || [];

  const generated: any[] = [];
  const modified = asList(source.classesModified).map((item) => ({ ...item }));
  for (const cls of asList(source.classesGenerated)) {
    const existing = nodes.find((node) => sameName(node.name, cls?.name));
    if (!existing) {
      generated.push(cls);
      continue;
    }
    notes.push(`La clase ${existing.name} ya está en el diagrama. No creé otra.`);
    const knownAttributes = namesOf(existing.attributes);
    const knownMethods = namesOf(existing.methods);
    const attributesToAdd = asList(cls?.attributes).filter((item) => {
      const name = memberName(item);
      if (!name) return false;
      if (knownAttributes.has(name.toLocaleLowerCase())) {
        notes.push(`La clase ${existing.name} ya tiene el atributo ${name}.`);
        return false;
      }
      return true;
    });
    const methodsToAdd = asList(cls?.methods).filter((item) => {
      const name = memberName(item);
      if (!name) return false;
      if (knownMethods.has(name.toLocaleLowerCase())) {
        notes.push(`La clase ${existing.name} ya tiene el método ${name}.`);
        return false;
      }
      return true;
    });
    if (attributesToAdd.length || methodsToAdd.length) {
      const current = modified.find((item) => sameName(item.name, existing.name));
      if (current) {
        current.attributesToAdd = [...asList(current.attributesToAdd), ...attributesToAdd];
        current.methodsToAdd = [...asList(current.methodsToAdd), ...methodsToAdd];
      } else {
        modified.push({ name: existing.name, attributesToAdd, methodsToAdd });
      }
    }
  }
  source.classesGenerated = generated;

  const keptModified: any[] = [];
  for (const mod of modified) {
    const existing = nodes.find((node) => sameName(node.name, mod?.name));
    if (!existing) {
      notes.push(`No agregué miembros a ${mod?.name || 'una clase'} porque esa clase no está en el diagrama.`);
      continue;
    }
    const knownAttributes = namesOf(existing.attributes);
    const knownMethods = namesOf(existing.methods);
    const attributesToAdd = asList(mod.attributesToAdd || mod.attributes).filter((item) => {
      const name = memberName(item);
      if (!name) return false;
      if (knownAttributes.has(name.toLocaleLowerCase())) {
        notes.push(`La clase ${existing.name} ya tiene el atributo ${name}.`);
        return false;
      }
      knownAttributes.add(name.toLocaleLowerCase());
      return true;
    });
    const methodsToAdd = asList(mod.methodsToAdd || mod.methods).filter((item) => {
      const name = memberName(item);
      if (!name) return false;
      if (knownMethods.has(name.toLocaleLowerCase())) {
        notes.push(`La clase ${existing.name} ya tiene el método ${name}.`);
        return false;
      }
      knownMethods.add(name.toLocaleLowerCase());
      return true;
    });
    if (attributesToAdd.length || methodsToAdd.length) {
      keptModified.push({ name: existing.name, attributesToAdd, methodsToAdd });
    }
  }
  source.classesModified = keptModified;

  const keptConnectors: any[] = [];
  for (const conn of asList(source.connectorsGenerated)) {
    const sourceName = conn?.sourceClassName;
    const targetName = conn?.targetClassName;
    const hasEnds = nodes.some((node) => sameName(node.name, sourceName)) && nodes.some((node) => sameName(node.name, targetName));
    if (!hasEnds) {
      notes.push(`No creé la relación entre ${sourceName || '?'} y ${targetName || '?'} porque falta una de las clases.`);
      continue;
    }
    const samePair = connectors.some((item) => {
      const direct = sameName(item.sourceClassName, sourceName) && sameName(item.targetClassName, targetName);
      const swapped = sameName(item.sourceClassName, targetName) && sameName(item.targetClassName, sourceName);
      if (!direct && !swapped) return false;
      return !conn?.type || !item.type || sameName(item.type, conn.type);
    });
    if (samePair) {
      notes.push(`La relación entre ${sourceName} y ${targetName} ya está en el diagrama. No creé otra.`);
      continue;
    }
    keptConnectors.push(conn);
  }
  source.connectorsGenerated = keptConnectors;

  const safe: any = {};
  const critical: any = {};
  for (const key of SAFE_CHANGE_KEYS) if (asList(source[key]).length) safe[key] = source[key];
  for (const key of CRITICAL_CHANGE_KEYS) if (asList(source[key]).length) critical[key] = source[key];
  return { safe, critical, notes };
}
