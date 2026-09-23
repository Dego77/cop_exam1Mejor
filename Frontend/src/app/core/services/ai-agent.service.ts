import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { DiagramService, UMLNode, UMLConnector } from './diagram.service';

export interface AIMessage {
  sender: 'USER' | 'AI';
  mode: 'CHAT' | 'VOICE' | 'PHOTO';
  content: string;
  mediaUrl?: string;
  timestamp?: Date;
}

@Injectable({ providedIn: 'root' })
export class AIAgentService {
  private readonly apiUrl = 'http://3.138.124.211:3000/api/ai';

  constructor(
    private http: HttpClient, 
    private auth: AuthService,
    private diagramService: DiagramService
  ) {}

  private get headers(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
  }

  sendTextPrompt(projectId: string, prompt: string, model?: string, diagramContext?: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/chat`, { projectId, prompt, model, diagramContext }, { headers: this.headers });
  }

  sendPhoto(projectId: string, file: File, model?: string): Observable<any> {
    const formData = new FormData();
    formData.append('photo', file);
    formData.append('projectId', projectId);
    if (model) formData.append('model', model);
    return this.http.post(`${this.apiUrl}/photo`, formData, {
      headers: new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` })
    });
  }

  sendVoice(projectId: string, blob: Blob, model?: string, diagramContext?: any): Observable<any> {
    const formData = new FormData();
    formData.append('voice', blob, 'voice-note.webm');
    formData.append('projectId', projectId);
    if (model) formData.append('model', model);
    if (diagramContext) formData.append('diagramContext', JSON.stringify(diagramContext));
    return this.http.post(`${this.apiUrl}/voice`, formData, {
      headers: new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` })
    });
  }

  getChatHistory(projectId: string): Observable<AIMessage[]> {
    return this.http.get<AIMessage[]>(`${this.apiUrl}/history/${projectId}`, { headers: this.headers });
  }

  /**
   * High-Precision Natural Language UML Parser (Client-side AI Engine)
   * Parses Spanish commands like:
   * "agregame una clase q se llame rol y q tenga atributos id_rol"
   * "relaciona Usuario con Rol"
   */
  private normalizeSpeechPrompt(prompt: string): string {
    let clean = prompt.trim();
    // 1. Remove speech fillers, stutters, and hesitations
    clean = clean.replace(/\b(eeh|ehh|ehmm|este|o\s+sea|osea|bueno|mira|sabes|digo|eh|ajá|mmm|mm)\b/gi, ' ');
    clean = clean.replace(/\s+/g, ' ').trim();

    // 2. Normalize compound PK/FK attribute patterns: "id rol" or "id de rol" -> "id_rol"
    clean = clean.replace(/\bid\s+(?:de\s+)?([A-Za-z0-9_áéíóúÁÉÍÓÚñÑ]+)\b/gi, (match, p1) => {
      const lowerP1 = p1.toLowerCase();
      if (['que', 'se', 'una', 'la', 'un', 'el', 'los', 'las', 'del'].includes(lowerP1)) return match;
      return `id_${lowerP1}`;
    });

    // 3. Normalize "nombre rol" / "nombre de rol" -> "nombre_rol"
    clean = clean.replace(/\bnombre\s+(?:de\s+)?([A-Za-z0-9_áéíóúÁÉÍÓÚñÑ]+)\b/gi, (match, p1) => {
      const lowerP1 = p1.toLowerCase();
      if (['que', 'se', 'una', 'la', 'un', 'el', 'los', 'las', 'del'].includes(lowerP1)) return match;
      return `nombre_${lowerP1}`;
    });

    // 4. Normalize "fecha creacion" / "fecha de creacion" -> "fecha_creacion"
    clean = clean.replace(/\bfecha\s+(?:de\s+)?([A-Za-z0-9_áéíóúÁÉÍÓÚñÑ]+)\b/gi, (match, p1) => {
      const lowerP1 = p1.toLowerCase();
      if (['que', 'se', 'una', 'la', 'un', 'el', 'los', 'las', 'del'].includes(lowerP1)) return match;
      return `fecha_${lowerP1}`;
    });

    return clean;
  }

  processSmartPromptLocally(prompt: string, currentNodes: UMLNode[], currentConnectors: UMLConnector[]): { message: string; createdNodes: UMLNode[]; createdConnectors: UMLConnector[] } {
    const cleanPrompt = this.normalizeSpeechPrompt(prompt);
    const createdNodes: UMLNode[] = [];
    const createdConnectors: UMLConnector[] = [];
    let responseMsg = '';

    // Calculate position X, Y to avoid overlapping existing cards
    let maxX = 120;
    let maxY = 80;
    if (currentNodes && currentNodes.length > 0) {
      currentNodes.forEach(n => {
        if (n.positionX > maxX) maxX = n.positionX;
        if (n.positionY > maxY) maxY = n.positionY;
      });
      maxX += 260; // place to the right
      if (maxX > 900) {
        maxX = 120;
        maxY += 220; // wrap to next row
      }
    }

    const stopWords = new Set(['q', 'que', 'se', 'llame', 'llamada', 'llamado', 'nombrada', 'nombrado', 'denominada', 'denominado', 'una', 'la', 'un', 'el', 'clase', 'entidad', 'interface', 'enum', 'y', 'con']);

    // 0. RELATIONSHIP DETECTION (Priority 1: "relacioname cliente y rol", "asocia usuario con rol")
    const isRelationCommand = /(?:relaciona|relacioname|relacionamelo|asocia|asociame|asociamelo|vincula|vinculame|conecta|conectame|une|uneme|asociacion|asociación|agregacion|agregación|composicion|composición|herencia)\b/i.test(cleanPrompt);

    if (isRelationCommand && currentNodes && currentNodes.length >= 2) {
      const mentionedNodes = currentNodes.filter(n => {
        const regex = new RegExp(`\\b${n.name}\\b`, 'i');
        return regex.test(cleanPrompt);
      });

      if (mentionedNodes.length >= 2) {
        const srcNode = mentionedNodes[0];
        const tgtNode = mentionedNodes[1];

        let connType = 'Association';
        if (/agregacion|agregación/i.test(cleanPrompt)) connType = 'Aggregation';
        if (/composicion|composición/i.test(cleanPrompt)) connType = 'Composition';
        if (/herencia/i.test(cleanPrompt)) connType = 'Inheritance';

        // Extract multiplicities for source and target
        let srcMult = '';
        let tgtMult = '';

        const srcMatch = cleanPrompt.match(new RegExp(`([0-9\\*\\+\\.-]+)\\s+(?:en|de|para)\\s+(?:clase\\s+)?${srcNode.name}`, 'i'));
        if (srcMatch && srcMatch[1]) {
          srcMult = srcMatch[1].startsWith('+') ? srcMatch[1] : `+${srcMatch[1]}`;
        }

        const tgtMatch = cleanPrompt.match(new RegExp(`([0-9\\*\\+\\.-]+)\\s+(?:en|de|para)\\s+(?:clase\\s+)?${tgtNode.name}`, 'i'));
        if (tgtMatch && tgtMatch[1]) {
          tgtMult = tgtMatch[1].startsWith('+') ? tgtMatch[1] : `+${tgtMatch[1]}`;
        }

        const newConn: UMLConnector = {
          id: `conn_ai_${Date.now()}`,
          sourceNodeId: srcNode.id,
          targetNodeId: tgtNode.id,
          type: connType,
          sourceMultiplicity: srcMult,
          targetMultiplicity: tgtMult,
          label: ''
        };

        createdConnectors.push(newConn);
        const currentConnectorsList = this.diagramService.currentConnectors;
        (this.diagramService as any).connectorsSubject.next([...currentConnectorsList, newConn]);
        this.diagramService.addConnector(newConn).subscribe();

        responseMsg = `🔗 He conectado **${srcNode.name}** con **${tgtNode.name}** (${connType}) con multiplicidades **${srcMult}** y **${tgtMult}**.`;
        return { message: responseMsg, createdNodes: [], createdConnectors };
      }
    }

    // ABSOLUTE CHECK: Does prompt target an EXISTING class in currentNodes?
    let targetExistingNode: UMLNode | undefined;
    if (currentNodes && currentNodes.length > 0) {
      targetExistingNode = currentNodes.find(n => {
        const regex = new RegExp(`\\b${n.name}\\b`, 'i');
        return regex.test(cleanPrompt);
      });
    }

    const isDeleteCommand = /(?:elimina|eliminame|eliminamelo|borra|borralo|borramelo|quita|quitalo|quitamelo|remover|eliminar|borrar)\b/i.test(cleanPrompt);

    if (targetExistingNode) {
      const mentionsAttributeOrMethod = /(?:atributo|campo|propiedad|metodo|método)/i.test(cleanPrompt);

      // CASO A: ELIMINAR CLASE COMPLETA (Si pide eliminar/borrar y no especifica atributo ni método)
      if (isDeleteCommand && !mentionsAttributeOrMethod) {
        this.diagramService.deleteNode(targetExistingNode.id);
        responseMsg = `✨ He eliminado la clase **${targetExistingNode.name}** del lienzo y del proyecto.`;
        return { message: responseMsg, createdNodes: [], createdConnectors: [] };
      }

      // Extract target attribute/method name requested
      let extractedItemName = '';
      const explicitMatch = cleanPrompt.match(/(?:q\s+se\s+llame|que\s+se\s+llame|llamado|llamada|nombrado|nombrada|denominado|denominada)\s+([A-Za-z0-9_áéíóúÁÉÍÓÚñÑ]+)/i);
      if (explicitMatch && explicitMatch[1]) {
        extractedItemName = explicitMatch[1];
      } else {
        const itemMatch = cleanPrompt.match(/(?:atributo|campo|propiedad|metodo|método)\s+([A-Za-z0-9_áéíóúÁÉÍÓÚñÑ]+)/i);
        if (itemMatch && itemMatch[1]) {
          extractedItemName = itemMatch[1];
        } else {
          // Fallback: match last word if user says "borra el atributo nombre_rol"
          const lastWordMatch = cleanPrompt.match(/(?:atributo|campo|propiedad|metodo|método)\s+.*?\b([A-Za-z0-9_áéíóúÁÉÍÓÚñÑ]+)$/i);
          if (lastWordMatch && lastWordMatch[1]) {
            extractedItemName = lastWordMatch[1];
          }
        }
      }

      if (extractedItemName && isDeleteCommand) {
        // CASO B: ELIMINAR ATRIBUTO O MÉTODO ESPECÍFICO DE LA CLASE
        const isMethod = cleanPrompt.toLowerCase().includes('metodo') || cleanPrompt.toLowerCase().includes('método');
        if (isMethod) {
          const currentMethods = targetExistingNode.methods || [];
          const updatedMethods = currentMethods.filter((m: any) => m.name?.toLowerCase() !== extractedItemName.toLowerCase());
          this.diagramService.updateNode(targetExistingNode.id, { methods: updatedMethods });
          responseMsg = `✨ He eliminado el método **${extractedItemName}** de la clase **${targetExistingNode.name}**.`;
        } else {
          const currentAttrs = targetExistingNode.attributes || [];
          const updatedAttrs = currentAttrs.filter((a: any) => a.name?.toLowerCase() !== extractedItemName.toLowerCase());
          this.diagramService.updateNode(targetExistingNode.id, { attributes: updatedAttrs });
          responseMsg = `✨ He eliminado el atributo **${extractedItemName}** de la clase **${targetExistingNode.name}**.`;
        }
        return { message: responseMsg, createdNodes: [], createdConnectors: [] };
      }

      if (extractedItemName && !isDeleteCommand) {
        // CASO C: AÑADIR ATRIBUTO O MÉTODO A LA CLASE EXISTENTE
        const isMethod = cleanPrompt.toLowerCase().includes('metodo') || cleanPrompt.toLowerCase().includes('método');
        if (isMethod) {
          const currentMethods = targetExistingNode.methods || [];
          if (!currentMethods.some((m: any) => m.name?.toLowerCase() === extractedItemName.toLowerCase())) {
            const updatedMethods = [...currentMethods, { name: extractedItemName, returnType: 'void', visibility: '+' }];
            this.diagramService.updateNode(targetExistingNode.id, { methods: updatedMethods });
            responseMsg = `✨ He añadido el método **${extractedItemName}()** a la clase **${targetExistingNode.name}** existente.`;
          } else {
            responseMsg = `La clase **${targetExistingNode.name}** ya contiene el método **${extractedItemName}**.`;
          }
        } else {
          const currentAttrs = targetExistingNode.attributes || [];
          if (!currentAttrs.some((a: any) => a.name?.toLowerCase() === extractedItemName.toLowerCase())) {
            const updatedAttrs = [...currentAttrs, { name: extractedItemName, type: 'String', visibility: '+' }];
            this.diagramService.updateNode(targetExistingNode.id, { attributes: updatedAttrs });
            responseMsg = `✨ He añadido el atributo **${extractedItemName}** a la clase **${targetExistingNode.name}** existente.`;
          } else {
            responseMsg = `La clase **${targetExistingNode.name}** ya contiene el atributo **${extractedItemName}**.`;
          }
        }

        return { message: responseMsg, createdNodes: [], createdConnectors: [] };
      }
    }

    // 1. High-precision Class Name Extraction (Only for NEW classes that do not exist)
    let rawClassName = '';
    const explicitNameMatch = cleanPrompt.match(/(?:q\s+se\s+llame|que\s+se\s+llame|llamada|llamado|nombrada|nombrado|denominada|denominado)\s+([A-Za-z0-9_áéíóúÁÉÍÓÚñÑ]+)/i);
    if (explicitNameMatch && explicitNameMatch[1]) {
      rawClassName = explicitNameMatch[1];
    } else {
      const classKeywordsMatch = cleanPrompt.match(/(?:clase|entidad|interface|enum)\s+([A-Za-z0-9_áéíóúÁÉÍÓÚñÑ]+)/i);
      if (classKeywordsMatch && classKeywordsMatch[1] && !stopWords.has(classKeywordsMatch[1].toLowerCase())) {
        rawClassName = classKeywordsMatch[1];
      } else {
        const verbMatch = cleanPrompt.match(/(?:agrega|agregame|crea|creame|añade|añademe|nueva|poner|insertar)\s+(?:me\s+)?(?:una\s+|la\s+|un\s+|el\s+)?([A-Za-z0-9_áéíóúÁÉÍÓÚñÑ]+)/i);
        if (verbMatch && verbMatch[1] && !stopWords.has(verbMatch[1].toLowerCase())) {
          rawClassName = verbMatch[1];
        }
      }
    }

    if (rawClassName) {
      const className = rawClassName.charAt(0).toUpperCase() + rawClassName.slice(1);

      // Check if className already exists in currentNodes before creating!
      const existing = currentNodes?.find(n => n.name.toLowerCase() === className.toLowerCase());
      if (existing) {
        // If it already exists, do not create a duplicate class!
        responseMsg = `La clase **${existing.name}** ya existe en tu diagrama.`;
        return { message: responseMsg, createdNodes: [], createdConnectors: [] };
      }

      // Extract attributes mentioned (e.g. "q tenga como atributos id_rol", "con atributos id, nombre: String")
      const attributes: any[] = [];
      const attrSectionMatch = cleanPrompt.match(/(?:tenga|tengan|con|atributo|atributos|campos?|propiedad|propiedades)\s+(?:como\s+atributos?\s+)?([A-Za-z0-9_áéíóúÁÉÍÓÚñÑ:\s,]+)/i);

      if (attrSectionMatch && attrSectionMatch[1]) {
        const rawTokens = attrSectionMatch[1].split(/,|\sy\s|\scom\s|\scomo\s/i);
        rawTokens.forEach(raw => {
          let cleanAttr = raw.replace(/\b(?:atributos?|campos?|propiedad(?:es)?|de|como|con|tenga|tengan|y)\b/gi, '').trim();
          cleanAttr = cleanAttr.replace(/^s\b/i, '').replace(/^_\b/i, '').trim();

          if (cleanAttr) {
            let attrName = cleanAttr;
            let attrType = 'String';

            if (cleanAttr.includes(':')) {
              const parts = cleanAttr.split(':');
              attrName = parts[0].trim();
              attrType = parts[1].trim();
            } else if (cleanAttr.toLowerCase().includes('id') || cleanAttr.toLowerCase().endsWith('_id')) {
              attrType = 'Int';
            } else if (cleanAttr.toLowerCase().includes('fecha') || cleanAttr.toLowerCase().includes('date')) {
              attrType = 'Date';
            } else if (cleanAttr.toLowerCase().includes('monto') || cleanAttr.toLowerCase().includes('precio')) {
              attrType = 'Double';
            }

            const idMatch = attrName.match(/[A-Za-z_áéíóúÁÉÍÓÚñÑ][A-Za-z0-9_áéíóúÁÉÍÓÚñÑ]*/);
            if (idMatch) {
              attrName = idMatch[0];
              if (attrName && !stopWords.has(attrName.toLowerCase()) && !attributes.some(a => a.name === attrName)) {
                attributes.push({ visibility: '+', name: attrName, type: attrType });
              }
            }
          }
        });
      }

      // If no attribute extracted, add default ID attribute
      if (attributes.length === 0) {
        const defaultId = `id_${className.toLowerCase()}`;
        attributes.push({ visibility: '+', name: defaultId, type: 'Int' });
      }

      const newNode: UMLNode = {
        id: `node_ai_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        name: className,
        stereotype: 'Entity',
        positionX: maxX,
        positionY: maxY,
        attributes,
        methods: []
      };

      createdNodes.push(newNode);
      this.diagramService.addLocalNode(newNode);

      responseMsg = `✨ He creado la clase **${className}** con ${attributes.length} atributo(s) (${attributes.map(a => a.name).join(', ')}) en tu proyecto activo.`;
    }

    // 2. Detect Relationship / Connector creation (e.g., "relaciona Usuario con Rol")
    const relMatch = cleanPrompt.match(/(?:relaciona|conecta|asocia|vincula)\s+(?:a\s+)?([A-Za-z0-9_áéíóúÁÉÍÓÚñÑ]+)\s+(?:con|y|a)\s+([A-Za-z0-9_áéíóúÁÉÍÓÚñÑ]+)/i);
    if (relMatch && relMatch[1] && relMatch[2]) {
      const srcName = relMatch[1].trim();
      const tgtName = relMatch[2].trim();

      const allNodes = [...currentNodes, ...createdNodes];
      const sourceNode = allNodes.find(n => n.name.toLowerCase() === srcName.toLowerCase());
      const targetNode = allNodes.find(n => n.name.toLowerCase() === tgtName.toLowerCase());

      if (sourceNode && targetNode) {
        let connType = 'Association';
        if (cleanPrompt.includes('agregacion') || cleanPrompt.includes('agregación')) connType = 'Aggregation';
        if (cleanPrompt.includes('composicion') || cleanPrompt.includes('composición')) connType = 'Composition';
        if (cleanPrompt.includes('herencia')) connType = 'Inheritance';

        const newConn: UMLConnector = {
          id: `conn_ai_${Date.now()}`,
          sourceNodeId: sourceNode.id,
          targetNodeId: targetNode.id,
          type: connType,
          sourceMultiplicity: '1',
          targetMultiplicity: '*',
          label: ''
        };

        createdConnectors.push(newConn);
        const currentConnectorsList = this.diagramService.currentConnectors;
        (this.diagramService as any).connectorsSubject.next([...currentConnectorsList, newConn]);

        responseMsg += ` 🔗 He conectado **${sourceNode.name}** con **${targetNode.name}** (${connType}).`;
      }
    }

    if (!responseMsg) {
      responseMsg = `He procesado tu instrucción. Diagrama de arquitectura actualizado con éxito.`;
    }

    return { message: responseMsg, createdNodes, createdConnectors };
  }
}
