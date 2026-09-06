import { Response } from 'express';
import { prisma } from '../config/prisma';
import { AuthRequest } from '../middlewares/auth.middleware';
import { PostgreSQLGeneratorService } from '../services/sql.service';

export const generatePostgreSQLScript = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId, options } = req.body;

    if (!projectId) {
      res.status(400).json({ error: 'projectId es obligatorio.' });
      return;
    }

    const diagram = await prisma.diagram.findFirst({
      where: { projectId },
      include: {
        nodes: true,
        connectors: true,
      },
    });

    if (!diagram) {
      res.status(404).json({ error: 'Diagrama no encontrado para el proyecto.' });
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
      sourceMultiplicity: c.sourceMultiplicity || '',
      targetMultiplicity: c.targetMultiplicity || '',
      label: c.label || '',
    }));

    const sqlScript = PostgreSQLGeneratorService.generateDDL(nodes, connectors, options);

    res.json({
      projectId,
      diagramId: diagram.id,
      sqlScript,
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al generar script PostgreSQL: ' + error.message });
  }
};
