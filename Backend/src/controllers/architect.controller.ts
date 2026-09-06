import { Response } from 'express';
import { prisma } from '../config/prisma';
import { AuthRequest } from '../middlewares/auth.middleware';
import { ArchitectSyncService } from '../services/architect.service';

export const exportArchitectXMI = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      res.status(400).json({ error: 'projectId es requerido.' });
      return;
    }

    const diagram = await prisma.diagram.findFirst({
      where: { projectId },
      include: { nodes: true, connectors: true },
    });

    if (!diagram) {
      res.status(404).json({ error: 'Diagrama no encontrado.' });
      return;
    }

    const nodes: any[] = diagram.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      stereotype: n.stereotype,
      attributes: n.attributes,
      methods: n.methods,
    }));

    const connectors: any[] = diagram.connectors.map((c) => ({
      id: c.id,
      sourceNodeId: c.sourceNodeId,
      targetNodeId: c.targetNodeId,
      type: c.type,
      label: c.label || '',
    }));

    const xmiContent = ArchitectSyncService.exportToXMI(nodes, connectors);

    // Save Architect Sync history
    await prisma.architectSync.create({
      data: {
        projectId,
        direction: 'PUSH',
        xmiContent,
        status: 'SUCCESS',
      },
    });

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename=ClassForge_Architect_${projectId}.xmi`);
    res.send(xmiContent);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al exportar XMI para Enterprise Architect: ' + error.message });
  }
};

export const importArchitectXMI = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId, xmiContent } = req.body;

    if (!projectId || !xmiContent) {
      res.status(400).json({ error: 'projectId y xmiContent son requeridos.' });
      return;
    }

    const diagram = await prisma.diagram.findFirst({ where: { projectId } });
    if (!diagram) {
      res.status(404).json({ error: 'Diagrama no encontrado.' });
      return;
    }

    const parsed = await ArchitectSyncService.importFromXMI(xmiContent);

    // Replace or merge nodes in diagram
    const createdNodesMap = new Map<string, string>();
    const newNodesList = [];

    for (const nodeData of parsed.nodes) {
      const node = await prisma.node.create({
        data: {
          diagramId: diagram.id,
          name: nodeData.name || 'ImportedClass',
          stereotype: nodeData.stereotype || 'Entity',
          attributes: (nodeData.attributes as any) || [],
          methods: (nodeData.methods as any) || [],
          positionX: nodeData.positionX || 100,
          positionY: nodeData.positionY || 100,
        },
      });
      if (nodeData.id) createdNodesMap.set(nodeData.id, node.id);
      newNodesList.push(node);
    }

    for (const connData of parsed.connectors) {
      const sourceId = createdNodesMap.get(connData.sourceNodeId!) || connData.sourceNodeId;
      const targetId = createdNodesMap.get(connData.targetNodeId!) || connData.targetNodeId;

      if (sourceId && targetId) {
        await prisma.connector.create({
          data: {
            diagramId: diagram.id,
            sourceNodeId: sourceId,
            targetNodeId: targetId,
            type: connData.type || 'Association',
            label: connData.label || '',
          },
        });
      }
    }

    await prisma.architectSync.create({
      data: {
        projectId,
        direction: 'PULL',
        xmiContent,
        status: 'SUCCESS',
      },
    });

    res.json({ message: 'Sincronización PULL de Enterprise Architect exitosa', nodesCreated: newNodesList.length });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al importar XMI de Enterprise Architect: ' + error.message });
  }
};
