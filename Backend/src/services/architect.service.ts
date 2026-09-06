import { Builder, parseStringPromise } from 'xml2js';
import { UMLNode, UMLConnector } from './sql.service';

export class ArchitectSyncService {
  public static exportToXMI(nodes: UMLNode[], connectors: UMLConnector[]): string {
    const builder = new Builder({
      xmldec: { version: '1.0', encoding: 'UTF-8' },
      renderOpts: { pretty: true, indent: '  ' },
    });

    const packagedElements: any[] = [];

    // Export Nodes
    nodes.forEach((node) => {
      const attributes = (Array.isArray(node.attributes) ? node.attributes : []).map((attr) => ({
        $: {
          'xmi:type': 'uml:Property',
          'xmi:id': attr.id || `attr_${Math.random().toString(36).substring(2, 9)}`,
          name: attr.name,
          visibility: attr.visibility === '-' ? 'private' : attr.visibility === '#' ? 'protected' : 'public',
        },
        type: [
          {
            $: {
              'xmi:type': 'uml:PrimitiveType',
              href: `http://schema.omg.org/spec/UML/2.1/#${attr.type || 'String'}`,
            },
          },
        ],
      }));

      const methods = (Array.isArray(node.methods) ? node.methods : []).map((m) => ({
        $: {
          'xmi:type': 'uml:Operation',
          'xmi:id': m.id || `op_${Math.random().toString(36).substring(2, 9)}`,
          name: m.name,
          visibility: m.visibility === '-' ? 'private' : m.visibility === '#' ? 'protected' : 'public',
        },
      }));

      packagedElements.push({
        $: {
          'xmi:type': node.stereotype === 'Interface' ? 'uml:Interface' : 'uml:Class',
          'xmi:id': node.id,
          name: node.name,
        },
        ownedAttribute: attributes,
        ownedOperation: methods,
      });
    });

    // Export Connectors
    connectors.forEach((conn) => {
      packagedElements.push({
        $: {
          'xmi:type': 'uml:Association',
          'xmi:id': conn.id,
          name: conn.label || `${conn.type} Relationship`,
        },
        memberEnd: [
          { $: { 'xmi:idref': conn.sourceNodeId } },
          { $: { 'xmi:idref': conn.targetNodeId } },
        ],
      });
    });

    const xmiObject = {
      'xmi:XMI': {
        $: {
          'xmi:version': '2.1',
          'xmlns:uml': 'http://schema.omg.org/spec/UML/2.1',
          'xmlns:xmi': 'http://schema.omg.org/spec/XMI/2.1',
        },
        'uml:Model': {
          $: {
            'xmi:type': 'uml:Model',
            'xmi:id': 'ClassForge_Model',
            name: 'ClassForge Exported Model',
          },
          packagedElement: packagedElements,
        },
      },
    };

    return builder.buildObject(xmiObject);
  }

  public static async importFromXMI(xmiXml: string): Promise<{ nodes: Partial<UMLNode>[]; connectors: Partial<UMLConnector>[] }> {
    const result = await parseStringPromise(xmiXml);
    const nodes: Partial<UMLNode>[] = [];
    const connectors: Partial<UMLConnector>[] = [];

    const xmi = result['xmi:XMI'] || result['XMI'];
    if (!xmi) return { nodes: [], connectors: [] };

    const model = xmi['uml:Model'] ? xmi['uml:Model'][0] : null;
    if (!model) return { nodes: [], connectors: [] };

    const elements = model.packagedElement || [];

    elements.forEach((elem: any) => {
      const type = elem.$['xmi:type'];
      const id = elem.$['xmi:id'];
      const name = elem.$.name;

      if (type === 'uml:Class' || type === 'uml:Interface') {
        const attributes: any[] = [];
        const methods: any[] = [];

        if (elem.ownedAttribute) {
          elem.ownedAttribute.forEach((attr: any) => {
            attributes.push({
              id: attr.$['xmi:id'],
              name: attr.$.name,
              type: attr.type ? attr.type[0].$.href.split('#')[1] || 'String' : 'String',
              visibility: attr.$.visibility === 'private' ? '-' : attr.$.visibility === 'protected' ? '#' : '+',
            });
          });
        }

        if (elem.ownedOperation) {
          elem.ownedOperation.forEach((op: any) => {
            methods.push({
              id: op.$['xmi:id'],
              name: op.$.name,
              returnType: 'void',
              visibility: op.$.visibility === 'private' ? '-' : op.$.visibility === 'protected' ? '#' : '+',
            });
          });
        }

        nodes.push({
          id,
          name,
          stereotype: type === 'uml:Interface' ? 'Interface' : 'Entity',
          attributes,
          methods,
          positionX: 100 + Math.random() * 400,
          positionY: 100 + Math.random() * 400,
          width: 220,
          height: 180,
        });
      } else if (type === 'uml:Association') {
        const memberEnds = elem.memberEnd || [];
        if (memberEnds.length >= 2) {
          connectors.push({
            id,
            sourceNodeId: memberEnds[0].$['xmi:idref'],
            targetNodeId: memberEnds[1].$['xmi:idref'],
            type: 'Association',
            label: elem.$.name || '',
          });
        }
      }
    });

    return { nodes, connectors };
  }
}
