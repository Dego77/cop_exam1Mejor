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

    // 1. DYNAMIC MAPPING OF ALL NODES / CLASSES
    if (nodes && nodes.length > 0) {
      nodes.forEach((node, idx) => {
        const nodeInfo = nodeMap.get(node.id)!;
        const nodeEaId = nodeInfo.eaId;

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

        // Standard UML Class Element (including generalization links if any)
        classesXml += `
        <packagedElement xmi:type="uml:Class" xmi:id="${nodeEaId}" name="${node.name}">
          ${generalizationsXml}
          ${attrsXml}
          ${methodsXml}
        </packagedElement>`;

        // Enterprise Architect Extension Element Definition
        elementsExtensionXml += `
        <element xmi:idref="${nodeEaId}" xmi:type="uml:Class" name="${node.name}" scope="public">
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
        const connEaId = this.toEaGuid(conn.id || `conn_${idx}`);
        const srcInfo = nodeMap.get(conn.sourceNodeId);
        const tgtInfo = nodeMap.get(conn.targetNodeId);

        const srcEaId = srcInfo ? srcInfo.eaId : this.toEaGuid(conn.sourceNodeId);
        const tgtEaId = tgtInfo ? tgtInfo.eaId : this.toEaGuid(conn.targetNodeId);

        const srcName = srcInfo ? srcInfo.node.name : 'SourceClass';
        const tgtName = tgtInfo ? tgtInfo.node.name : 'TargetClass';

        const srcLocalId = srcInfo ? srcInfo.localId : idx + 1;
        const tgtLocalId = tgtInfo ? tgtInfo.localId : idx + 2;

        let connUmlType = 'uml:Association';
        let eaType = 'Association';
        let subTypeAttr = '';

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
            break;
          case 'Composition':
            connUmlType = 'uml:Association';
            eaType = 'Aggregation';
            subTypeAttr = 'subType="Strong"';
            break;
          default:
            connUmlType = 'uml:Association';
            eaType = 'Association';
            break;
        }

        const isStructuralAssoc = conn.type === 'Association' || !conn.type;
        const defaultSrcMult = isStructuralAssoc ? '1' : '';
        const defaultTgtMult = isStructuralAssoc ? '*' : '';

        const rawSrcMult = (conn.sourceMultiplicity !== undefined && conn.sourceMultiplicity !== '') ? conn.sourceMultiplicity : defaultSrcMult;
        const rawTgtMult = (conn.targetMultiplicity !== undefined && conn.targetMultiplicity !== '') ? conn.targetMultiplicity : defaultTgtMult;

        const srcMult = this.buildMultiplicityXml(rawSrcMult, `${connEaId}_src`);
        const tgtMult = this.buildMultiplicityXml(rawTgtMult, `${connEaId}_tgt`);

        const assocInfo = conn.associationClassNodeId ? nodeMap.get(conn.associationClassNodeId) : undefined;
        const assocClassAttr = assocInfo ? `associationClass="${assocInfo.eaId}"` : (conn.associationClassNodeId ? `associationClass="${conn.associationClassNodeId}"` : '');

        // Standard UML 2.1 Association in packagedElement (memberEnd & type xmi:idref)
        if (conn.type !== 'Inheritance') {
          connectorsXml += `
        <packagedElement xmi:type="${connUmlType}" xmi:id="${connEaId}" name="${conn.label || ''}" memberEnd="${connEaId}_src ${connEaId}_tgt">
          <ownedEnd xmi:type="uml:Property" xmi:id="${connEaId}_src" visibility="public" association="${connEaId}">
            <type xmi:idref="${srcEaId}"/>
            ${srcMult.lowVal}
            ${srcMult.uppVal}
          </ownedEnd>
          <ownedEnd xmi:type="uml:Property" xmi:id="${connEaId}_tgt" visibility="public" association="${connEaId}">
            <type xmi:idref="${tgtEaId}"/>
            ${tgtMult.lowVal}
            ${tgtMult.uppVal}
          </ownedEnd>
        </packagedElement>`;
        }

        // Enterprise Architect Extension Connector Definition with EXPLICIT <model type="Class"/>
        connectorsExtensionXml += `
        <connector xmi:idref="${connEaId}" name="${conn.label || ''}">
          <source xmi:idref="${srcEaId}">
            <model type="Class" name="${srcName}" ea_localid="${srcLocalId}"/>
            <role visibility="Public"/>
            <type multiplicity="${srcMult.eaTypeMult}"/>
          </source>
          <target xmi:idref="${tgtEaId}">
            <model type="Class" name="${tgtName}" ea_localid="${tgtLocalId}"/>
            <role visibility="Public"/>
            <type multiplicity="${tgtMult.eaTypeMult}"/>
          </target>
          <properties ea_type="${eaType}" ${subTypeAttr} ${assocClassAttr} direction="${conn.type === 'Inheritance' ? 'Source -> Destination' : 'Unspecified'}"/>
          <appearance linemode="3" linecolor="-1" linewidth="0" seqno="0" headstyle="0" linestyle="0"/>
        </connector>`;

        // Enterprise Architect Diagram Visual Line Link Placement
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
