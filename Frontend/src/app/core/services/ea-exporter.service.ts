import { Injectable } from '@angular/core';
import { UMLNode, UMLConnector } from './diagram.service';

@Injectable({ providedIn: 'root' })
export class EaExporterService {
  activeFileHandle: any = null;
  activeFileName: string = '';

  private toEaGuid(rawId: string): string {
    if (!rawId) return 'EAID_11111111_2222_3333_4444_555555555555';
    let hashStr = '';
    for (let i = 0; i < rawId.length; i++) {
      hashStr += rawId.charCodeAt(i).toString(16);
    }
    while (hashStr.length < 32) {
      hashStr += '9a8b7c6d5e4f3a2b';
    }
    const clean = hashStr.substring(0, 32).toUpperCase();
    return `EAID_${clean.substring(0, 8)}_${clean.substring(8, 12)}_${clean.substring(12, 16)}_${clean.substring(16, 20)}_${clean.substring(20, 32)}`;
  }

  private buildMultiplicityXml(multStr: string, idPrefix: string): { lowVal: string; uppVal: string; eaTypeMult: string } {
    if (!multStr) {
      return { lowVal: '', uppVal: '', eaTypeMult: '' };
    }

    // 1. Clean visibility prefixes (+, -, #, ~) and whitespace
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

    // Map to store node information for connector resolution
    const nodeMap = new Map<string, { node: UMLNode; eaId: string; localId: number }>();
    const generalizationMap = new Map<string, { parentEaId: string; genEaId: string }[]>();

    if (nodes && nodes.length > 0) {
      nodes.forEach((node, idx) => {
        const nodeEaId = this.toEaGuid(node.id || `node_${idx}`);
        nodeMap.set(node.id, { node, eaId: nodeEaId, localId: idx + 10 });
      });
    }

    // Pre-process connectors to identify Generalizations (Inheritance)
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

    // Pre-process connectors to identify nodes that are actually "association classes"
    // (the junction/intermediate entity of a many-to-many relation). Those nodes must be
    // exported as a single merged uml:AssociationClass element instead of a standalone
    // uml:Class, otherwise Enterprise Architect has no standard way to know the class is
    // tied to the many-to-many relation between the two real entities.
    const assocClassNodeIds = new Set<string>();
    if (connectors && connectors.length > 0) {
      connectors.forEach(conn => {
        if (conn.associationClassNodeId && nodeMap.has(conn.associationClassNodeId)) {
          assocClassNodeIds.add(conn.associationClassNodeId);
        }
      });
    }
    const assocClassContentMap = new Map<string, { attrsXml: string; methodsXml: string; generalizationsXml: string }>();

    // 1. DYNAMIC MAPPING OF ALL NODES / CLASSES
    if (nodes && nodes.length > 0) {
      nodes.forEach((node, idx) => {
        const nodeInfo = nodeMap.get(node.id)!;
        const nodeEaId = nodeInfo.eaId;
        const isAssocClassNode = assocClassNodeIds.has(node.id);

        // Parse Generalizations (Inheritance) inside class
        let generalizationsXml = '';
        const gens = generalizationMap.get(node.id);
        if (gens && gens.length > 0) {
          gens.forEach(g => {
            generalizationsXml += `
            <generalization xmi:type="uml:Generalization" xmi:id="${g.genEaId}" general="${g.parentEaId}"/>`;
          });
        }

        // Parse Attributes
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

        // Parse Methods / Operations
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
          // Deferred: merged into a single uml:AssociationClass packagedElement together with
          // its association ends when the owning connector is processed below (step 2), since
          // in the UML metamodel an association class is ONE element, not a class + a link.
          assocClassContentMap.set(node.id, { attrsXml, methodsXml, generalizationsXml });
        } else {
          // Standard UML Class Element (including generalization links if any)
          classesXml += `
        <packagedElement xmi:type="uml:Class" xmi:id="${nodeEaId}" name="${node.name}">
          ${generalizationsXml}
          ${attrsXml}
          ${methodsXml}
        </packagedElement>`;
        }

        // Enterprise Architect Extension Element Definition
        elementsExtensionXml += `
        <element xmi:idref="${nodeEaId}" xmi:type="${isAssocClassNode ? 'uml:AssociationClass' : 'uml:Class'}" name="${node.name}" scope="public">
          <model package="${packageEaId}" tpos="${idx}" ea_localid="${nodeInfo.localId}"/>
          <properties stereotype="${node.stereotype || 'Entity'}" isSpecification="false" sType="Class" ntype="0"/>
          <extendedProperties package_name="Logical View"/>
        </element>`;

        // Enterprise Architect Visual Geometry Diagram Placement
        const left = Math.round(node.positionX || (100 + idx * 240));
        const top = Math.round(node.positionY || (100 + (idx % 2) * 180));
        const right = left + 220;
        const bottom = top + 150;

        diagramElementsXml += `
          <element geometry="Left=${left};Top=${top};Right=${right};Bottom=${bottom};" subject="${nodeEaId}" seqno="${idx + 1}" style="DUG=0;"/>`;
      });
    }

    // 2. DYNAMIC MAPPING OF ALL CONNECTORS / RELATIONSHIPS
    let connectorsXml = '';
    let connectorsExtensionXml = '';

    if (connectors && connectors.length > 0) {
      connectors.forEach((conn, idx) => {
        const srcInfo = nodeMap.get(conn.sourceNodeId);
        const tgtInfo = nodeMap.get(conn.targetNodeId);
        const assocInfo = conn.associationClassNodeId ? nodeMap.get(conn.associationClassNodeId) : undefined;
        const isAssocClassConn = !!(assocInfo && assocClassNodeIds.has(assocInfo.node.id));

        // An association class is a SINGLE element in the UML metamodel (both the Association
        // and the Class at once), so it must carry one shared xmi:id. Reuse the junction node's
        // own eaId (the same id already used for its diagram box) instead of minting a separate
        // id for "the connector", otherwise Enterprise Architect sees two disconnected elements.
        const connEaId = isAssocClassConn ? assocInfo!.eaId : this.toEaGuid(conn.id || `conn_${idx}`);

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
        // The diamond is always rendered at the connector's TARGET endpoint (see
        // canvas.component.ts getDiamondPoints() -> getTargetEndpoint()), so by UML convention
        // the target class is the "whole" and the source class is the "part". When the user
        // left a multiplicity blank on an Aggregation/Composition, default to the usual
        // whole/part reading instead of exporting an empty (ambiguous) multiplicity.
        const defaultSrcMult = isStructuralAssoc ? '1' : (isWholePart ? '0..*' : '');
        const defaultTgtMult = isStructuralAssoc ? '*' : (isWholePart ? '1' : '');

        const rawSrcMult = (conn.sourceMultiplicity !== undefined && conn.sourceMultiplicity !== '') ? conn.sourceMultiplicity : defaultSrcMult;
        const rawTgtMult = (conn.targetMultiplicity !== undefined && conn.targetMultiplicity !== '') ? conn.targetMultiplicity : defaultTgtMult;

        const srcMult = this.buildMultiplicityXml(rawSrcMult, `${connEaId}_src`);
        const tgtMult = this.buildMultiplicityXml(rawTgtMult, `${connEaId}_tgt`);

        // Standard UML2 aggregation kind belongs on the ownedEnd typed as the "part" (source
        // here, see note above): the property whose type is the aggregated class carries
        // aggregation="shared"/"composite", while the "whole" end (target) stays "none".
        const srcAggAttr = aggregationValue ? ` aggregation="${aggregationValue}"` : '';

        const assocClassAttr = assocInfo ? `associationClass="${assocInfo.eaId}"` : (conn.associationClassNodeId ? `associationClass="${conn.associationClassNodeId}"` : '');

        // Standard UML 2.1 Association / AssociationClass in packagedElement (memberEnd & type xmi:idref)
        if (conn.type !== 'Inheritance') {
          let assocClassMembersXml = '';
          if (isAssocClassConn) {
            const content = assocClassContentMap.get(assocInfo!.node.id);
            assocClassMembersXml = `
          ${content ? content.generalizationsXml : ''}
          ${content ? content.attrsXml : ''}
          ${content ? content.methodsXml : ''}`;
          }

          connectorsXml += `
        <packagedElement xmi:type="${connUmlType}" xmi:id="${connEaId}" name="${isAssocClassConn ? assocInfo!.node.name : (conn.label || '')}" memberEnd="${connEaId}_src ${connEaId}_tgt">
          <ownedEnd xmi:type="uml:Property" xmi:id="${connEaId}_src" visibility="public" association="${connEaId}"${srcAggAttr}>
            <type xmi:idref="${srcEaId}"/>
            ${srcMult.lowVal}
            ${srcMult.uppVal}
          </ownedEnd>
          <ownedEnd xmi:type="uml:Property" xmi:id="${connEaId}_tgt" visibility="public" association="${connEaId}">
            <type xmi:idref="${tgtEaId}"/>
            ${tgtMult.lowVal}
            ${tgtMult.uppVal}
          </ownedEnd>${assocClassMembersXml}
        </packagedElement>`;
        }

        // Enterprise Architect Extension Connector Definition with EXPLICIT <model type="Class"/>
        connectorsExtensionXml += `
        <connector xmi:idref="${connEaId}" name="${isAssocClassConn ? assocInfo!.node.name : (conn.label || '')}">
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
          <properties ea_type="${eaType}" ${subTypeAttr} ${assocClassAttr} direction="${conn.type === 'Inheritance' ? 'Source -> Destination' : 'Unspecified'}"/>
          <appearance linemode="3" linecolor="-1" linewidth="0" seqno="0" headstyle="0" linestyle="0"/>
        </connector>`;

        // Enterprise Architect Diagram Visual Line Link Placement. Skipped for an association
        // class: its connEaId is the same id as its diagram box (see above), which already has
        // its own geometry entry from the node loop - a second entry with the same subject would
        // give the diagram two conflicting geometries for one element.
        if (!isAssocClassConn) {
          diagramElementsXml += `
          <element geometry="SX=0;SY=0;EX=0;EY=0;Path=;" subject="${connEaId}" style="LEStyle=3;BStyle=0;"/>`;
        }
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

    // Fallback if browser doesn't support showSaveFilePicker
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

    // Fallback if no active handle exists
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
