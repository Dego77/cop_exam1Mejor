import { Injectable } from '@angular/core';
import { UMLNode, UMLConnector } from './diagram.service';

@Injectable({ providedIn: 'root' })
export class EaExporterService {
  activeFileHandle: any = null;
  activeFileName: string = '';

  private toEaGuid(rawId: string): string {
    if (!rawId) return 'EAID_11111111_2222_3333_4444_555555555555';

    // Pasa TODO el texto por 4 hashes independientes para que cada carácter
    // influya en el resultado. El método viejo (hex concatenado y substring(0, 32))
    // solo miraba los primeros ~16 caracteres de rawId, así que `toEaGuid(node.id)`
    // chocaba con `toEaGuid(`${node.id}_attr_...`)` cuando node.id ya era un UUID
    // de 36 caracteres (nodos guardados de verdad): el sufijo "_attr_..." quedaba
    // fuera de esa ventana y el atributo salía con el MISMO xmi:id que su clase.
    let h1 = 0x811c9dc5, h2 = 0x01000193, h3 = 0x9e3779b9, h4 = 0x85ebca6b;
    for (let i = 0; i < rawId.length; i++) {
      const c = rawId.charCodeAt(i);
      h1 = ((h1 ^ c) * 0x01000193) >>> 0;
      h2 = ((h2 + c) * 0x9e3779b9) >>> 0;
      h3 = ((h3 ^ (c << (i % 24))) * 0x85ebca6b) >>> 0;
      h4 = ((h4 + (c * (i + 1))) * 0xc2b2ae35) >>> 0;
    }
    const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
    const clean = (hex(h1) + hex(h2) + hex(h3) + hex(h4)).substring(0, 32).toUpperCase();
    return `EAID_${clean.substring(0, 8)}_${clean.substring(8, 12)}_${clean.substring(12, 16)}_${clean.substring(16, 20)}_${clean.substring(20, 32)}`;
  }

  // Resuelve el id real de la caja de una clase de asociación. Normalmente
  // conn.associationClassNodeId ya apunta a un nodo guardado, pero si el conector
  // se guardó con el flujo optimista de diagram.service.ts (id temporal primero,
  // reconciliar después), ese campo puede quedar con un id viejo del cliente
  // (por ejemplo "node_assoc_...") que nunca pasó al UUID real (ver tempToRealIdMap
  // y saveCurrentDiagram). En ese caso se usa el mismo empareje por nombre que
  // getAssocClassNode() de canvas.component.ts usa para dibujar la línea punteada,
  // así la exportación coincide con lo que se ve en el lienzo.
  private resolveAssocClassNodeId(
    conn: UMLConnector,
    nodes: UMLNode[],
    nodeMap: Map<string, { node: UMLNode; eaId: string; localId: number }>
  ): string | undefined {
    if (conn.associationClassNodeId && nodeMap.has(conn.associationClassNodeId)) {
      return conn.associationClassNodeId;
    }
    if (conn.type === 'AssociationClass' || conn.associationClassNodeId) {
      const source = nodeMap.get(conn.sourceNodeId)?.node;
      const target = nodeMap.get(conn.targetNodeId)?.node;
      if (source && target) {
        const name1 = `${source.name}_${target.name}`.toLowerCase();
        const name2 = `${target.name}_${source.name}`.toLowerCase();
        const match = nodes.find(n =>
          n.stereotype === 'AssociationClass' &&
          (n.name?.toLowerCase() === name1 || n.name?.toLowerCase() === name2)
        );
        if (match) return match.id;
      }
      const anyAssoc = nodes.find(n => n.stereotype === 'AssociationClass');
      if (anyAssoc) return anyAssoc.id;
    }
    return undefined;
  }

  private buildMultiplicityXml(multStr: string, idPrefix: string): { lowVal: string; uppVal: string; eaTypeMult: string } {
    if (!multStr) {
      return { lowVal: '', uppVal: '', eaTypeMult: '' };
    }

    // 1. Limpiar prefijos de visibilidad (+, -, #, ~) y espacios
    const clean = multStr.trim().replace(/^[+\-#~]\s*/, '');

    if (!clean) {
      return { lowVal: '', uppVal: '', eaTypeMult: '' };
    }

    let low = '';
    let upp = '';
    let eaTypeMult = clean;

    if (clean === '1') {
      low = '1';
      upp = '1';
    } else if (clean === '*' || clean === 'n' || clean === 'N' || clean === '0..*') {
      low = '0';
      upp = '*';
      eaTypeMult = clean === '0..*' ? '0..*' : '*';
    } else if (clean === '1..*') {
      low = '1';
      upp = '*';
    } else if (clean === '0..1') {
      low = '0';
      upp = '1';
    } else if (clean === '0') {
      low = '0';
      upp = '0';
    } else if (clean.includes('..')) {
      const parts = clean.split('..');
      low = parts[0].trim();
      upp = parts[1].trim();
    } else if (!isNaN(Number(clean))) {
      low = clean;
      upp = clean;
    } else {
      low = clean;
      upp = clean;
    }

    let lowVal = '';
    let uppVal = '';

    if (low !== '') {
      if (!isNaN(Number(low))) {
        lowVal = `<lowerValue xmi:type="uml:LiteralInteger" xmi:id="${idPrefix}_low" value="${low}"/>`;
      } else {
        lowVal = `<lowerValue xmi:type="uml:LiteralString" xmi:id="${idPrefix}_low" value="${low}"/>`;
      }
    }

    if (upp !== '') {
      if (upp === '*') {
        uppVal = `<upperValue xmi:type="uml:LiteralUnlimitedNatural" xmi:id="${idPrefix}_upp" value="*"/>`;
      } else if (!isNaN(Number(upp))) {
        uppVal = `<upperValue xmi:type="uml:LiteralInteger" xmi:id="${idPrefix}_upp" value="${upp}"/>`;
      } else {
        uppVal = `<upperValue xmi:type="uml:LiteralString" xmi:id="${idPrefix}_upp" value="${upp}"/>`;
      }
    }

    return { lowVal, uppVal, eaTypeMult };
  }

  generateXMI(projectName: string, nodes: UMLNode[], connectors: UMLConnector[]): string {
    const timestamp = new Date().toISOString();
    const cleanProjName = projectName || 'Logical View';
    const modelEaId = this.toEaGuid(`Model_${cleanProjName}`);
    const packageEaId = this.toEaGuid(`Package_${cleanProjName}`);
    const diagramEaId = this.toEaGuid(`Diagram_${cleanProjName}`);

    let classesXml = '';
    let elementsExtensionXml = '';
    let diagramElementsXml = '';

    // Mapa con los datos de cada nodo para resolver los conectores
    const nodeMap = new Map<string, { node: UMLNode; eaId: string; localId: number }>();
    const generalizationMap = new Map<string, { parentEaId: string; genEaId: string }[]>();

    if (nodes && nodes.length > 0) {
      nodes.forEach((node, idx) => {
        const nodeEaId = this.toEaGuid(node.id || `node_${idx}`);
        nodeMap.set(node.id, { node, eaId: nodeEaId, localId: idx + 10 });
      });
    }

    // Preprocesar conectores para detectar generalizaciones (herencia)
    if (connectors && connectors.length > 0) {
      connectors.forEach((conn, idx) => {
        if (conn.type === 'Inheritance') {
          const childEaId = conn.sourceNodeId;
          const parentInfo = nodeMap.get(conn.targetNodeId);
          if (parentInfo) {
            const genEaId = this.toEaGuid(`gen_${conn.id || idx}`);
            const existing = generalizationMap.get(childEaId) || [];
            existing.push({ parentEaId: parentInfo.eaId, genEaId });
            generalizationMap.set(childEaId, existing);
          }
        }
      });
    }

    // Preprocesar conectores para detectar nodos que son clases de asociación
    // (la entidad intermedia de un muchos a muchos). Esos nodos se exportan como un
    // solo uml:AssociationClass, no como un uml:Class suelto. Si no, Enterprise Architect
    // no tiene forma estándar de saber que la clase va atada a esa relación.
    const assocClassNodeIds = new Set<string>();
    // Mapa de id del nodo de clase de asociación -> id de EA del conector visual APARTE
    // (la línea Association entre las dos entidades reales). Enterprise Architect exige que
    // sea un elemento distinto de la caja AssociationClass. Reusar el mismo id impide que
    // EA dibuje la arista de ese enlace (ver más abajo).
    const assocClassLinkEaId = new Map<string, string>();
    if (connectors && connectors.length > 0) {
      connectors.forEach((conn, idx) => {
        const resolvedId = this.resolveAssocClassNodeId(conn, nodes || [], nodeMap);
        if (resolvedId) {
          assocClassNodeIds.add(resolvedId);
          assocClassLinkEaId.set(resolvedId, this.toEaGuid(conn.id || `conn_${idx}`));
        }
      });
    }
    const assocClassContentMap = new Map<string, { attrsXml: string; methodsXml: string; generalizationsXml: string }>();

    // 1. Mapeo de todos los nodos y clases
    if (nodes && nodes.length > 0) {
      nodes.forEach((node, idx) => {
        const nodeInfo = nodeMap.get(node.id)!;
        const nodeEaId = nodeInfo.eaId;
        const isAssocClassNode = assocClassNodeIds.has(node.id);

        // Leer generalizaciones (herencia) dentro de la clase
        let generalizationsXml = '';
        const gens = generalizationMap.get(node.id);
        if (gens && gens.length > 0) {
          gens.forEach(g => {
            generalizationsXml += `
            <generalization xmi:type="uml:Generalization" xmi:id="${g.genEaId}" general="${g.parentEaId}"/>`;
          });
        }

        // Leer atributos
        let attrsXml = '';
        if (node.attributes && node.attributes.length > 0) {
          node.attributes.forEach((attr, aIdx) => {
            const attrEaId = this.toEaGuid(`${node.id}_attr_${aIdx}_${attr.name}`);
            const vis = attr.visibility === '-' ? 'private' : attr.visibility === '#' ? 'protected' : 'public';
            attrsXml += `
            <ownedAttribute xmi:type="uml:Property" xmi:id="${attrEaId}" name="${attr.name}" visibility="${vis}">
              <type xmi:type="uml:PrimitiveType" href="http://schema.omg.org/spec/UML/2.1/uml.xml#${attr.type || 'String'}"/>
            </ownedAttribute>`;
          });
        }

        // Leer métodos y operaciones
        let methodsXml = '';
        if (node.methods && node.methods.length > 0) {
          node.methods.forEach((m, mIdx) => {
            const methodEaId = this.toEaGuid(`${node.id}_m_${mIdx}_${m.name}`);
            const retEaId = this.toEaGuid(`${node.id}_m_${mIdx}_ret`);
            const vis = m.visibility === '-' ? 'private' : m.visibility === '#' ? 'protected' : 'public';
            methodsXml += `
            <ownedOperation xmi:type="uml:Operation" xmi:id="${methodEaId}" name="${m.name}" visibility="${vis}">
              <ownedParameter xmi:type="uml:Parameter" xmi:id="${retEaId}" direction="return">
                <type xmi:type="uml:PrimitiveType" href="http://schema.omg.org/spec/UML/2.1/uml.xml#${m.returnType || 'void'}"/>
              </ownedParameter>
            </ownedOperation>`;
          });
        }

        if (isAssocClassNode) {
          // Se aplaza: se fusiona en un solo packagedElement uml:AssociationClass, con sus
          // extremos, cuando se procese el conector dueño (paso 2). En el metamodelo UML una
          // clase de asociación es UN elemento, no una clase más un enlace.
          assocClassContentMap.set(node.id, { attrsXml, methodsXml, generalizationsXml });
        } else {
          // Elemento UML de clase estándar (incluye los enlaces de generalización, si hay)
          classesXml += `
        <packagedElement xmi:type="uml:Class" xmi:id="${nodeEaId}" name="${node.name}">
          ${generalizationsXml}
          ${attrsXml}
          ${methodsXml}
        </packagedElement>`;
        }

        // Definición de elemento de la extensión de Enterprise Architect. El propio EA exporta
        // la caja de una clase de asociación como xmi:type="uml:Class" (no uml:AssociationClass),
        // marcada con ntype="17", más un conID que apunta al conector del enlace de abajo.
        // Copiar esa salida real (comprobada con XML exportados por EA) es lo que hace que,
        // al importar, EA dibuje la línea punteada de vuelta a esta caja.
        const assocLinkId = isAssocClassNode ? assocClassLinkEaId.get(node.id) : undefined;
        elementsExtensionXml += `
        <element xmi:idref="${nodeEaId}" xmi:type="uml:Class" name="${node.name}" scope="public">
          <model package="${packageEaId}" tpos="${idx}" ea_localid="${nodeInfo.localId}"/>
          <properties stereotype="${node.stereotype || 'Entity'}" isSpecification="false" sType="Class" ntype="${isAssocClassNode ? '17' : '0'}"/>
          <extendedProperties package_name="Logical View"${assocLinkId ? ` conID="${assocLinkId}"` : ''}/>
        </element>`;

        // Posición visual del diagrama en Enterprise Architect
        const left = Math.round(node.positionX || (100 + idx * 240));
        const top = Math.round(node.positionY || (100 + (idx % 2) * 180));
        const right = left + 220;
        const bottom = top + 150;

        diagramElementsXml += `
          <element geometry="Left=${left};Top=${top};Right=${right};Bottom=${bottom};" subject="${nodeEaId}" seqno="${idx + 1}" style="DUG=0;"/>`;
      });
    }

    // 2. Mapeo de todos los conectores y relaciones
    let connectorsXml = '';
    let connectorsExtensionXml = '';

    if (connectors && connectors.length > 0) {
      connectors.forEach((conn, idx) => {
        const srcInfo = nodeMap.get(conn.sourceNodeId);
        const tgtInfo = nodeMap.get(conn.targetNodeId);
        const resolvedAssocNodeId = this.resolveAssocClassNodeId(conn, nodes || [], nodeMap);
        const assocInfo = resolvedAssocNodeId ? nodeMap.get(resolvedAssocNodeId) : undefined;
        const isAssocClassConn = !!(assocInfo && assocClassNodeIds.has(assocInfo.node.id));

        // La caja AssociationClass (assocInfo.eaId) y la LÍNEA Association entre las dos
        // entidades reales son dos elementos distintos de EA. Se comprobó con XML exportados
        // de verdad por Enterprise Architect (scratch_xml/*.xml): la línea lleva su propio id
        // y un <extendedProperties associationclass="..."/> que apunta a la caja. Reusar un
        // solo id (como antes) deja la línea sin geometría, y EA dibuja la caja sin unirla
        // a las dos clases.
        const connEaId = this.toEaGuid(conn.id || `conn_${idx}`);

        const srcEaId = srcInfo ? srcInfo.eaId : this.toEaGuid(conn.sourceNodeId);
        const tgtEaId = tgtInfo ? tgtInfo.eaId : this.toEaGuid(conn.targetNodeId);

        const srcName = srcInfo ? srcInfo.node.name : 'SourceClass';
        const tgtName = tgtInfo ? tgtInfo.node.name : 'TargetClass';

        const srcLocalId = srcInfo ? srcInfo.localId : idx + 1;
        const tgtLocalId = tgtInfo ? tgtInfo.localId : idx + 2;

        let connUmlType = 'uml:Association';
        let eaType = 'Association';
        let subTypeAttr = '';
        let aggregationValue = '';

        switch (conn.type) {
          case 'Inheritance':
            connUmlType = 'uml:Generalization';
            eaType = 'Generalization';
            break;
          case 'Implementation':
            connUmlType = 'uml:Realization';
            eaType = 'Realisation';
            break;
          case 'Dependency':
            connUmlType = 'uml:Dependency';
            eaType = 'Dependency';
            break;
          case 'Aggregation':
            connUmlType = 'uml:Association';
            eaType = 'Aggregation';
            subTypeAttr = 'subType="Weak"';
            aggregationValue = 'shared';
            break;
          case 'Composition':
            connUmlType = 'uml:Association';
            eaType = 'Aggregation';
            subTypeAttr = 'subType="Strong"';
            aggregationValue = 'composite';
            break;
          default:
            connUmlType = 'uml:Association';
            eaType = 'Association';
            break;
        }

        if (isAssocClassConn) {
          connUmlType = 'uml:AssociationClass';
        }

        const isStructuralAssoc = conn.type === 'Association' || !conn.type;
        const isWholePart = conn.type === 'Aggregation' || conn.type === 'Composition';
        // El rombo siempre se dibuja en el extremo DESTINO del conector (ver
        // getDiamondPoints() -> getTargetEndpoint() en canvas.component.ts). Por convención
        // UML la clase destino es el "todo" y la origen es la "parte". Si el usuario dejó
        // vacía la multiplicidad de una agregación o composición, se usa esa lectura
        // todo/parte en vez de exportar una multiplicidad vacía y ambigua.
        const defaultSrcMult = isStructuralAssoc ? '1' : (isWholePart ? '0..*' : '');
        const defaultTgtMult = isStructuralAssoc ? '*' : (isWholePart ? '1' : '');

        const rawSrcMult = (conn.sourceMultiplicity !== undefined && conn.sourceMultiplicity !== '') ? conn.sourceMultiplicity : defaultSrcMult;
        const rawTgtMult = (conn.targetMultiplicity !== undefined && conn.targetMultiplicity !== '') ? conn.targetMultiplicity : defaultTgtMult;

        const srcMult = this.buildMultiplicityXml(rawSrcMult, `${connEaId}_src`);
        const tgtMult = this.buildMultiplicityXml(rawTgtMult, `${connEaId}_tgt`);

        // En UML2 el tipo de agregación va en el ownedEnd de la "parte" (aquí el origen;
        // ver la nota de arriba): la propiedad cuyo tipo es la clase agregada lleva
        // aggregation="shared" o "composite", y el extremo del "todo" (destino) queda en "none".
        const srcAggAttr = aggregationValue ? ` aggregation="${aggregationValue}"` : '';

        // El EA real pone esto en <extendedProperties> del conector de la LÍNEA, no en
        // <properties>, y el atributo va en minúsculas: "associationclass".
        const assocClassExtProps = isAssocClassConn ? ` associationclass="${assocInfo!.eaId}"` : '';
        const assocSubtypeAttr = isAssocClassConn ? 'subtype="Class"' : '';

        // Association o AssociationClass de UML 2.1 en packagedElement (memberEnd y type xmi:idref).
        // En una clase de asociación ese packagedElement ES la clase y la asociación, así que
        // usa el id de la caja (assocInfo.eaId), no el connEaId de la línea visual aparte.
        if (conn.type !== 'Inheritance') {
          let assocClassMembersXml = '';
          const pkgElId = isAssocClassConn ? assocInfo!.eaId : connEaId;
          if (isAssocClassConn) {
            const content = assocClassContentMap.get(assocInfo!.node.id);
            assocClassMembersXml = `
          ${content ? content.generalizationsXml : ''}
          ${content ? content.attrsXml : ''}
          ${content ? content.methodsXml : ''}`;
          }

          connectorsXml += `
        <packagedElement xmi:type="${connUmlType}" xmi:id="${pkgElId}" name="${isAssocClassConn ? assocInfo!.node.name : (conn.label || '')}" memberEnd="${connEaId}_src ${connEaId}_tgt">
          <ownedEnd xmi:type="uml:Property" xmi:id="${connEaId}_src" visibility="public" association="${pkgElId}"${srcAggAttr}>
            <type xmi:idref="${srcEaId}"/>
            ${srcMult.lowVal}
            ${srcMult.uppVal}
          </ownedEnd>
          <ownedEnd xmi:type="uml:Property" xmi:id="${connEaId}_tgt" visibility="public" association="${pkgElId}">
            <type xmi:idref="${tgtEaId}"/>
            ${tgtMult.lowVal}
            ${tgtMult.uppVal}
          </ownedEnd>${assocClassMembersXml}
        </packagedElement>`;
        }

        // Definición de conector de la extensión de Enterprise Architect, con <model type="Class"/> explícito.
        // Siempre es la LÍNEA visual aparte (su propio connEaId), también en una clase de asociación.
        connectorsExtensionXml += `
        <connector xmi:idref="${connEaId}" name="${isAssocClassConn ? '' : (conn.label || '')}">
          <source xmi:idref="${srcEaId}">
            <model type="Class" name="${srcName}" ea_localid="${srcLocalId}"/>
            <role visibility="Public"/>
            <type multiplicity="${srcMult.eaTypeMult}" aggregation="${aggregationValue}"/>
          </source>
          <target xmi:idref="${tgtEaId}">
            <model type="Class" name="${tgtName}" ea_localid="${tgtLocalId}"/>
            <role visibility="Public"/>
            <type multiplicity="${tgtMult.eaTypeMult}"/>
          </target>
          <properties ea_type="${eaType}" ${subTypeAttr} ${assocSubtypeAttr} direction="${conn.type === 'Inheritance' ? 'Source -> Destination' : 'Unspecified'}"/>
          <extendedProperties virtualInheritance="0"${assocClassExtProps}/>
          <appearance linemode="3" linecolor="-1" linewidth="0" seqno="0" headstyle="0" linestyle="0"/>
        </connector>`;

        // Posición visual de la línea en el diagrama de Enterprise Architect. Siempre se emite,
        // también en una clase de asociación: la línea (connEaId) y la caja (assocInfo.eaId)
        // ya son sujetos distintos, así que no choca con la geometría de la caja del bucle de nodos.
        diagramElementsXml += `
          <element geometry="SX=0;SY=0;EX=0;EY=0;Path=;" subject="${connEaId}" style="LEStyle=3;BStyle=0;"/>`;
      });
    }

    return `<?xml version="1.0" encoding="utf-8"?>
<xmi:XMI xmi:version="2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1" xmlns:xmi="http://schema.omg.org/spec/XMI/2.1">
  <xmi:Documentation exporter="Enterprise Architect" exporterVersion="15.0" created="${timestamp}"/>
  <uml:Model xmi:type="uml:Model" xmi:id="${modelEaId}" name="EA_Model">
    <packagedElement xmi:type="uml:Package" xmi:id="${packageEaId}" name="${cleanProjName}">
      ${classesXml}
      ${connectorsXml}
    </packagedElement>
  </uml:Model>
  <xmi:Extension extender="Enterprise Architect" extenderID="3.0">
    <elements>
      <element xmi:idref="${packageEaId}" xmi:type="uml:Package" name="${cleanProjName}" scope="public">
        <properties isSpecification="false" sType="Package" ntype="0"/>
        <project author="ClassForge" version="1.0" status="Proposed" created="${timestamp}" modified="${timestamp}"/>
      </element>
      ${elementsExtensionXml}
    </elements>
    <connectors>
      ${connectorsExtensionXml}
    </connectors>
    <diagrams>
      <diagram xmi:id="${diagramEaId}" name="${cleanProjName}" type="Logical">
        <model package="${packageEaId}" localID="1" type="Logical"/>
        <properties name="${cleanProjName}" type="Logical"/>
        <project author="ClassForge" version="1.0" created="${timestamp}" modified="${timestamp}"/>
        <elements>
          ${diagramElementsXml}
        </elements>
      </diagram>
    </diagrams>
  </xmi:Extension>
</xmi:XMI>`;
  }

  async promptSaveEAPFile(nodes: UMLNode[], connectors: UMLConnector[], defaultName = 'modelo_diagrama'): Promise<string | null> {
    const suggestedName = defaultName.toLowerCase().endsWith('.xml') ? defaultName : `${defaultName}.xml`;

    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName,
          types: [{
            description: 'Enterprise Architect XML Package (*.xml)',
            accept: { 'application/xml': ['.xml', '.xmi', '.eap'] }
          }]
        });

        const fileName: string = handle.name;
        const projectName = fileName.replace(/\.(xml|xmi|eap)$/i, '');
        const xmiContent = this.generateXMI(projectName, nodes, connectors);
        const blob = new Blob([xmiContent], { type: 'application/xml;charset=utf-8' });

        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();

        this.activeFileHandle = handle;
        this.activeFileName = projectName;

        return projectName;
      } catch (err: any) {
        if (err.name === 'AbortError') {
          return null; // User clicked cancel
        }
      }
    }

    // Respaldo si el navegador no tiene showSaveFilePicker
    const name = prompt('Ingrese el nombre del proyecto XML para Enterprise Architect:', defaultName);
    if (!name) return null;
    const cleanName = name.trim();
    const xmiContent = this.generateXMI(cleanName, nodes, connectors);
    this.downloadEAPFile(cleanName, xmiContent);
    return cleanName;
  }

  async saveDirectlyToActiveFile(projectName: string, nodes: UMLNode[], connectors: UMLConnector[]): Promise<boolean> {
    const xmiContent = this.generateXMI(projectName, nodes, connectors);
    const blob = new Blob([xmiContent], { type: 'application/xml;charset=utf-8' });

    if (this.activeFileHandle) {
      try {
        const writable = await this.activeFileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
      } catch (err) {
        console.warn('Could not write directly to active handle, falling back...', err);
      }
    }

    // Respaldo si no hay un manejador de archivo activo
    if ('showSaveFilePicker' in window) {
      try {
        const cleanFilename = projectName.toLowerCase().endsWith('.xml') ? projectName : `${projectName}.xml`;
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: cleanFilename,
          types: [{
            description: 'Enterprise Architect XML Package (*.xml)',
            accept: { 'application/xml': ['.xml', '.xmi', '.eap'] }
          }]
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();

        this.activeFileHandle = handle;
        this.activeFileName = projectName;
        return true;
      } catch (err: any) {
        if (err.name === 'AbortError') return false;
      }
    }

    this.triggerFallbackDownload(projectName.toLowerCase().endsWith('.xml') ? projectName : `${projectName}.xml`, blob);
    return true;
  }

  downloadEAPFile(filename: string, content: string): void {
    const cleanFilename = filename.toLowerCase().endsWith('.xml') ? filename : `${filename}.xml`;
    const blob = new Blob([content], { type: 'application/xml;charset=utf-8' });

    if ('showSaveFilePicker' in window) {
      (window as any).showSaveFilePicker({
        suggestedName: cleanFilename,
        types: [{
          description: 'Enterprise Architect XML Package (*.xml)',
          accept: { 'application/xml': ['.xml', '.xmi', '.eap'] }
        }]
      }).then((handle: any) => {
        return handle.createWritable().then((writable: any) => {
          return writable.write(blob).then(() => writable.close());
        });
      }).catch((err: any) => {
        if (err.name !== 'AbortError') {
          this.triggerFallbackDownload(cleanFilename, blob);
        }
      });
    } else {
      this.triggerFallbackDownload(cleanFilename, blob);
    }
  }

  private triggerFallbackDownload(filename: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
