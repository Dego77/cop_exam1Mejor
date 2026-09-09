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
    const { diagramId, sourceNodeId, targetNodeId, type, sourceMultiplicity, targetMultiplicity, label } = req.body;

    const connector = await prisma.connector.create({
      data: {
        diagramId,
        sourceNodeId,
        targetNodeId,
        type: type || 'Association',
        sourceMultiplicity: sourceMultiplicity || '1',
        targetMultiplicity: targetMultiplicity || '0..*',
        label: label || '',
      },
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

    await prisma.connector.delete({
      where: { id: connectorId },
    });

    res.json({ message: 'Conector eliminado correctamente.' });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al eliminar conector UML: ' + error.message });
  }
};
