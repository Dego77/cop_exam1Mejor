import { Response } from 'express';
import { prisma } from '../config/prisma';
import { AuthRequest } from '../middlewares/auth.middleware';
import { AIAgentService } from '../services/ai.service';

export const handleTextPrompt = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId, prompt, model } = req.body;
    const userId = req.user!.id;

    if (!projectId || !prompt) {
      res.status(400).json({ error: 'projectId y prompt son requeridos.' });
      return;
    }

    let diagram = await prisma.diagram.findFirst({
      where: { projectId },
      include: { nodes: true, connectors: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (!diagram) {
      diagram = await prisma.diagram.create({
        data: { projectId, name: 'Main Diagram' },
        include: { nodes: true, connectors: true },
      });
    }

    const aiResponse = await AIAgentService.processTextPrompt(prompt, diagram, model);

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
    const { projectId, model } = req.body;
    const userId = req.user!.id;
    const file = req.file;

    if (!projectId || !file) {
      res.status(400).json({ error: 'projectId y archivo de imagen son requeridos.' });
      return;
    }

    let diagram = await prisma.diagram.findFirst({
      where: { projectId },
      orderBy: { updatedAt: 'desc' },
    });

    if (!diagram) {
      diagram = await prisma.diagram.create({
        data: { projectId, name: 'Main Diagram' },
      });
    }

    const aiResponse = await AIAgentService.processPhotoPrompt(file.path, file.mimetype, model);

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

    const detectedClasses = aiResponse.classesGenerated || (aiResponse as any).classes || (aiResponse as any).nodes || (aiResponse as any).classesCreated || [];
    const detectedConnectors = aiResponse.connectorsGenerated || (aiResponse as any).connectors || (aiResponse as any).relationships || [];

    if (diagram && detectedClasses && detectedClasses.length > 0) {
      let startX = 100;
      let startY = 80;
      let colIndex = 0;
      const nodesMap = new Map<string, any>();

      for (const cls of detectedClasses) {
        const posX = startX + (colIndex % 3) * 320;
        const posY = startY + Math.floor(colIndex / 3) * 260;

        const node = await prisma.node.create({
          data: {
            diagramId: diagram.id,
            name: cls.name || cls.className || `Class_${colIndex + 1}`,
            stereotype: cls.stereotype || 'Entity',
            attributes: cls.attributes || [],
            methods: cls.methods || [],
            positionX: posX,
            positionY: posY,
          },
        });
        createdNodes.push(node);
        if (cls.name) nodesMap.set(cls.name.toLowerCase(), node);
        colIndex++;
      }
      const allDiagramNodes = [...(diagram.nodes || []), ...createdNodes];
      const findNodeInDiagram = (nameStr?: string) => {
        if (!nameStr) return undefined;
        const clean = nameStr.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
        return allDiagramNodes.find(n => {
          const nClean = (n.name || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
          return nClean === clean || nClean.includes(clean) || clean.includes(nClean);
        });
      };

      // Create relationships/connectors if detected in the photo
      if (detectedConnectors && detectedConnectors.length > 0) {
        for (const conn of detectedConnectors) {
          const srcName = conn.sourceClassName || conn.sourceNodeName || conn.source || conn.sourceClass;
          const tgtName = conn.targetClassName || conn.targetNodeName || conn.target || conn.targetClass;

          const srcNode = findNodeInDiagram(srcName);
          const tgtNode = findNodeInDiagram(tgtName);

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

      // Smart Auto-Synthesis: Infer relationships across all diagram nodes if connectors list is empty
      if (createdConnectors.length === 0 && allDiagramNodes.length >= 2) {
        const fallbackPairs: any[] = [];

        // 1. Foreign Key Attribute Matching
        for (let i = 0; i < allDiagramNodes.length; i++) {
          const srcNode = allDiagramNodes[i];
          const attrs = (srcNode.attributes as any[]) || [];
          for (const attr of attrs) {
            const attrName = (attr.name || '').trim().toLowerCase();
            if (attrName.length > 2 && (attrName.endsWith('id') || attrName.endsWith('_id'))) {
              const targetNamePart = attrName.replace(/_?id$/i, '');
              if (!targetNamePart) continue;

              const targetNode = allDiagramNodes.find(n => {
                if (n.id === srcNode.id) return false;
                const nClean = (n.name || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
                return nClean === targetNamePart || nClean.includes(targetNamePart) || targetNamePart.includes(nClean);
              });

              if (targetNode) {
                const exists = fallbackPairs.some(p => (p.src === srcNode.id && p.tgt === targetNode.id) || (p.src === targetNode.id && p.tgt === srcNode.id));
                if (!exists) {
                  fallbackPairs.push({ src: srcNode.id, tgt: targetNode.id, type: 'Composition', srcM: '0..*', tgtM: '1' });
                }
              }
            }
          }
        }

        // 2. Specific Domain Matching (Customer -> User, etc.)
        const userNode = findNodeInDiagram('user');
        const customerNode = findNodeInDiagram('customer');
        if (customerNode && userNode && customerNode.id !== userNode.id) {
          const exists = fallbackPairs.some(p => p.src === customerNode.id && p.tgt === userNode.id);
          if (!exists) {
            fallbackPairs.push({ src: customerNode.id, tgt: userNode.id, type: 'Inheritance', srcM: '', tgtM: '' });
          }
        }

        // 3. Fallback: Sequential Chain for remaining nodes
        if (fallbackPairs.length === 0 && allDiagramNodes.length >= 2) {
          for (let i = 0; i < allDiagramNodes.length - 1; i++) {
            fallbackPairs.push({
              src: allDiagramNodes[i + 1].id,
              tgt: allDiagramNodes[i].id,
              type: i === 0 ? 'Inheritance' : 'Composition',
              srcM: i === 0 ? '' : '0..*',
              tgtM: i === 0 ? '' : '1'
            });
          }
        }

        for (const pair of fallbackPairs) {
          const connector = await prisma.connector.create({
            data: {
              diagramId: diagram.id,
              sourceNodeId: pair.src,
              targetNodeId: pair.tgt,
              type: pair.type,
              sourceMultiplicity: pair.srcM,
              targetMultiplicity: pair.tgtM,
              label: ''
            }
          });
          createdConnectors.push(connector);
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
    const { projectId, model } = req.body;
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

    const aiResponse = await AIAgentService.processVoicePrompt(file.path, file.mimetype, diagram, model);

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

export const handleSupportPrompt = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { prompt, isInteractiveMode, model } = req.body;

    if (!prompt) {
      res.status(400).json({ error: 'El campo prompt es obligatorio.' });
      return;
    }

    const response = await AIAgentService.processSupportPrompt(prompt, isInteractiveMode, model);
    res.json(response);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al procesar consulta de soporte: ' + error.message });
  }
};

