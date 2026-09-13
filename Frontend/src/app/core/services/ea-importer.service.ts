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

    const hiddenElementIds = new Set<string>();

    // 0. PARSE DIAGRAM GEOMETRY (<element geometry="Left=...;Top=...;" subject="EAID_..."/>)
    const diagElements = getElements('element');
    for (const dEl of diagElements) {
      const geom = dEl.getAttribute('geometry');
      const subject = dEl.getAttribute('subject') || dEl.getAttribute('xmi:idref');
      const style = dEl.getAttribute('style') || '';

      if (style.includes('Hidden=1') && subject) {
        hiddenElementIds.add(subject);
        hiddenElementIds.add(subject.toLowerCase());
      }

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
        // Skip only if this exact xmi:id was already parsed
        if (nodeMap.has(id)) continue;

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

        // Check if geometry exists for this specific xmi:id / subject
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
        nodeMap.set(id.toLowerCase(), newNode);
        if (!nodeMap.has(name)) {
          nodeMap.set(name, newNode);
          nodeMap.set(name.toLowerCase(), newNode);
        }
      }
    }

    // 2. PARSE EA CONNECTORS (<connector xmi:idref="..."> or <packagedElement xmi:type="uml:Association"> or <packagedElement xmi:type="uml:AssociationClass">)
    const assocNodes = [...getElements('connector'), ...getElements('packagedElement'), ...getElements('generalization'), ...getElements('realization'), ...getElements('realisation')];

    for (let i = 0; i < assocNodes.length; i++) {
      const el = assocNodes[i];
      const connId = el.getAttribute('xmi:idref') || el.getAttribute('xmi:id') || el.getAttribute('id') || '';

      if (connId && (hiddenElementIds.has(connId) || hiddenElementIds.has(connId.toLowerCase()))) {
        // Skip hidden connectors explicitly suppressed in Enterprise Architect diagram view
        continue;
      }

      const type = el.getAttribute('xmi:type') || el.getAttribute('type') || '';
      const tagName = el.tagName.toLowerCase();
      const allProps = Array.from(el.getElementsByTagName('properties'));
      const connPropsEl = allProps.find(p => p.parentElement === el || p.getAttribute('ea_type') || p.getAttribute('associationClass') || p.getAttribute('associationClassNodeId')) || allProps[0];
      const extPropsEl = el.getElementsByTagName('extendedProperties')[0];

      const eaType = connPropsEl ? (connPropsEl.getAttribute('ea_type') || '') : '';
      const subType = connPropsEl ? (connPropsEl.getAttribute('subType') || '') : '';

      let assocClassAttr = (extPropsEl ? (extPropsEl.getAttribute('associationclass') || extPropsEl.getAttribute('associationClass')) : null) ||
                          (connPropsEl ? (connPropsEl.getAttribute('associationClass') || connPropsEl.getAttribute('associationClassNodeId') || connPropsEl.getAttribute('associationclass')) : null) ||
                          el.getAttribute('associationClass') || el.getAttribute('associationClassNodeId') || el.getAttribute('associationclass');

      const isAssocClass = type.includes('AssociationClass') || tagName.includes('associationclass');
      if (isAssocClass && !assocClassAttr) {
        assocClassAttr = connId;
      }

      const isAssociation = type.includes('Association') || isAssocClass;
      const isGeneralization = type.includes('Generalization') || type.includes('Realisation') || type.includes('Realization') || tagName.includes('generalization') || tagName.includes('realization') || tagName.includes('realisation');

      if (isAssociation || isGeneralization || eaType) {
        let srcId = '';
        let tgtId = '';
        let srcMult = '';
        let tgtMult = '';
        let connType = 'Association';

        const sourceEl = el.getElementsByTagName('source')[0];
        const targetEl = el.getElementsByTagName('target')[0];

        const targetTypeEl = targetEl ? targetEl.getElementsByTagName('type')[0] : null;
        const sourceTypeEl = sourceEl ? sourceEl.getElementsByTagName('type')[0] : null;

        const targetAgg = (targetEl?.getAttribute('aggregation') || targetTypeEl?.getAttribute('aggregation') || '').toLowerCase();
        const sourceAgg = (sourceEl?.getAttribute('aggregation') || sourceTypeEl?.getAttribute('aggregation') || '').toLowerCase();
        const rootAgg = (el.getAttribute('aggregation') || '').toLowerCase();
        const rootSubType = (el.getAttribute('subType') || el.getAttribute('subtype') || '').toLowerCase();

        let ownedEndAgg = '';
        const ownedEnds = el.getElementsByTagName('ownedEnd');
        for (let k = 0; k < ownedEnds.length; k++) {
          const endTypeEl = ownedEnds[k].getElementsByTagName('type')[0];
          const agg = ownedEnds[k].getAttribute('aggregation') || endTypeEl?.getAttribute('aggregation');
          if (agg) {
            ownedEndAgg = agg.toLowerCase();
            break;
          }
        }

        const isComposite = eaType.includes('Composition') || 
                            targetAgg === 'composite' || 
                            sourceAgg === 'composite' || 
                            rootAgg === 'composite' || 
                            ownedEndAgg === 'composite' || 
                            rootSubType.includes('strong') ||
                            rootSubType.includes('composition');

        const isShared = eaType.includes('Aggregation') || 
                         targetAgg === 'shared' || 
                         sourceAgg === 'shared' || 
                         rootAgg === 'shared' || 
                         ownedEndAgg === 'shared' || 
                         rootSubType.includes('weak') ||
                         rootSubType.includes('aggregation');

        if (isGeneralization || eaType.includes('Generalization') || eaType.includes('Inheritance') || eaType.includes('Realisation') || eaType.includes('Realization')) {
          connType = 'Inheritance';
        } else if (isComposite) {
          connType = 'Composition';
        } else if (isShared) {
          connType = 'Aggregation';
        }

        if (sourceEl && targetEl) {
          srcId = sourceEl.getAttribute('xmi:idref') || sourceEl.getAttribute('idref') || sourceEl.getAttribute('id') || '';
          if (!srcId) {
            const modelChild = sourceEl.getElementsByTagName('model')[0];
            if (modelChild) srcId = modelChild.getAttribute('name') || modelChild.getAttribute('ea_localid') || '';
          }

          tgtId = targetEl.getAttribute('xmi:idref') || targetEl.getAttribute('idref') || targetEl.getAttribute('id') || '';
          if (!tgtId) {
            const modelChild = targetEl.getElementsByTagName('model')[0];
            if (modelChild) tgtId = modelChild.getAttribute('name') || modelChild.getAttribute('ea_localid') || '';
          }

          if (connType !== 'Inheritance') {
            srcMult = this.extractMultiplicityWithVisibility(sourceEl, false, el);
            tgtMult = this.extractMultiplicityWithVisibility(targetEl, true, el);
          }
        } else {
          const ends = el.getElementsByTagName('ownedEnd');
          if (ends.length >= 2) {
            srcId = ends[0].getAttribute('type') || ends[0].getAttribute('xmi:idref') || '';
            tgtId = ends[1].getAttribute('type') || ends[1].getAttribute('xmi:idref') || '';
            if (connType !== 'Inheritance') {
              srcMult = this.extractMultiplicityWithVisibility(ends[0], false, el);
              tgtMult = this.extractMultiplicityWithVisibility(ends[1], true, el);
            }
          } else if (isGeneralization) {
            srcId = el.getAttribute('client') || el.parentElement?.getAttribute('xmi:id') || el.parentElement?.getAttribute('id') || '';
            tgtId = el.getAttribute('supplier') || el.getAttribute('general') || el.getAttribute('xmi:idref') || '';
          }
        }

        // Map srcId and tgtId to resolved node IDs if available
        const srcNode = nodeMap.get(srcId) || nodeMap.get(srcId.toLowerCase());
        const tgtNode = nodeMap.get(tgtId) || nodeMap.get(tgtId.toLowerCase());
        const assocNode = assocClassAttr ? (nodeMap.get(assocClassAttr) || nodeMap.get(assocClassAttr.toLowerCase())) : undefined;

        if (srcNode && tgtNode) {
          const assocClassIdResolved = assocNode ? assocNode.id : (assocClassAttr || undefined);

          const isReflexive = srcNode.id === tgtNode.id;

          const existingConn = isReflexive ? null : connectors.find(c =>
            (c.sourceNodeId === srcNode.id && c.targetNodeId === tgtNode.id) ||
            (c.sourceNodeId === tgtNode.id && c.targetNodeId === srcNode.id)
          );

          if (existingConn) {
            if (assocClassIdResolved) {
              existingConn.associationClassNodeId = assocClassIdResolved;
            }
            if (srcMult) existingConn.sourceMultiplicity = srcMult;
            if (tgtMult) existingConn.targetMultiplicity = tgtMult;
            if (connType !== 'Association' && existingConn.type === 'Association') {
              existingConn.type = connType;
            }
          } else {
            connectors.push({
              id: connId || `conn_${Date.now()}_${i}`,
              sourceNodeId: srcNode.id,
              targetNodeId: tgtNode.id,
              type: connType,
              sourceMultiplicity: srcMult,
              targetMultiplicity: tgtMult,
              label: el.getAttribute('name') || '',
              associationClassNodeId: assocClassIdResolved
            });
          }
        }
      }
    }

    return {
      projectName: cleanProjectName,
      nodes,
      connectors
    };
  }

  private extractMultiplicityWithVisibility(endpointEl: Element, isTarget: boolean = false, connectorEl?: Element): string {
    if (!endpointEl) return '';

    let rawMult = endpointEl.getAttribute('multiplicity') || endpointEl.getAttribute('bounds') || '';

    // 1. Enterprise Architect <role name="1..*" visibility="Public"/>
    if (!rawMult) {
      const roleEl = endpointEl.getElementsByTagName('role')[0];
      if (roleEl && roleEl.getAttribute('name')) {
        rawMult = roleEl.getAttribute('name') || '';
      }
    }

    // 2. Enterprise Architect <labels lt="+1..*" rt="+0..*"/>
    if (!rawMult && connectorEl) {
      const labelsEl = connectorEl.getElementsByTagName('labels')[0];
      if (labelsEl) {
        const attrVal = isTarget ? (labelsEl.getAttribute('rt') || labelsEl.getAttribute('rb')) : (labelsEl.getAttribute('lt') || labelsEl.getAttribute('lb'));
        if (attrVal) {
          rawMult = attrVal;
        }
      }
    }

    // 3. Enterprise Architect <properties lowerBound="..." upperBound="..."/>
    if (!rawMult) {
      const allProps = Array.from(endpointEl.getElementsByTagName('properties'));
      const props = allProps.find(p => p.getAttribute('lowerBound') || p.getAttribute('upperBound') || p.getAttribute('lower') || p.getAttribute('upper')) || allProps[0];
      if (props) {
        const lowerB = props.getAttribute('lowerBound') || props.getAttribute('lower');
        const upperB = props.getAttribute('upperBound') || props.getAttribute('upper');
        if (lowerB || upperB) {
          if (lowerB && upperB && lowerB !== upperB) {
            rawMult = `${lowerB}..${upperB}`;
          } else {
            rawMult = lowerB || upperB || '';
          }
        }
      }
    }

    // 4. Search all descendants for a 'multiplicity' or 'lowerBound'/'upperBound' attribute
    if (!rawMult) {
      const allDescendants = Array.from(endpointEl.getElementsByTagName('*'));
      for (const desc of allDescendants) {
        if (desc.getAttribute('multiplicity')) {
          rawMult = desc.getAttribute('multiplicity') || '';
          break;
        }
        const lb = desc.getAttribute('lowerBound') || desc.getAttribute('lower');
        const ub = desc.getAttribute('upperBound') || desc.getAttribute('upper');
        if (lb || ub) {
          rawMult = (lb && ub && lb !== ub) ? `${lb}..${ub}` : (lb || ub || '');
          break;
        }
      }
    }

    // 5. Search lowerValue and upperValue
    if (!rawMult) {
      const lowerEl = endpointEl.getElementsByTagName('lowerValue')[0];
      const upperEl = endpointEl.getElementsByTagName('upperValue')[0];
      const lower = lowerEl ? (lowerEl.getAttribute('value') || lowerEl.getAttribute('body')) : '';
      const upper = upperEl ? (upperEl.getAttribute('value') || upperEl.getAttribute('body')) : '';
      if (lower || upper) {
        rawMult = (lower && upper && lower !== upper) ? `${lower}..${upper}` : (lower || upper || '');
      }
    }

    if (!rawMult) return '';

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
