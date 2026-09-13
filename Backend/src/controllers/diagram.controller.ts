import { Response } from 'express';
import { prisma } from '../config/prisma';
import { AuthRequest } from '../middlewares/auth.middleware';

export const getDiagramData = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;

    let diagram = await prisma.diagram.findFirst({
      where: { projectId },
      include: {
        nodes: true,
        connectors: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!diagram) {
      // Auto-create diagram in PostgreSQL DB if missing for this project
      diagram = await prisma.diagram.create({
        data: {
          projectId,
          name: 'Main Diagram',
        },
        include: {
          nodes: true,
          connectors: true,
        },
      });
    }

    if (diagram && diagram.connectors && diagram.connectors.length > 0) {
      const uniqueConns: any[] = [];
      const duplicateIds: string[] = [];
      const seen = new Set<string>();

      for (let i = diagram.connectors.length - 1; i >= 0; i--) {
        const c: any = diagram.connectors[i];
        const assocPart = c.associationClassNodeId ? `_assoc_${c.associationClassNodeId}` : '';
        const key1 = `${c.sourceNodeId}_${c.targetNodeId}_${c.type}${assocPart}`;
        const key2 = `${c.targetNodeId}_${c.sourceNodeId}_${c.type}${assocPart}`;

        if (seen.has(key1) || seen.has(key2)) {
          duplicateIds.push(c.id);
        } else {
          seen.add(key1);
          seen.add(key2);
          uniqueConns.unshift(c);
        }
      }

      if (duplicateIds.length > 0) {
        prisma.connector.deleteMany({
          where: { id: { in: duplicateIds } }
        }).catch(() => {});
      }

      (diagram as any).connectors = uniqueConns;
    }

    res.json(diagram);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al obtener datos del diagrama: ' + error.message });
  }
};

export const createNode = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { diagramId, name, stereotype, attributes, methods, positionX, positionY } = req.body;

    const node = await prisma.node.create({
      data: {
        diagramId,
        name: name || 'NewClass',
        stereotype: stereotype || 'Entity',
        attributes: attributes || [
          { id: '1', name: 'id', type: 'String', visibility: '+' },
        ],
        methods: methods || [
          { id: '1', name: 'getId', returnType: 'String', visibility: '+' },
        ],
        positionX: positionX || 150,
        positionY: positionY || 150,
      },
    });

    // Touch parent diagram timestamp to preserve latest state
    await prisma.diagram.update({
      where: { id: diagramId },
      data: { updatedAt: new Date() },
    }).catch(() => {});

    res.status(201).json(node);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al crear nodo UML: ' + error.message });
  }
};

export const updateNode = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const nodeId = req.params.nodeId as string;
    const { name, stereotype, attributes, methods, positionX, positionY, width, height } = req.body;

    const updatedNode = await prisma.node.update({
      where: { id: nodeId },
      data: {
        ...(name && { name }),
        ...(stereotype && { stereotype }),
        ...(attributes && { attributes }),
        ...(methods && { methods }),
        ...(positionX !== undefined && { positionX }),
        ...(positionY !== undefined && { positionY }),
        ...(width !== undefined && { width }),
        ...(height !== undefined && { height }),
      },
    });

    if (updatedNode && updatedNode.diagramId) {
      await prisma.diagram.update({
        where: { id: updatedNode.diagramId },
        data: { updatedAt: new Date() },
      }).catch(() => {});
    }

    res.json(updatedNode);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al actualizar nodo UML: ' + error.message });
  }
};

export const deleteNode = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const nodeId = req.params.nodeId as string;

    await prisma.node.delete({
      where: { id: nodeId },
    });

    res.json({ message: 'Nodo eliminado correctamente.' });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al eliminar nodo UML: ' + error.message });
  }
};

export const createConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { diagramId, sourceNodeId, targetNodeId, type, sourceMultiplicity, targetMultiplicity, label, associationClassNodeId } = req.body;

    const connector = await prisma.connector.create({
      data: {
        diagramId,
        sourceNodeId,
        targetNodeId,
        type: type || 'Association',
        sourceMultiplicity: (sourceMultiplicity !== undefined && sourceMultiplicity !== null) ? String(sourceMultiplicity) : '',
        targetMultiplicity: (targetMultiplicity !== undefined && targetMultiplicity !== null) ? String(targetMultiplicity) : '',
        label: (label !== undefined && label !== null) ? String(label) : '',
        associationClassNodeId: associationClassNodeId ? String(associationClassNodeId) : null,
      } as any,
    });

    await prisma.diagram.update({
      where: { id: diagramId },
      data: { updatedAt: new Date() },
    }).catch(() => {});

    res.status(201).json(connector);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al crear conector UML: ' + error.message });
  }
};

export const deleteConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const connectorId = req.params.connectorId as string;
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(connectorId);

    if (isUUID) {
      await prisma.connector.deleteMany({
        where: { id: connectorId },
      });
    } else {
      const { sourceNodeId, targetNodeId, type } = req.query;
      if (sourceNodeId && targetNodeId) {
        await prisma.connector.deleteMany({
          where: {
            sourceNodeId: String(sourceNodeId),
            targetNodeId: String(targetNodeId),
            ...(type ? { type: String(type) } : {})
          }
        });
      }
    }

    res.json({ message: 'Conector eliminado correctamente.' });
  } catch (error: any) {
    console.warn('Advertencia en deleteConnector:', error?.message || error);
    res.json({ message: 'Procesado eliminación de conector.' });
  }
};

export const updateConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const connectorId = req.params.connectorId as string;
    const { sourceNodeId, targetNodeId, type, sourceMultiplicity, targetMultiplicity, label, associationClassNodeId } = req.body;

    const updatedConnector = await prisma.connector.update({
      where: { id: connectorId },
      data: {
        ...(sourceNodeId && { sourceNodeId }),
        ...(targetNodeId && { targetNodeId }),
        ...(type && { type }),
        ...(sourceMultiplicity !== undefined && { sourceMultiplicity }),
        ...(targetMultiplicity !== undefined && { targetMultiplicity }),
        ...(label !== undefined && { label }),
        ...(associationClassNodeId !== undefined && { associationClassNodeId }),
      } as any,
    });

    if (updatedConnector && updatedConnector.diagramId) {
      await prisma.diagram.update({
        where: { id: updatedConnector.diagramId },
        data: { updatedAt: new Date() },
      }).catch(() => {});
    }

    res.json(updatedConnector);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al actualizar conector UML: ' + error.message });
  }
};

export const purgeDiagramData = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const diagram = await prisma.diagram.findFirst({ where: { projectId } });
    if (diagram) {
      await prisma.connector.deleteMany({ where: { diagramId: diagram.id } });
      await prisma.node.deleteMany({ where: { diagramId: diagram.id } });
      await prisma.diagram.update({
        where: { id: diagram.id },
        data: { updatedAt: new Date() },
      }).catch(() => {});
    }
    res.json({ message: 'Diagrama purgado exitosamente.' });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al purgar diagrama: ' + error.message });
  }
};
