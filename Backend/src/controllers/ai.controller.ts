import { Response } from 'express';
import { prisma } from '../config/prisma';
import { AuthRequest } from '../middlewares/auth.middleware';
import { AIAgentService } from '../services/ai.service';
import { SupportAIAgentService } from '../services/support-ai.service';

export const handleTextPrompt = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId, prompt, model, diagramContext } = req.body;
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

    const contextToUse = diagramContext || diagram;
    const aiResponse = await AIAgentService.processTextPrompt(prompt, contextToUse, model);

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
          const srcName = conn.sourceClassName || (conn as any).sourceNodeName || (conn as any).source;
          const tgtName = conn.targetClassName || (conn as any).targetNodeName || (conn as any).target;
          const assocName = conn.associationClassName || (conn as any).associationClassNode || (conn as any).associationClass;

          const srcNode = allDiagramNodes.find(n => n.name.toLowerCase() === srcName?.toLowerCase());
          const tgtNode = allDiagramNodes.find(n => n.name.toLowerCase() === tgtName?.toLowerCase());
          const assocNode = assocName ? allDiagramNodes.find(n => n.name.toLowerCase() === assocName?.toLowerCase()) : undefined;

          if (srcNode && tgtNode) {
            const newConn = await prisma.connector.create({
              data: {
                diagramId: diagram.id,
                sourceNodeId: srcNode.id,
                targetNodeId: tgtNode.id,
                type: conn.type || 'Association',
                sourceMultiplicity: conn.sourceMultiplicity !== undefined ? conn.sourceMultiplicity : '',
                targetMultiplicity: conn.targetMultiplicity !== undefined ? conn.targetMultiplicity : '',
                label: conn.label || '',
                associationClassNodeId: assocNode ? assocNode.id : undefined,
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
              associationClassNodeId: assocNode ? assocNode.id : undefined,
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
      include: { nodes: true, connectors: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (!diagram) {
      diagram = await prisma.diagram.create({
        data: { projectId, name: 'Main Diagram' },
        include: { nodes: true, connectors: true },
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
      // Purge previous nodes and connectors for a 100% clean import of the photo diagram
      await prisma.connector.deleteMany({ where: { diagramId: diagram.id } }).catch(() => {});
      await prisma.node.deleteMany({ where: { diagramId: diagram.id } }).catch(() => {});

      let startX = 80;
      let startY = 80;
      let colIndex = 0;

      // Prepare node creation payloads
      const nodeCreationPromises = detectedClasses.map((cls: any, idx: number) => {
        const posX = (cls.positionX !== undefined && cls.positionX !== null && !isNaN(cls.positionX))
          ? Number(cls.positionX)
          : startX + (idx % 3) * 320;
        const posY = (cls.positionY !== undefined && cls.positionY !== null && !isNaN(cls.positionY))
          ? Number(cls.positionY)
          : startY + Math.floor(idx / 3) * 260;

        const clsName = cls.name || cls.className || `Class_${idx + 1}`;

        return prisma.node.create({
          data: {
            diagramId: diagram.id,
            name: clsName,
            stereotype: cls.stereotype || 'Entity',
            attributes: cls.attributes || [],
            methods: cls.methods || [],
            positionX: posX,
            positionY: posY,
          },
        }).then(node => ({ node, originalCls: cls }));
      });

      const nodeResults = await Promise.all(nodeCreationPromises);
      const tempIdToNodeMap = new Map<string, any>();
      const nameToNodesMap = new Map<string, any[]>();

      for (const resItem of nodeResults) {
        const node = resItem.node;
        const cls = resItem.originalCls;
        createdNodes.push(node);

        if (cls.tempId) tempIdToNodeMap.set(String(cls.tempId).toLowerCase(), node);
        if (cls.id) tempIdToNodeMap.set(String(cls.id).toLowerCase(), node);

        const lowerName = (node.name || '').trim().toLowerCase();
        const list = nameToNodesMap.get(lowerName) || [];
        list.push(node);
        nameToNodesMap.set(lowerName, list);
      }

      const findNode = (tempIdRef?: string, classNameRef?: string): any | undefined => {
        if (tempIdRef) {
          const foundByTemp = tempIdToNodeMap.get(String(tempIdRef).toLowerCase());
          if (foundByTemp) return foundByTemp;
        }
        if (classNameRef) {
          const lowerName = classNameRef.trim().toLowerCase();
          const matches = nameToNodesMap.get(lowerName);
          if (matches && matches.length > 0) {
            return matches.shift(); // Consume match for distinct instances if duplicate names exist
          }
        }
        return undefined;
      };

      // Create relationships/connectors detected in the photo concurrently
      if (detectedConnectors && detectedConnectors.length > 0) {
        const connectorPayloads: any[] = [];

        for (const conn of detectedConnectors) {
          const srcTemp = conn.sourceTempId || conn.sourceId;
          const tgtTemp = conn.targetTempId || conn.targetId;
          const assocTemp = conn.associationClassTempId || conn.associationClassId;

          const srcName = conn.sourceClassName || conn.sourceNodeName || conn.source || conn.sourceClass;
          const tgtName = conn.targetClassName || conn.targetNodeName || conn.target || conn.targetClass;
          const assocName = conn.associationClassName || conn.associationClassNode || conn.associationClass;

          const srcNode = findNode(srcTemp, srcName);
          const tgtNode = findNode(tgtTemp, tgtName);
          const assocNode = findNode(assocTemp, assocName);

          if (srcNode && tgtNode) {
            let type = conn.type || 'Association';
            let finalSrcId = srcNode.id;
            let finalTgtId = tgtNode.id;
            let finalSrcMult = (conn.sourceMultiplicity !== undefined && conn.sourceMultiplicity !== null) ? String(conn.sourceMultiplicity) : '';
            let finalTgtMult = (conn.targetMultiplicity !== undefined && conn.targetMultiplicity !== null) ? String(conn.targetMultiplicity) : '';

            // Composition & Aggregation Normalization: SVG renderer draws the diamond on targetNodeId.
            // If Gemini output srcNode as the parent container (e.g. Cliente) and tgtNode as child (e.g. comprador/Vendedor),
            // flip source and target so targetNodeId receives the diamond on Cliente's border.
            if (type === 'Composition' || type === 'Aggregation') {
              const srcLower = (srcNode.name || '').toLowerCase();
              const tgtLower = (tgtNode.name || '').toLowerCase();

              // If srcNode is parent container (like Cliente) and tgtNode is child (comprador, Vendedor), flip endpoints
              if (srcLower === 'cliente' || srcLower.includes('cliente') || srcLower.includes('parent') || srcLower.includes('padre')) {
                finalSrcId = tgtNode.id;
                finalTgtId = srcNode.id;
                const tempM = finalSrcMult;
                finalSrcMult = finalTgtMult;
                finalTgtMult = tempM;
              }
            }

            connectorPayloads.push({
              diagramId: diagram.id,
              sourceNodeId: finalSrcId,
              targetNodeId: finalTgtId,
              type: type,
              sourceMultiplicity: finalSrcMult,
              targetMultiplicity: finalTgtMult,
              label: conn.label || '',
              associationClassNodeId: assocNode ? assocNode.id : undefined,
            });
          }
        }

        if (connectorPayloads.length > 0) {
          const connectorPromises = connectorPayloads.map(payload => prisma.connector.create({ data: payload }));
          const savedConnectors = await Promise.all(connectorPromises);
          createdConnectors = savedConnectors.map(connector => ({
            id: connector.id,
            sourceNodeId: connector.sourceNodeId,
            targetNodeId: connector.targetNodeId,
            type: connector.type,
            sourceMultiplicity: connector.sourceMultiplicity,
            targetMultiplicity: connector.targetMultiplicity,
            label: connector.label,
            associationClassNodeId: connector.associationClassNodeId || undefined,
          }));
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
    const { projectId, model, diagramContext: rawContext } = req.body;
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

    let contextToUse = diagram;
    if (rawContext) {
      try { contextToUse = typeof rawContext === 'string' ? JSON.parse(rawContext) : rawContext; } catch {}
    }

    const aiResponse = await AIAgentService.processVoicePrompt(file.path, file.mimetype, contextToUse, model);

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

    const response = await SupportAIAgentService.processSupportPrompt(prompt, isInteractiveMode, model);
    res.json(response);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al procesar consulta de soporte: ' + error.message });
  }
};

