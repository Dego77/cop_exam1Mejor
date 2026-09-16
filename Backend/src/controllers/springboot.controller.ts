import { Response } from 'express';
import { prisma } from '../config/prisma';
import { AuthRequest } from '../middlewares/auth.middleware';
import { SpringBootGeneratorService } from '../services/springboot.service';

/**
 * Obtiene los nodos y conectores ya sea del body o consultando la base de datos por projectId.
 */
async function getNodesAndConnectors(req: AuthRequest): Promise<{ nodes: any[]; connectors: any[]; projectName: string }> {
  let { projectId, nodes, connectors, projectName } = req.body;

  if ((!nodes || !connectors) && projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        diagrams: {
          include: {
            nodes: true,
            connectors: true,
          },
        },
      },
    });

    if (project && project.diagrams && project.diagrams.length > 0) {
      const diagram = project.diagrams[0];
      projectName = projectName || project.name;
      nodes = diagram.nodes;
      connectors = diagram.connectors;
    }
  }

  return {
    nodes: Array.isArray(nodes) ? nodes : [],
    connectors: Array.isArray(connectors) ? connectors : [],
    projectName: projectName || 'ExamenBackend',
  };
}

/**
 * Endpoint para exportar el JSON canónico estandarizado del diagrama.
 */
export const exportCanonicalJson = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { nodes, connectors, projectName } = await getNodesAndConnectors(req);
    const canonicalJson = SpringBootGeneratorService.generateCanonicalJson(nodes, connectors, projectName);
    res.json(canonicalJson);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al generar JSON canónico: ' + error.message });
  }
};

/**
 * Endpoint para generar y descargar el proyecto Spring Boot en formato .ZIP.
 */
export const downloadSpringBootZip = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { nodes, connectors, projectName } = await getNodesAndConnectors(req);
    
    const zipBuffer = await SpringBootGeneratorService.generateSpringBootZip(nodes, connectors, projectName);
    
    const cleanFileName = projectName.toLowerCase().replace(/[^a-z0-9_]/g, '') || 'backend_springboot';
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${cleanFileName}_springboot.zip"`);
    res.send(zipBuffer);
  } catch (error: any) {
    console.error('Error al generar ZIP de Spring Boot:', error);
    res.status(500).json({ error: 'Error al generar archivo ZIP de Spring Boot: ' + error.message });
  }
};
