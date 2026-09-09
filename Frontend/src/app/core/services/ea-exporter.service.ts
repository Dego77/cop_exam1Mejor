import { Injectable } from '@angular/core';
import { UMLNode, UMLConnector } from './diagram.service';

@Injectable({ providedIn: 'root' })
export class EaExporterService {
  activeFileHandle: any = null;
  activeFileName: string = '';

  generateXMI(projectName: string, nodes: UMLNode[], connectors: UMLConnector[]): string {
    const timestamp = new Date().toISOString();

    let classesXml = '';
    if (nodes && nodes.length > 0) {
      nodes.forEach(node => {
        let attrsXml = '';
        if (node.attributes && node.attributes.length > 0) {
          node.attributes.forEach((attr, idx) => {
            const vis = attr.visibility === '-' ? 'private' : attr.visibility === '#' ? 'protected' : 'public';
            attrsXml += `
            <ownedAttribute xmi:type="uml:Property" xmi:id="${node.id}_attr_${idx}" name="${attr.name}" visibility="${vis}">
              <type xmi:type="uml:PrimitiveType" href="http://schema.omg.org/spec/UML/2.1/uml.xml#${attr.type || 'String'}"/>
            </ownedAttribute>`;
          });
        }

        let methodsXml = '';
        if (node.methods && node.methods.length > 0) {
          node.methods.forEach((m, idx) => {
            const vis = m.visibility === '-' ? 'private' : m.visibility === '#' ? 'protected' : 'public';
            methodsXml += `
            <ownedOperation xmi:type="uml:Operation" xmi:id="${node.id}_m_${idx}" name="${m.name}" visibility="${vis}">
              <ownedParameter xmi:type="uml:Parameter" xmi:id="${node.id}_m_${idx}_ret" direction="return">
                <type xmi:type="uml:PrimitiveType" href="http://schema.omg.org/spec/UML/2.1/uml.xml#${m.returnType || 'void'}"/>
              </ownedParameter>
            </ownedOperation>`;
          });
        }

        classesXml += `
        <packagedElement xmi:type="uml:Class" xmi:id="${node.id}" name="${node.name}">
          ${attrsXml}
          ${methodsXml}
        </packagedElement>`;
      });
    }

    let connectorsXml = '';
    if (connectors && connectors.length > 0) {
      connectors.forEach((conn, idx) => {
        const type = conn.type === 'Inheritance' ? 'uml:Generalization' : 'uml:Association';
        connectorsXml += `
        <packagedElement xmi:type="${type}" xmi:id="${conn.id}" name="${conn.label || ''}">
          <ownedEnd xmi:type="uml:Property" xmi:id="${conn.id}_src" type="${conn.sourceNodeId}" multiplicity="${conn.sourceMultiplicity || '1'}"/>
          <ownedEnd xmi:type="uml:Property" xmi:id="${conn.id}_tgt" type="${conn.targetNodeId}" multiplicity="${conn.targetMultiplicity || '*'}"/>
        </packagedElement>`;
      });
    }

    return `<?xml version="1.0" encoding="utf-8"?>
<xmi:XMI xmi:version="2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1" xmlns:xmi="http://schema.omg.org/spec/XMI/2.1">
  <xmi:Documentation exporter="Enterprise Architect" exporterVersion="15.0" created="${timestamp}"/>
  <uml:Model xmi:type="uml:Model" xmi:id="EA_Model_${Date.now()}" name="${projectName || 'ClassForge_Model'}">
    <packagedElement xmi:type="uml:Package" xmi:id="EA_Package_Main" name="Logical View">
      ${classesXml}
      ${connectorsXml}
    </packagedElement>
  </uml:Model>
</xmi:XMI>`;
  }

  async promptSaveEAPFile(nodes: UMLNode[], connectors: UMLConnector[], defaultName = 'actores_casodeUso'): Promise<string | null> {
    const suggestedName = defaultName.toLowerCase().endsWith('.eap') ? defaultName : `${defaultName}.eap`;

    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName,
          types: [{
            description: 'Enterprise Architect Project (*.eap)',
            accept: { 'application/x-enterprise-architect-project': ['.eap', '.xmi', '.xml'] }
          }]
        });

        const fileName: string = handle.name;
        const projectName = fileName.replace(/\.(eap|xmi|xml)$/i, '');
        const xmiContent = this.generateXMI(projectName, nodes, connectors);
        const blob = new Blob([xmiContent], { type: 'application/x-enterprise-architect-project;charset=utf-8' });

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
    const name = prompt('Ingrese el nombre del proyecto Enterprise Architect (*.eap):', defaultName);
    if (!name) return null;
    const cleanName = name.trim();
    const xmiContent = this.generateXMI(cleanName, nodes, connectors);
    this.downloadEAPFile(cleanName, xmiContent);
    return cleanName;
  }

  async saveDirectlyToActiveFile(projectName: string, nodes: UMLNode[], connectors: UMLConnector[]): Promise<boolean> {
    const xmiContent = this.generateXMI(projectName, nodes, connectors);
    const blob = new Blob([xmiContent], { type: 'application/x-enterprise-architect-project;charset=utf-8' });

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

    // Fallback if no active handle exists: open save picker once and save handle
    if ('showSaveFilePicker' in window) {
      try {
        const cleanFilename = projectName.toLowerCase().endsWith('.eap') ? projectName : `${projectName}.eap`;
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: cleanFilename,
          types: [{
            description: 'Enterprise Architect Project (*.eap)',
            accept: { 'application/x-enterprise-architect-project': ['.eap', '.xmi', '.xml'] }
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

    this.triggerFallbackDownload(projectName.toLowerCase().endsWith('.eap') ? projectName : `${projectName}.eap`, blob);
    return true;
  }

  downloadEAPFile(filename: string, content: string): void {
    const cleanFilename = filename.toLowerCase().endsWith('.eap') ? filename : `${filename}.eap`;
    const blob = new Blob([content], { type: 'application/x-enterprise-architect-project;charset=utf-8' });

    if ('showSaveFilePicker' in window) {
      (window as any).showSaveFilePicker({
        suggestedName: cleanFilename,
        types: [{
          description: 'Enterprise Architect Project (*.eap)',
          accept: { 'application/x-enterprise-architect-project': ['.eap', '.xmi', '.xml'] }
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
