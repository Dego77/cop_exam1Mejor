import { Response } from 'express';
import { prisma } from '../config/prisma';
import { AuthRequest } from '../middlewares/auth.middleware';
import { AIAgentService } from '../services/ai.service';

export const handleTextPrompt = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId, prompt } = req.body;
    const userId = req.user!.id;

    if (!projectId || !prompt) {
      res.status(400).json({ error: 'projectId y prompt son requeridos.' });
      return;
    }

    const diagram = await prisma.diagram.findFirst({
      where: { projectId },
      include: { nodes: true, connectors: true },
    });

    const aiResponse = await AIAgentService.processTextPrompt(prompt, diagram);

    // Save prompt & response to AI chat history
    await prisma.aIChatHistory.create({
      data: {
        projectId,
        userId,
        sender: 'USER',
        mode: 'CHAT',
        content: prompt,
      },
    });

    await prisma.aIChatHistory.create({
      data: {
        projectId,
        userId,
        sender: 'AI',
        mode: 'CHAT',
        content: aiResponse.message,
      },
    });

    // Auto-create, update, or delete classes in diagram
    let createdNodes: any[] = [];
    let updatedNodes: any[] = [];
    let deletedNodeIds: string[] = [];
    let createdConnectors: any[] = [];

    if (diagram) {
      const existingNodes = diagram.nodes || [];

      // Process classesToDelete
      if (aiResponse.classesToDelete && aiResponse.classesToDelete.length > 0) {
        for (const clsName of aiResponse.classesToDelete) {
          const matchNode = existingNodes.find(n => n.name.toLowerCase() === clsName.toLowerCase());
          if (matchNode) {
            await prisma.node.delete({ where: { id: matchNode.id } });
            deletedNodeIds.push(matchNode.id);
          }
        }
      }

      // Process attributesToRemove
      if (aiResponse.attributesToRemove && aiResponse.attributesToRemove.length > 0) {
        for (const item of aiResponse.attributesToRemove) {
          const matchNode = existingNodes.find(n => n.name.toLowerCase() === item.className?.toLowerCase());
          if (matchNode) {
            const currentAttrs = (matchNode.attributes as any[]) || [];
            const updatedAttrs = currentAttrs.filter(a => a.name?.toLowerCase() !== item.attributeName?.toLowerCase());
            const updated = await prisma.node.update({
              where: { id: matchNode.id },
              data: { attributes: updatedAttrs },
            });
            updatedNodes.push(updated);
          }
        }
      }

      // Process methodsToRemove
      if (aiResponse.methodsToRemove && aiResponse.methodsToRemove.length > 0) {
        for (const item of aiResponse.methodsToRemove) {
          const matchNode = existingNodes.find(n => n.name.toLowerCase() === item.className?.toLowerCase());
          if (matchNode) {
            const currentMeths = (matchNode.methods as any[]) || [];
            const updatedMeths = currentMeths.filter(m => m.name?.toLowerCase() !== item.methodName?.toLowerCase());
            const updated = await prisma.node.update({
              where: { id: matchNode.id },
              data: { methods: updatedMeths },
            });
            updatedNodes.push(updated);
          }
        }
      }

      // Process classesModified if returned
      if (aiResponse.classesModified && aiResponse.classesModified.length > 0) {
        for (const mod of aiResponse.classesModified) {
          const matchNode = existingNodes.find(n => n.name.toLowerCase() === mod.name?.toLowerCase());
          if (matchNode) {
            const currentAttrs = (matchNode.attributes as any[]) || [];
            const currentMeths = (matchNode.methods as any[]) || [];
            const newAttrs = mod.attributesToAdd || mod.attributes || [];
            const newMeths = mod.methodsToAdd || mod.methods || [];

            const updatedAttrs = [...currentAttrs];
            for (const a of newAttrs) {
              if (!updatedAttrs.some(x => x.name?.toLowerCase() === a.name?.toLowerCase())) {
                updatedAttrs.push(a);
              }
            }

            const updatedMeths = [...currentMeths];
            for (const m of newMeths) {
              if (!updatedMeths.some(x => x.name?.toLowerCase() === m.name?.toLowerCase())) {
                updatedMeths.push(m);
              }
            }

            const updated = await prisma.node.update({
              where: { id: matchNode.id },
              data: { attributes: updatedAttrs, methods: updatedMeths },
            });
            updatedNodes.push(updated);
          }
        }
      }

      // Process classesGenerated with smart existing-check
      if (aiResponse.classesGenerated && aiResponse.classesGenerated.length > 0) {
        let currentX = 100;
        let currentY = 150;

        for (const cls of aiResponse.classesGenerated) {
          const matchNode = existingNodes.find(n => n.name.toLowerCase() === cls.name?.toLowerCase());
          if (matchNode) {
            const currentAttrs = (matchNode.attributes as any[]) || [];
            const currentMeths = (matchNode.methods as any[]) || [];
            const newAttrs = cls.attributes || [];
            const newMeths = cls.methods || [];

            const updatedAttrs = [...currentAttrs];
            for (const a of newAttrs) {
              if (!updatedAttrs.some(x => x.name?.toLowerCase() === a.name?.toLowerCase())) {
                updatedAttrs.push(a);
              }
            }

            const updatedMeths = [...currentMeths];
            for (const m of newMeths) {
              if (!updatedMeths.some(x => x.name?.toLowerCase() === m.name?.toLowerCase())) {
                updatedMeths.push(m);
              }
            }

            const updated = await prisma.node.update({
              where: { id: matchNode.id },
              data: { attributes: updatedAttrs, methods: updatedMeths },
            });
            updatedNodes.push(updated);
          } else {
            const node = await prisma.node.create({
              data: {
                diagramId: diagram.id,
                name: cls.name,
                stereotype: cls.stereotype || 'Entity',
                attributes: cls.attributes || [],
                methods: cls.methods || [],
                positionX: currentX,
                positionY: currentY,
              },
            });
            createdNodes.push(node);
            currentX += 250;
          }
        }
      }

      // Process connectorsGenerated
      const allDiagramNodes = await prisma.node.findMany({ where: { diagramId: diagram.id } });
      if (aiResponse.connectorsGenerated && aiResponse.connectorsGenerated.length > 0) {
        for (const conn of aiResponse.connectorsGenerated) {
          const srcName = conn.sourceClassName || conn.sourceNodeName || conn.source;
          const tgtName = conn.targetClassName || conn.targetNodeName || conn.target;

          const srcNode = allDiagramNodes.find(n => n.name.toLowerCase() === srcName?.toLowerCase());
          const tgtNode = allDiagramNodes.find(n => n.name.toLowerCase() === tgtName?.toLowerCase());

          if (srcNode && tgtNode) {
            const newConn = await prisma.connector.create({
              data: {
                diagramId: diagram.id,
                sourceNodeId: srcNode.id,
                targetNodeId: tgtNode.id,
                type: conn.type || 'Association',
                sourceMultiplicity: conn.sourceMultiplicity || '+1',
                targetMultiplicity: conn.targetMultiplicity || '+*',
                label: conn.label || '',
              },
            });
            createdConnectors.push({
              id: newConn.id,
              sourceNodeId: newConn.sourceNodeId,
              targetNodeId: newConn.targetNodeId,
              type: newConn.type,
              sourceMultiplicity: newConn.sourceMultiplicity,
              targetMultiplicity: newConn.targetMultiplicity,
              label: newConn.label,
            });
          }
        }
      }
    }

    res.json({
      aiResponse,
      createdNodes,
      updatedNodes,
      deletedNodeIds,
      createdConnectors,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al procesar prompt de IA: ' + error.message });
  }
};

export const handlePhotoPrompt = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.body;
    const userId = req.user!.id;
    const file = req.file;

    if (!projectId || !file) {
      res.status(400).json({ error: 'projectId y archivo de imagen son requeridos.' });
      return;
    }

    const diagram = await prisma.diagram.findFirst({ where: { projectId } });

    const aiResponse = await AIAgentService.processPhotoPrompt(file.path, file.mimetype);

    // Save history
    await prisma.aIChatHistory.create({
      data: {
        projectId,
        userId,
        sender: 'USER',
        mode: 'PHOTO',
        content: 'Imagen de boceto subida',
        mediaUrl: file.path,
      },
    });

    await prisma.aIChatHistory.create({
      data: {
        projectId,
        userId,
        sender: 'AI',
        mode: 'PHOTO',
        content: aiResponse.message,
      },
    });

    // Auto-create nodes and connectors from whiteboard photo recognition
    let createdNodes: any[] = [];
    let createdConnectors: any[] = [];

    if (diagram && aiResponse.classesGenerated && aiResponse.classesGenerated.length > 0) {
      let startX = 100;
      let startY = 80;
      let colIndex = 0;
      const nodesMap = new Map<string, any>();

      for (const cls of aiResponse.classesGenerated) {
        const posX = startX + (colIndex % 3) * 320;
        const posY = startY + Math.floor(colIndex / 3) * 260;

        const node = await prisma.node.create({
          data: {
            diagramId: diagram.id,
            name: cls.name,
            stereotype: cls.stereotype || 'Entity',
            attributes: cls.attributes || [],
            methods: cls.methods || [],
            positionX: posX,
            positionY: posY,
          },
        });
        createdNodes.push(node);
        nodesMap.set(cls.name.toLowerCase(), node);
        colIndex++;
      }

      // Create relationships/connectors if detected in the photo
      if (aiResponse.connectorsGenerated && aiResponse.connectorsGenerated.length > 0) {
        for (const conn of aiResponse.connectorsGenerated) {
          const srcNode = nodesMap.get(conn.sourceClassName?.toLowerCase());
          const tgtNode = nodesMap.get(conn.targetClassName?.toLowerCase());

          if (srcNode && tgtNode) {
            const connector = await prisma.connector.create({
              data: {
                diagramId: diagram.id,
                sourceNodeId: srcNode.id,
                targetNodeId: tgtNode.id,
                type: conn.type || 'Association',
                sourceMultiplicity: conn.sourceMultiplicity || '1',
                targetMultiplicity: conn.targetMultiplicity || '0..*',
                label: conn.label || '',
              },
            });
            createdConnectors.push(connector);
          }
        }
      }
    }

    res.json({
      aiResponse,
      createdNodes,
      createdConnectors,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al procesar imagen en IA: ' + error.message });
  }
};

export const handleVoicePrompt = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.body;
    const userId = req.user?.id;
    const file = req.file;

    if (!projectId || !file) {
      res.status(400).json({ error: 'projectId y archivo de voz son requeridos.' });
      return;
    }

    const diagram = await prisma.diagram.findFirst({
      where: { projectId },
      include: { nodes: true, connectors: true },
    });

    const aiResponse = await AIAgentService.processVoicePrompt(file.path, file.mimetype, diagram);

    // Save history
    if (userId) {
      await prisma.aIChatHistory.create({
        data: {
          projectId,
          userId,
          sender: 'USER',
          mode: 'VOICE',
          content: 'Nota de voz enviada',
          mediaUrl: file.path,
        },
      });

      await prisma.aIChatHistory.create({
        data: {
          projectId,
          userId,
          sender: 'AI',
          mode: 'VOICE',
          content: aiResponse.message,
        },
      });
    }

    let createdNodes: any[] = [];
    let updatedNodes: any[] = [];
    let deletedNodeIds: string[] = [];

    if (diagram) {
      const existingNodes = diagram.nodes || [];

      // Process classesToDelete
      if (aiResponse.classesToDelete && aiResponse.classesToDelete.length > 0) {
        for (const clsName of aiResponse.classesToDelete) {
          const matchNode = existingNodes.find(n => n.name.toLowerCase() === clsName.toLowerCase());
          if (matchNode) {
            await prisma.node.delete({ where: { id: matchNode.id } });
            deletedNodeIds.push(matchNode.id);
          }
        }
      }

      // Process attributesToRemove
      if (aiResponse.attributesToRemove && aiResponse.attributesToRemove.length > 0) {
        for (const item of aiResponse.attributesToRemove) {
          const matchNode = existingNodes.find(n => n.name.toLowerCase() === item.className?.toLowerCase());
          if (matchNode) {
            const currentAttrs = (matchNode.attributes as any[]) || [];
            const updatedAttrs = currentAttrs.filter(a => a.name?.toLowerCase() !== item.attributeName?.toLowerCase());
            const updated = await prisma.node.update({
              where: { id: matchNode.id },
              data: { attributes: updatedAttrs },
            });
            updatedNodes.push(updated);
          }
        }
      }

      // Process methodsToRemove
      if (aiResponse.methodsToRemove && aiResponse.methodsToRemove.length > 0) {
        for (const item of aiResponse.methodsToRemove) {
          const matchNode = existingNodes.find(n => n.name.toLowerCase() === item.className?.toLowerCase());
          if (matchNode) {
            const currentMeths = (matchNode.methods as any[]) || [];
            const updatedMeths = currentMeths.filter(m => m.name?.toLowerCase() !== item.methodName?.toLowerCase());
            const updated = await prisma.node.update({
              where: { id: matchNode.id },
              data: { methods: updatedMeths },
            });
            updatedNodes.push(updated);
          }
        }
      }

      // Process classesModified
      if (aiResponse.classesModified && aiResponse.classesModified.length > 0) {
        for (const mod of aiResponse.classesModified) {
          const matchNode = existingNodes.find(n => n.name.toLowerCase() === mod.name?.toLowerCase());
          if (matchNode) {
            const currentAttrs = (matchNode.attributes as any[]) || [];
            const currentMeths = (matchNode.methods as any[]) || [];
            const newAttrs = mod.attributesToAdd || mod.attributes || [];
            const newMeths = mod.methodsToAdd || mod.methods || [];

            const updatedAttrs = [...currentAttrs];
            for (const a of newAttrs) {
              if (!updatedAttrs.some(x => x.name?.toLowerCase() === a.name?.toLowerCase())) {
                updatedAttrs.push(a);
              }
            }

            const updatedMeths = [...currentMeths];
            for (const m of newMeths) {
              if (!updatedMeths.some(x => x.name?.toLowerCase() === m.name?.toLowerCase())) {
                updatedMeths.push(m);
              }
            }

            const updated = await prisma.node.update({
              where: { id: matchNode.id },
              data: { attributes: updatedAttrs, methods: updatedMeths },
            });
            updatedNodes.push(updated);
          }
        }
      }

      // Process classesGenerated
      if (aiResponse.classesGenerated && aiResponse.classesGenerated.length > 0) {
        let currentX = 120;
        let currentY = 120;

        for (const cls of aiResponse.classesGenerated) {
          const matchNode = existingNodes.find(n => n.name.toLowerCase() === cls.name?.toLowerCase());
          if (matchNode) {
            const currentAttrs = (matchNode.attributes as any[]) || [];
            const currentMeths = (matchNode.methods as any[]) || [];
            const newAttrs = cls.attributes || [];
            const newMeths = cls.methods || [];

            const updatedAttrs = [...currentAttrs];
            for (const a of newAttrs) {
              if (!updatedAttrs.some(x => x.name?.toLowerCase() === a.name?.toLowerCase())) {
                updatedAttrs.push(a);
              }
            }

            const updatedMeths = [...currentMeths];
            for (const m of newMeths) {
              if (!updatedMeths.some(x => x.name?.toLowerCase() === m.name?.toLowerCase())) {
                updatedMeths.push(m);
              }
            }

            const updated = await prisma.node.update({
              where: { id: matchNode.id },
              data: { attributes: updatedAttrs, methods: updatedMeths },
            });
            updatedNodes.push(updated);
          } else {
            const node = await prisma.node.create({
              data: {
                diagramId: diagram.id,
                name: cls.name,
                stereotype: cls.stereotype || 'Entity',
                attributes: cls.attributes || [],
                methods: cls.methods || [],
                positionX: currentX,
                positionY: currentY,
              },
            });
            createdNodes.push(node);
            currentX += 260;
          }
        }
      }
    }

    res.json({
      aiResponse,
      createdNodes,
      updatedNodes,
      deletedNodeIds,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al procesar nota de voz: ' + error.message });
  }
};

export const getAIChatHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;

    const history = await prisma.aIChatHistory.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });

    res.json(history);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al obtener historial IA: ' + error.message });
  }
};
