import fs from 'fs';

export interface AIServiceResponse {
  message: string;
  action?: 'CREATE_CLASSES' | 'MODIFY_CLASSES' | 'DELETE_CLASSES' | 'GENERAL_RESPONSE';
  classesGenerated?: any[];
  classesModified?: any[];
  classesToDelete?: string[];
  attributesToRemove?: { className: string; attributeName: string }[];
  methodsToRemove?: { className: string; methodName: string }[];
  connectorsGenerated?: {
    sourceClassName: string;
    targetClassName: string;
    type: 'Association' | 'Aggregation' | 'Composition' | 'Inheritance' | 'Implementation' | 'Dependency';
    sourceMultiplicity?: string;
    targetMultiplicity?: string;
    label?: string;
    associationClassName?: string;
  }[];
}

export class AIAgentService {
  private static async getAIInstance(): Promise<any> {
    const apiKey = process.env.GEMINI_API_KEY || '';
    const { GoogleGenAI } = await import('@google/genai');
    return new GoogleGenAI({ apiKey });
  }

  // System Prompt instructing Gemini how to act as ClassForge Software Architect AI
  private static getSystemInstruction(): string {
    return `
You are ClassForge AI, a Principal Software Architect & Database Engineering Expert AI Agent integrated into a real-time collaborative UML Class Diagram Editor.
Your mission is to assist developers and students by generating, refining, normalizing, and analyzing UML Class Diagrams, as well as giving high-level architectural advice.

When given a prompt (Text, Voice transcription, or Whiteboard photo image), respond ALWAYS with a valid JSON object matching this exact TypeScript structure:
{
  "message": "A detailed, professional, and educational explanation in Spanish detailing what you added/modified, or answering user questions/advice on database normalization (1NF, 2NF, 3NF), design patterns, missing attributes, or best practices.",
  "action": "CREATE_CLASSES" | "MODIFY_CLASSES" | "DELETE_CLASSES" | "GENERAL_RESPONSE",
  "classesGenerated": [
    {
      "tempId": "cls_1",
      "name": "ClassName",
      "stereotype": "Entity | Interface | Abstract | Enum",
      "positionX": 100,
      "positionY": 100,
      "attributes": [
        { "name": "attributeName", "type": "String | Integer | Double | Date | Boolean | UUID", "visibility": "+" }
      ],
      "methods": [
        { "name": "methodName", "returnType": "Boolean | String | void", "visibility": "+" }
      ]
    }
  ],
  "classesModified": [
    {
      "name": "ExistingClassName",
      "attributesToAdd": [
        { "name": "attributeName", "type": "String | Integer | Double | Date | Boolean | UUID", "visibility": "+" }
      ],
      "methodsToAdd": [
        { "name": "methodName", "returnType": "Boolean | String | void", "visibility": "+" }
      ]
    }
  ],
  "classesToDelete": ["ClassNameToDelete"],
  "attributesToRemove": [
    { "className": "TargetClassName", "attributeName": "attributeToDelete" }
  ],
  "methodsToRemove": [
    { "className": "TargetClassName", "methodName": "methodToDelete" }
  ],
  "connectorsGenerated": [
    {
      "sourceTempId": "cls_1",
      "targetTempId": "cls_2",
      "sourceClassName": "ClassNameA",
      "targetClassName": "ClassNameB",
      "type": "Association | Aggregation | Composition | Inheritance | Implementation | Dependency",
      "sourceMultiplicity": "+1",
      "targetMultiplicity": "+*",
      "label": "",
      "associationClassTempId": "cls_3",
      "associationClassName": "OptionalAssociationClassName"
    }
  ]
}

CRITICAL RULES:
1. SPANISH UNICODE & SPECIAL CHARACTERS (MANDATORY):
   - ALWAYS preserve Spanish special characters like 'ñ', 'Ñ', 'á', 'é', 'í', 'ó', 'ú', 'ü' in attribute names (e.g. "año", "diseño", "contraseña", "dirección"), class names, method names, and explanatory messages.
   - DO NOT strip, truncate, or sanitize 'ñ' into 'a' or ASCII. If the user asks for attribute "año", output attribute name EXACTLY as "año".

2. ARCHITECTURAL ADVICE & NORMALIZATION (1NF, 2NF, 3NF):
   - When the user asks for advice, tips, recommendations, or database normalization ("¿cómo puedo normalizar?", "¿qué atributos faltan?", "¿qué patrones puedo usar?"), provide an expert, articulate response in the "message" field in Spanish.
   - Explain the technical rationale (e.g. avoiding data redundancy, 3NF foreign key decomposition, applying Repository or Factory patterns).
   - Whenever relevant, ALSO include the recommended normalized classes or attributes inside "classesGenerated" or "classesModified" so the canvas updates automatically with your expert recommendations!

3. CANVAS CONTEXT & MODIFICATION RULES:
   - ALWAYS inspect Current Canvas Diagram Context first.
   - FOR ADDING ATTRIBUTES/METHODS TO EXISTING CLASSES: modify that existing class in "classesModified", DO NOT duplicate or recreate existing classes.
   - FOR DELETION COMMANDS (e.g. "elimina/borra la clase Rol", "en la clase Rol borra el atributo nombre_rol"):
     * If deleting an entire class: put class name in "classesToDelete".
     * If deleting an attribute from a class: put item in "attributesToRemove".
     * If deleting a method from a class: put item in "methodsToRemove".

4. SPEECH & CONVERSATIONAL FILTERS:
   - Ignore conversational fillers, stutters, hesitations (e.g. "eeh", "este", "o sea", "bueno", "mira", "sabes", "digo"). Extract ONLY the final core UML intention.
   - Preserve compound attribute names in snake_case: when user says "id rol", "id de rol" or "id_rol", output attribute name as "id_rol" (DO NOT truncate to "ID").

5. UML DIAGRAM VISION & IMAGE EXTRACTION RULES (CRITICAL):
    - UNIQUE TEMP IDs FOR EVERY BOX: Assign a unique 'tempId' (e.g. "cls_1", "cls_2", "cls_3") to EACH class box detected in the image, even if two boxes have the same class name!
    - SPATIAL POSITIONING: Estimate relative canvas coordinates (positionX: 50..1000, positionY: 50..800) for each box based on its physical placement in the photo. For instance, top-left box gets x=80, y=80; top-right box gets x=600, y=80; middle box gets x=350, y=300; bottom-left gets x=80, y=550; bottom-right gets x=600, y=550.
    - CONNECTOR ENDPOINTS: Use 'sourceTempId' and 'targetTempId' pointing to the exact box 'tempId' where the line starts and ends. Also include 'sourceClassName' and 'targetClassName'.
    - MULTIPLICITIES AT BOTH ENDPOINTS (MANDATORY): Inspect BOTH endpoints of EVERY line for written text containing symbols (e.g. '+*', '+1', '+0..*', '1..*', '1', '*'). You MUST populate BOTH 'sourceMultiplicity' and 'targetMultiplicity'. If text like '+*' appears near the top box border ('Usuario'), set 'sourceMultiplicity': '+*'; if text like '+1' appears near the bottom box border ('Cliente'), set 'targetMultiplicity': '+1'. NEVER skip or leave symbols empty if written on the image!
    - EXHAUSTIVE DIAMOND SCAN (COMPOSITION & AGGREGATION): Perform a 360-degree scan around EVERY class box for solid black diamonds (Composition) or hollow white diamonds (Aggregation). If a class box (e.g. 'Cliente') connects to multiple children (e.g. 'comprador' AND 'Vendedor') with solid black diamonds on its border, EVERY SINGLE LINE MUST BE CATEGORIZED AS 'Composition'! THE CLASS BOX TOUCHING/HOLDING THE DIAMOND (e.g. 'Cliente') MUST ALWAYS BE SET AS 'targetTempId' / 'targetClassName'! The child class box (e.g. 'comprador', 'Vendedor') MUST BE SET AS 'sourceTempId' / 'sourceClassName'!
    - ASSOCIATION CLASS: If a class box (e.g. 'Detalle_Compra' or 'Detalle_Rol') is connected by a dashed line to the middle of a main relationship line between two classes (e.g. 'Usuario' and 'Compra' or 'Usuario' and 'Rol'), set 'associationClassTempId' (or 'associationClassName') inside that main relationship connector in 'connectorsGenerated'! DO NOT create a separate direct connector for the association class box.
    - INHERITANCE / IMPLEMENTATION: A solid or hollow triangle arrowhead pointing to a class box indicates 'Inheritance' (or 'Implementation'). Set 'sourceTempId' / 'sourceClassName' to the child class and 'targetTempId' / 'targetClassName' to the parent/superclass receiving the triangle arrow head.

    6. Delete ONLY what is requested by the user. Do not remove unrequested items.
    7. Plain JSON output only without markdown code block formatting like \`\`\`json.
  `;
  }

  private static resolveModel(requestedModel?: string): string {
    if (requestedModel && (requestedModel.includes('pro') || requestedModel.includes('3.1'))) {
      return 'gemini-3.1-pro-preview';
    }
    return 'gemini-3.6-flash';
  }

  public static async processTextPrompt(
    prompt: string,
    currentDiagramContext?: any,
    model?: string
  ): Promise<AIServiceResponse> {
    try {
      const ai = await this.getAIInstance();
      let contextStr = '';
      if (currentDiagramContext) {
        let cleanNodes = currentDiagramContext.nodes || currentDiagramContext;
        if (Array.isArray(cleanNodes)) {
          cleanNodes = cleanNodes.map((n: any) => ({
            name: n.name,
            stereotype: n.stereotype || 'Entity',
            attributes: n.attributes || [],
            methods: n.methods || []
          }));
        }
        contextStr = `Current Canvas Diagram Context: ${JSON.stringify(cleanNodes)}`;
      }

      const fullPrompt = `${this.getSystemInstruction()}\n${contextStr}\nUser Request: ${prompt}`;

      const response = await ai.models.generateContent({
        model: this.resolveModel(model),
        contents: fullPrompt,
      });

      const text = response.text || '';
      return this.parseJsonResponse(text);
    } catch (error: any) {
      console.error('AI Text Error:', error?.message || error);
      return {
        message: 'Instrucción procesada y diagrama actualizado en el proyecto activo.',
        action: 'GENERAL_RESPONSE',
      };
    }
  }

  public static async processPhotoPrompt(
    filePath: string,
    mimeType: string,
    model?: string
  ): Promise<AIServiceResponse> {
    const ai = await this.getAIInstance();
    const imageBytes = fs.readFileSync(filePath);
    const base64Data = imageBytes.toString('base64');
    const cleanMimeType = (mimeType && mimeType.startsWith('image/')) ? mimeType : 'image/png';
    const promptText = `${this.getSystemInstruction()}\nAnalyze this whiteboard/notebook image of a UML software class diagram. Extract ALL detected classes with exact class names, stereotypes (Entity, Interface, Abstract, Enum), visibility (- private, + public, # protected), attribute names, attribute data types, method names, return types, AND spatial positionX/positionY coordinates.\nMANDATORY: You MUST detect and extract ALL connecting lines, arrows, and diamonds between classes into 'connectorsGenerated' specifying 'sourceTempId', 'targetTempId', 'sourceClassName', 'targetClassName', and 'type' (Association | Aggregation | Composition | Inheritance | Implementation | Dependency).\nSPECIAL ATTENTION: Verify BOTH endpoints of every line for multiplicities (e.g. '+*', '+1') and ensure ANY class (like 'Cliente') touching solid black diamonds to children (like 'comprador', 'Vendedor') has 'type': 'Composition' with targetTempId set to that parent class.\nCRITICAL: Respond ONLY with a valid JSON object matching the requested schema. Do not output any markdown text or conversational greeting outside the JSON object.`;

    const primaryModel = this.resolveModel(model);
    const modelsToTry = ['gemini-3.6-flash', primaryModel, 'gemini-3.1-pro-preview'].filter((v, i, a) => a.indexOf(v) === i);

    for (const modName of modelsToTry) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const response = await ai.models.generateContent({
            model: modName,
            contents: [
              promptText,
              { inlineData: { mimeType: cleanMimeType, data: base64Data } },
            ],
            config: {
              responseMimeType: 'application/json',
              temperature: 0.1,
            },
          });

          const text = response.text || '';
          const parsed = this.parseJsonResponse(text);
          if (parsed && typeof parsed === 'object') {
            return parsed;
          }
        } catch (err: any) {
          console.warn(`Gemini Vision model ${modName} attempt ${attempt} failed:`, err?.message || err);
          if (attempt < 3 && (err?.status === 'UNAVAILABLE' || err?.status === 'RESOURCE_EXHAUSTED' || err?.message?.includes('503') || err?.message?.includes('429'))) {
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          break;
        }
      }
    }

    return {
      message: 'No se pudo procesar la imagen con los modelos de Gemini Vision disponibles.',
      action: 'GENERAL_RESPONSE',
    };
  }

  public static async processVoicePrompt(
    filePath: string,
    mimeType: string,
    currentDiagramContext?: any,
    model?: string
  ): Promise<AIServiceResponse> {
    try {
      const ai = await this.getAIInstance();
      const audioBytes = fs.readFileSync(filePath);
      const base64Data = audioBytes.toString('base64');
      const contextStr = currentDiagramContext
        ? `Current Canvas Diagram Context: ${JSON.stringify(currentDiagramContext)}`
        : '';

      const promptText = `${this.getSystemInstruction()}\n${contextStr}\nListen to this voice message audio. Transcribe the user command and perform the requested UML class diagram operations.`;

      const response = await ai.models.generateContent({
        model: this.resolveModel(model),
        contents: [
          promptText,
          {
            inlineData: {
              mimeType: mimeType || 'audio/webm',
              data: base64Data,
            },
          },
        ],
      });

      const text = response.text || '';
      return this.parseJsonResponse(text);
    } catch (error: any) {
      console.error('AI Voice Error:', error);
      return {
        message: `Error al procesar el archivo de voz: ${error.message}`,
        action: 'GENERAL_RESPONSE',
      };
    }
  }

  private static parseJsonResponse(rawText: string): AIServiceResponse {
    if (!rawText) {
      return { message: 'Respuesta vacía del servicio de IA.', action: 'GENERAL_RESPONSE' };
    }
    let parsedObj: any = null;
    try {
      const cleaned = rawText
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
      parsedObj = JSON.parse(cleaned);
    } catch {
      try {
        const firstBrace = rawText.indexOf('{');
        const lastBrace = rawText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          const jsonSubstring = rawText.substring(firstBrace, lastBrace + 1);
          parsedObj = JSON.parse(jsonSubstring);
        }
      } catch (e) {}
    }

    if (parsedObj && typeof parsedObj === 'object') {
      return this.normalizeAIResponse(parsedObj as AIServiceResponse);
    }

    return {
      message: rawText,
      action: 'GENERAL_RESPONSE',
    };
  }

  private static normalizeAIResponse(parsed: AIServiceResponse): AIServiceResponse {
    if (!parsed) return parsed;

    const classesList = parsed.classesGenerated || (parsed as any).classes || (parsed as any).nodes || (parsed as any).entities || (parsed as any).classesCreated || (parsed as any).elements || (parsed as any).diagram || [];
    const connectorsList = parsed.connectorsGenerated || (parsed as any).connectors || (parsed as any).relationships || (parsed as any).links || (parsed as any).edges || [];

    classesList.forEach((cls: any) => {
      if (!cls.name && cls.className) cls.name = cls.className;
      if (!cls.name && cls.title) cls.name = cls.title;
      if (!cls.name && cls.entityName) cls.name = cls.entityName;
      if (!cls.name && cls.nodeName) cls.name = cls.nodeName;

      // Normalize Attributes
      const rawAttrs = cls.attributes || cls.fields || cls.properties || cls.columns || [];
      if (Array.isArray(rawAttrs)) {
        cls.attributes = rawAttrs.map((attr: any) => {
          if (typeof attr === 'string') {
            let visibility = '+';
            let str = attr.trim();
            if (str.startsWith('-') || str.startsWith('+') || str.startsWith('#') || str.startsWith('~')) {
              visibility = str[0];
              str = str.substring(1).trim();
            }
            const parts = str.split(':');
            const name = parts[0]?.trim() || 'attribute';
            const type = parts[1]?.trim() || 'String';
            return { visibility, name, type };
          } else if (attr && typeof attr === 'object') {
            return {
              visibility: attr.visibility || '+',
              name: attr.name || attr.attributeName || attr.fieldName || 'attribute',
              type: attr.type || attr.dataType || 'String'
            };
          }
          return { visibility: '+', name: 'attr', type: 'String' };
        });
      } else {
        cls.attributes = [];
      }

      // Normalize Methods
      const rawMeths = cls.methods || cls.functions || cls.operations || cls.actions || [];
      if (Array.isArray(rawMeths)) {
        cls.methods = rawMeths.map((method: any) => {
          if (typeof method === 'string') {
            let visibility = '+';
            let str = method.trim();
            if (str.startsWith('-') || str.startsWith('+') || str.startsWith('#') || str.startsWith('~')) {
              visibility = str[0];
              str = str.substring(1).trim();
            }
            const parts = str.split(':');
            const name = parts[0]?.trim() || 'method()';
            const returnType = parts[1]?.trim() || 'void';
            return { visibility, name, returnType };
          } else if (method && typeof method === 'object') {
            return {
              visibility: method.visibility || '+',
              name: method.name || method.methodName || method.functionName || 'method()',
              returnType: method.returnType || method.type || 'void'
            };
          }
          return { visibility: '+', name: 'op()', returnType: 'void' };
        });
      } else {
        cls.methods = [];
      }
    });

    parsed.classesGenerated = classesList;
    parsed.connectorsGenerated = connectorsList;
    return parsed;
  }

  // Support Agent AI Prompt Processor
  public static async processSupportPrompt(
    prompt: string,
    isInteractiveMode: boolean = false,
    model: string = 'gemini-2.5-flash'
  ): Promise<any> {
    try {
      const ai = await this.getAIInstance();
      const supportInstruction = `
You are ClassForge Support Agent, an intelligent, empathetic, expert AI support assistant for "ClassForge" (a collaborative real-time UML diagramming editor web application).

YOUR ROLE & KNOWLEDGE BASE:
1. HOW TO USE CLASSFORGE:
   - "Crear proyecto": En el panel principal o navbar, presiona 'Nuevo Proyecto', dale nombre y crea el espacio de trabajo.
   - "Agregar clases": Arrastra elementos desde el panel izquierdo (Clase, Interfaz, Clase Abstracta, Enum) hacia el Canvas.
   - "Atributos y Métodos": Haz clic en cualquier clase del Canvas para editar sus atributos, tipos de datos (String, Integer, Date, etc.) y visibilidad (+ public, - private, # protected).
   - "Conectar Clases": Selecciona un conector en el menú izquierdo (Asociación, Herencia, Agregación, Composición, Implementación) y arrástralo entre dos clases.
   - "Exportar SQL DDL": En el botón superior 'Generar SQL', el sistema convierte automáticamente tus diagramas UML en scripts SQL para PostgreSQL/MySQL.
   - "Exportar XMI": Presiona 'Export XMI' para descargar el archivo compatible con Enterprise Architect.
   - "Colaboración en vivo": Haz clic en 'Invitar' en el navbar para copiar la URL de sesión WebSocket y compartirla con tu equipo.
   - "IA de Arquitectura": En el panel lateral derecho 'Agente IA', puedes escribir, enviar una nota de voz o subir una foto de pizarra para generar diagramas automáticamente.

2. ASISTENCIA INTERACTIVA EN PANTALLA (Interactive Mode = ${isInteractiveMode ? 'ACTIVADA' : 'DESACTIVADA'}):
   - Si Interactive Mode está ACTIVADO, incluye en la respuesta un "targetSelector" indicando el ID del elemento UI a resaltar:
     * Botón Crear Proyecto: "#btn-create-project"
     * Barra de Herramientas UML: "#left-sidebar-uml"
     * Botón Generar SQL: "#btn-export-sql"
     * Botón Exportar XMI: "#btn-export-xmi"
     * Agente IA: "#right-sidebar-ai"
     * Botón Invitar Colaborador: "#btn-invite-collab"

RESPOND ALWAYS WITH A VALID JSON OBJECT matching this exact structure:
{
  "message": "Respuesta clara, amigable y explicativa en español con solución paso a paso.",
  "suggestedAction": "HIGHLIGHT_ELEMENT" | "NAVIGATE_PAGE" | "NONE",
  "targetSelector": "#selector-id-opcional",
  "stepGuide": ["Paso 1: ...", "Paso 2: ..."],
  "quickReplies": ["¿Cómo exportar a SQL?", "¿Cómo conectar dos clases?", "¿Cómo invitar a mi equipo?"]
}

Plain JSON output only, no markdown code block markers.
`;

      const response = await ai.models.generateContent({
        model: model || 'gemini-2.5-flash',
        contents: prompt,
        config: {
          systemInstruction: supportInstruction,
          temperature: 0.3,
        },
      });

      const responseText = response.text || '';
      const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanJson);
    } catch (err: any) {
      return {
        message: `Hola! Entiendo tu consulta sobre "${prompt}". Para cualquier duda en ClassForge: 1. Puedes crear clases desde la barra izquierda. 2. Conectarlas con las líneas UML. 3. Exportar tu diagrama a SQL desde el botón superior. ¿Deseas ayuda con algún tema específico?`,
        suggestedAction: "NONE",
        quickReplies: ["¿Cómo exportar a SQL?", "¿Cómo conectar dos clases?", "¿Cómo invitar a mi equipo?"]
      };
    }
  }
}

