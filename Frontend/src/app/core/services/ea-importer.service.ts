import { Injectable } from '@angular/core';
import { UMLNode, UMLConnector } from './diagram.service';

export interface ImportedDiagram {
  projectName: string;
  nodes: UMLNode[];
  connectors: UMLConnector[];
}

@Injectable({ providedIn: 'root' })
export class EaImporterService {
  parseXMI(fileName: string, xmlString: string): ImportedDiagram {
    const cleanProjectName = fileName.replace(/\.(eap|eapx|qeax|xmi|xml)$/i, '');
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

    const nodes: UMLNode[] = [];
    const connectors: UMLConnector[] = [];
    const nodeMap = new Map<string, UMLNode>();
    const geometryMap = new Map<string, { x: number; y: number }>();

    let currentX = 120;
    let currentY = 80;

    // Helper: Find elements by local name regardless of namespace
    const getElements = (tagName: string) => {
      const list1 = Array.from(xmlDoc.getElementsByTagName(tagName));
      const list2 = Array.from(xmlDoc.getElementsByTagNameNS('*', tagName));
      const set = new Set([...list1, ...list2]);
      return Array.from(set);
    };

    // 0. PARSE DIAGRAM GEOMETRY (<element geometry="Left=...;Top=...;" subject="EAID_..."/>)
    const diagElements = getElements('element');
    for (const dEl of diagElements) {
      const geom = dEl.getAttribute('geometry');
      const subject = dEl.getAttribute('subject') || dEl.getAttribute('xmi:idref');
      if (geom && subject) {
        const leftMatch = geom.match(/Left=(-?\d+)/i);
        const topMatch = geom.match(/Top=(-?\d+)/i);
        if (leftMatch && topMatch) {
          const left = Math.abs(parseInt(leftMatch[1], 10));
          const top = Math.abs(parseInt(topMatch[1], 10));
          geometryMap.set(subject, { x: left, y: top });
        }
      }
    }

    // 1. PARSE STANDARD UML CLASSES (<packagedElement xmi:type="uml:Class"> or <element xmi:type="uml:Class">)
    const allPackaged = [...getElements('packagedElement'), ...getElements('element')];

    for (let i = 0; i < allPackaged.length; i++) {
      const el = allPackaged[i];
      const type = el.getAttribute('xmi:type') || el.getAttribute('type') || '';
      const id = el.getAttribute('xmi:id') || el.getAttribute('xmi:idref') || el.getAttribute('id') || `node_${Date.now()}_${i}`;
      const name = el.getAttribute('name') || '';

      if ((type.includes('Class') || type.includes('Interface') || type.includes('Enumeration')) && name) {
        // Skip duplicates if already parsed
        if (nodeMap.has(id) || nodeMap.has(name)) continue;

        const attributes: any[] = [];
        const methods: any[] = [];

        // Parse attributes (<ownedAttribute> or <attribute>)
        const attrNodes = [...Array.from(el.getElementsByTagName('ownedAttribute')), ...Array.from(el.getElementsByTagName('attribute'))];
        for (let j = 0; j < attrNodes.length; j++) {
          const attrEl = attrNodes[j];
          const attrName = attrEl.getAttribute('name');
          if (!attrName) continue;

          const vis = attrEl.getAttribute('visibility') || attrEl.getAttribute('scope') || 'public';
          const visibility = vis === 'private' ? '-' : vis === 'protected' ? '#' : '+';

          let attrType = 'String';
          const propsEl = attrEl.getElementsByTagName('properties')[0];
          if (propsEl && propsEl.getAttribute('type')) {
            attrType = propsEl.getAttribute('type') || 'String';
          } else {
            const typeChild = attrEl.getElementsByTagName('type')[0];
            if (typeChild) {
              const href = typeChild.getAttribute('href') || typeChild.getAttribute('name') || typeChild.getAttribute('type') || '';
              if (href.includes('#')) {
                attrType = href.split('#')[1] || 'String';
              } else if (href) {
                attrType = href;
              }
            }
          }

          attributes.push({ visibility, name: attrName, type: attrType });
        }

        // Parse methods (<ownedOperation> or <operation>)
        const methodNodes = [...Array.from(el.getElementsByTagName('ownedOperation')), ...Array.from(el.getElementsByTagName('operation'))];
        for (let k = 0; k < methodNodes.length; k++) {
          const mEl = methodNodes[k];
          const mName = mEl.getAttribute('name');
          if (!mName) continue;

          const vis = mEl.getAttribute('visibility') || mEl.getAttribute('scope') || 'public';
          const visibility = vis === 'private' ? '-' : vis === 'protected' ? '#' : '+';

          let returnType = 'void';
          const propsEl = mEl.getElementsByTagName('properties')[0];
          if (propsEl && propsEl.getAttribute('type')) {
            returnType = propsEl.getAttribute('type') || 'void';
          }

          methods.push({ visibility, name: mName, returnType });
        }

        let stereotype = 'Entity';
        if (type.includes('Interface')) stereotype = 'Interface';
        if (type.includes('Enumeration')) stereotype = 'Enum';

        // Check if geometry exists
        let pos = geometryMap.get(id);
        if (!pos) {
          pos = { x: currentX, y: currentY };
          currentX += 280;
          if (currentX > 900) {
            currentX = 120;
            currentY += 220;
          }
        }

        const newNode: UMLNode = {
          id,
          name,
          stereotype,
          positionX: pos.x,
          positionY: pos.y,
          attributes,
          methods
        };

        nodes.push(newNode);
        nodeMap.set(id, newNode);
        nodeMap.set(name, newNode);
      }
    }

    // 2. PARSE EA CONNECTORS (<connector xmi:idref="..."> or <packagedElement xmi:type="uml:Association">)
    const assocNodes = [...getElements('connector'), ...getElements('packagedElement')];

    for (let i = 0; i < assocNodes.length; i++) {
      const el = assocNodes[i];
      const type = el.getAttribute('xmi:type') || el.getAttribute('type') || '';
      const propsEl = el.getElementsByTagName('properties')[0];
      const eaType = propsEl ? propsEl.getAttribute('ea_type') : '';

      if (type.includes('Association') || type.includes('Generalization') || eaType) {
        let srcId = '';
        let tgtId = '';
        let srcMult = '';
        let tgtMult = '';
        let connType = 'Association';

        if (eaType) {
          if (eaType.includes('Generalization') || eaType.includes('Inheritance')) connType = 'Inheritance';
          else if (eaType.includes('Aggregation')) connType = 'Aggregation';
          else if (eaType.includes('Composition')) connType = 'Composition';
        }

        const sourceEl = el.getElementsByTagName('source')[0];
        const targetEl = el.getElementsByTagName('target')[0];

        if (sourceEl && targetEl) {
          srcId = sourceEl.getAttribute('xmi:idref') || sourceEl.getAttribute('idref') || '';
          tgtId = targetEl.getAttribute('xmi:idref') || targetEl.getAttribute('idref') || '';

          srcMult = this.extractMultiplicityWithVisibility(sourceEl, '1');
          tgtMult = this.extractMultiplicityWithVisibility(targetEl, '*');
        } else {
          const ends = el.getElementsByTagName('ownedEnd');
          if (ends.length >= 2) {
            srcId = ends[0].getAttribute('type') || '';
            tgtId = ends[1].getAttribute('type') || '';
            srcMult = this.extractMultiplicityWithVisibility(ends[0], '1');
            tgtMult = this.extractMultiplicityWithVisibility(ends[1], '*');
          }
        }

        // Map srcId and tgtId to resolved node IDs if available
        const srcNode = nodeMap.get(srcId);
        const tgtNode = nodeMap.get(tgtId);

        if (srcNode && tgtNode) {
          connectors.push({
            id: el.getAttribute('xmi:id') || el.getAttribute('xmi:idref') || `conn_${Date.now()}_${i}`,
            sourceNodeId: srcNode.id,
            targetNodeId: tgtNode.id,
            type: connType,
            sourceMultiplicity: srcMult || '+1',
            targetMultiplicity: tgtMult || '+*',
            label: el.getAttribute('name') || ''
          });
        }
      }
    }

    return {
      projectName: cleanProjectName,
      nodes,
      connectors
    };
  }

  private extractMultiplicityWithVisibility(endpointEl: Element, defaultMult = '1'): string {
    if (!endpointEl) return `+${defaultMult}`;

    let rawMult = endpointEl.getAttribute('multiplicity') || '';

    // Search all descendants for a 'multiplicity' attribute
    if (!rawMult) {
      const allDescendants = Array.from(endpointEl.getElementsByTagName('*'));
      for (const desc of allDescendants) {
        if (desc.getAttribute('multiplicity')) {
          rawMult = desc.getAttribute('multiplicity') || '';
          break;
        }
      }
    }

    // Search lowerValue and upperValue
    if (!rawMult) {
      const lowerEl = endpointEl.getElementsByTagName('lowerValue')[0];
      const upperEl = endpointEl.getElementsByTagName('upperValue')[0];
      const lower = lowerEl ? (lowerEl.getAttribute('value') || lowerEl.getAttribute('body')) : '';
      const upper = upperEl ? (upperEl.getAttribute('value') || upperEl.getAttribute('body')) : '';
      if (lower || upper) {
        rawMult = (lower && upper && lower !== upper) ? `${lower}..${upper}` : (lower || upper || '');
      }
    }

    // If still empty, use default (1 for source, * for target)
    if (!rawMult) {
      rawMult = defaultMult;
    }

    // Get visibility
    let vis = endpointEl.getAttribute('visibility') || '';
    const roleEl = endpointEl.getElementsByTagName('role')[0];
    if (!vis && roleEl) {
      vis = roleEl.getAttribute('visibility') || '';
    }

    let visPrefix = '+';
    if (vis.toLowerCase() === 'private' || vis === '-') visPrefix = '-';
    else if (vis.toLowerCase() === 'protected' || vis === '#') visPrefix = '#';
    else if (vis.toLowerCase() === 'public' || vis === '+') visPrefix = '+';

    if (rawMult.startsWith('+') || rawMult.startsWith('-') || rawMult.startsWith('#')) {
      return rawMult;
    }
    return `${visPrefix}${rawMult}`;
  }
}
