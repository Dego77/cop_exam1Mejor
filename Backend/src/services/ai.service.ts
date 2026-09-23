import fs from 'fs';

export interface AIServiceResponse {
  message: string;
  action?: 'CREATE_CLASSES' | 'MODIFY_CLASSES' | 'DELETE_CLASSES' | 'GENERAL_RESPONSE';
  /** True only when the AI service call itself failed (after exhausting retries/fallback models), not for legitimate informational responses. */
  error?: boolean;
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
  connectorsToDelete?: {
    sourceClassName: string;
    targetClassName: string;
    type?: 'Association' | 'Aggregation' | 'Composition' | 'Inheritance' | 'Implementation' | 'Dependency';
  }[];
  connectorsModified?: {
    sourceClassName: string;
    targetClassName: string;
    newType?: 'Association' | 'Aggregation' | 'Composition' | 'Inheritance' | 'Implementation' | 'Dependency';
    newSourceMultiplicity?: string;
    newTargetMultiplicity?: string;
    newLabel?: string;
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
  ],
  "connectorsToDelete": [
    {
      "sourceClassName": "ClassNameA",
      "targetClassName": "ClassNameB",
      "type": "OptionalTypeToNarrowWhichRelationshipIfMultipleExistBetweenTheSamePair"
    }
  ],
  "connectorsModified": [
    {
      "sourceClassName": "ClassNameA",
      "targetClassName": "ClassNameB",
      "newType": "Association | Aggregation | Composition | Inheritance | Implementation | Dependency",
      "newSourceMultiplicity": "1",
      "newTargetMultiplicity": "*",
      "newLabel": ""
    }
  ]
}

CRITICAL RULES:
1. SPANISH UNICODE & SPECIAL CHARACTERS (MANDATORY):
   - ALWAYS preserve Spanish special characters like 'ñ', 'Ñ', 'á', 'é', 'í', 'ó', 'ú', 'ü' in attribute names (e.g. "año", "diseño", "contraseña", "dirección"), class names, method names, and explanatory messages.
   - DO NOT strip, truncate, or sanitize 'ñ' into 'a' or ASCII. If the user asks for attribute "año", output attribute name EXACTLY as "año".

2. ARCHITECTURAL ADVICE & NORMALIZATION (1NF, 2NF, 3NF) - OPT-IN ONLY:
   - When the user asks for advice, tips, recommendations, or database normalization ("¿cómo puedo normalizar?", "¿qué atributos faltan?", "¿qué patrones puedo usar?"), provide an expert, articulate response in the "message" field in Spanish.
   - Explain the technical rationale (e.g. avoiding data redundancy, 3NF foreign key decomposition, applying Repository or Factory patterns).
   - ONLY in that case (the user explicitly asked for advice/recommendations/normalization), ALSO include the recommended normalized classes or attributes inside "classesGenerated" or "classesModified" so the canvas updates automatically with your expert recommendations.
   - STRICT SCOPE OTHERWISE (MANDATORY): for every other request (creating/describing/extracting classes from text, voice, or a whiteboard photo), output ONLY the attributes/methods/classes the user explicitly named or that are literally written/drawn in the image. NEVER invent, guess, or "helpfully" add extra attributes, methods, or classes the user did not ask for and that are not visibly present in the source. If a class or box has no attributes stated, leave "attributes" as an empty array - do not fill it in with attributes you think a class like that "should" have.
   - THIS INCLUDES AUTO-GENERATED "id"/PRIMARY-KEY ATTRIBUTES (MANDATORY, no exception): do NOT add an "id", "id_<className>", or any other primary-key-looking attribute to a new class just because it "should" have one to be a valid entity. A request like "créame la clase Usuario" with nothing else specified means "classesGenerated" for "Usuario" with "attributes": [] (completely empty) - not even an id. Only add an id/pk attribute if the user explicitly asked for it by name or it is literally written/drawn in the source.

3. CANVAS CONTEXT & MODIFICATION RULES:
   - ALWAYS inspect Current Canvas Diagram Context first.
   - FOR ADDING ATTRIBUTES/METHODS TO EXISTING CLASSES: modify that existing class in "classesModified", DO NOT duplicate or recreate existing classes.
   - FOR DELETION COMMANDS (e.g. "elimina/borra la clase Rol", "en la clase Rol borra el atributo nombre_rol"):
     * If deleting an entire class: put class name in "classesToDelete".
     * If deleting an attribute from a class: put item in "attributesToRemove".
     * If deleting a method from a class: put item in "methodsToRemove".
   - FOR EDITING/CHANGING an attribute or method that ALREADY exists (rename it, change its type, change its visibility - e.g. "cambia el atributo precio de Rol a tipo Double", "renombra el método getTotal a calcularTotal"): this is NOT a new attribute, it's a replacement. In the SAME response, put the OLD one in "attributesToRemove"/"methodsToRemove" AND the NEW one in "classesModified" -> "attributesToAdd"/"methodsToAdd" for that class. Never leave both the old and the new version present at once.
   - FOR RELATIONSHIP/CONNECTOR COMMANDS between two EXISTING classes already on the canvas (e.g. "relaciona Usuario con Rol", "elimina la relación entre Usuario y Rol", "cambia esa asociación a composición", "pon la multiplicidad de Usuario en 0..1"):
     * Creating a NEW relationship that doesn't exist yet on the canvas: use "connectorsGenerated" (as described above).
     * Deleting an EXISTING relationship shown in Current Canvas Diagram Context: use "connectorsToDelete" with the two class names (and "type" only if you need to disambiguate because more than one relationship connects that same pair).
     * Changing the type and/or multiplicities of an EXISTING relationship without deleting it: use "connectorsModified" with the two class names and only the fields that actually change ("newType", "newSourceMultiplicity", "newTargetMultiplicity", "newLabel").
     * NEVER use "connectorsGenerated" to modify a relationship that is already in Current Canvas Diagram Context - that would create a duplicate line instead of changing the existing one.

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
    - IMPLICIT ASSOCIATION CLASS FROM MANY-TO-MANY CARDINALITY (MANDATORY, even with NO third box drawn/mentioned): If a relationship's 'sourceMultiplicity' AND 'targetMultiplicity' are BOTH many-valued (each one is '*', '1..*', or '0..*', with or without a leading '+'/'-'/'#'), it is a many-to-many relationship and MUST be modeled as an association class, exactly like a real UML class diagram normalizes an M:N relation into a junction table/class - even if the whiteboard/text only shows a plain line with those cardinalities and no intermediate box. In that case you MUST: (1) add a new entry to 'classesGenerated' for the junction class named '{SourceClassName}_{TargetClassName}' (stereotype 'Entity', positioned roughly between the two related boxes) WITH AN EMPTY "attributes" ARRAY - do NOT invent typical join-table columns like "cantidad" or "precio_unitario" on your own; only add attributes to it if the user's text or the whiteboard image explicitly names attributes for that specific junction class, and (2) set 'associationClassName' (matching that exact new class name) on that connector in 'connectorsGenerated'. Do this even when action is otherwise just describing/extracting an existing diagram.
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

  private static isTransientError(err: any): boolean {
    return err?.status === 'UNAVAILABLE' || err?.status === 'RESOURCE_EXHAUSTED' ||
      /503|429/.test(String(err?.message || ''));
  }

  // "limit: 0" means this model has ZERO quota on the current plan/key (e.g. a pro-tier model on
  // a free-tier key) - a permanent condition, not a transient rate limit. Retrying it wastes
  // attempts/delay on a call that can never succeed, so it should be skipped immediately instead
  // of going through the normal transient-error retry loop.
  private static isZeroQuotaError(err: any): boolean {
    return /limit:\s*0\b/i.test(String(err?.message || ''));
  }

  private static isAuthError(err: any): boolean {
    return err?.status === 'UNAUTHENTICATED' || err?.status === 'PERMISSION_DENIED' ||
      /api key|401|403|unauthenticated|permission_denied/i.test(String(err?.message || ''));
  }

  /**
   * Calls Gemini with up to 2 attempts per model, falling back through
   * gemini-3.6-flash -> requested model -> gemini-3.5-flash -> gemini-flash-latest on transient
   * errors (503/429). All three fallbacks are free-tier-accessible flash models (same working
   * pattern already used by support-ai.service.ts) - gemini-3.1-pro-preview used to be the last
   * fallback here, but it has ZERO quota on a free-tier key, so it was a guaranteed dead end that
   * only added latency. Used by both text and photo prompts so a flaky/overloaded model doesn't
   * fail one entry point while the other silently recovers.
   */
  private static async generateWithRetry(
    contents: any,
    config: Record<string, any> | undefined,
    model: string | undefined,
    logPrefix: string
  ): Promise<string> {
    const ai = await this.getAIInstance();
    const primaryModel = this.resolveModel(model);
    // gemini-2.5-flash goes last: an older, less-contended model kept as a final safety net for
    // when the newer 3.x models are all shedding load under "high demand" (503) at once - which
    // hits multimodal (photo/voice) requests hardest since they're heavier than plain text.
    const modelsToTry = ['gemini-3.6-flash', primaryModel, 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash'].filter((v, i, a) => a.indexOf(v) === i);

    let lastError: any = null;
    for (const modName of modelsToTry) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const response = await ai.models.generateContent({
            model: modName,
            contents,
            ...(config ? { config } : {}),
          });
          return response.text || '';
        } catch (err: any) {
          lastError = err;
          console.warn(`${logPrefix} model ${modName} attempt ${attempt} failed:`, err?.message || err);
          if (this.isZeroQuotaError(err)) {
            // Permanent for this model on this plan - move straight to the next model.
            break;
          }
          if (attempt < 2 && this.isTransientError(err)) {
            await new Promise(r => setTimeout(r, 1200));
            continue;
          }
          break;
        }
      }
    }
    throw lastError;
  }

  private static buildFailureResponse(error: any, context: string): AIServiceResponse {
    console.error(`AI ${context} Error:`, error?.message || error);
    if (this.isAuthError(error)) {
      return {
        message: 'No se pudo conectar con el servicio de IA: la clave API de Gemini es inválida o no tiene permisos. Verifica la configuración del servidor.',
        action: 'GENERAL_RESPONSE',
        error: true,
      };
    }
    if (this.isTransientError(error)) {
      return {
        message: 'El servicio de IA está temporalmente saturado o no disponible. Intenta de nuevo en unos segundos.',
        action: 'GENERAL_RESPONSE',
        error: true,
      };
    }
    return {
      message: 'No se pudo conectar con el servicio de IA. Verifica la clave API y vuelve a intentarlo.',
      action: 'GENERAL_RESPONSE',
      error: true,
    };
  }

  public static async processTextPrompt(
    prompt: string,
    currentDiagramContext?: any,
    model?: string
  ): Promise<AIServiceResponse> {
    try {
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
        // Existing relationships (already resolved to class names, not DB ids) must be in the
        // context too, otherwise the model can never correctly use connectorsToDelete /
        // connectorsModified - it would have no way to know what relationships already exist.
        const cleanConnectors = Array.isArray(currentDiagramContext.connectors) ? currentDiagramContext.connectors : [];
        contextStr = `Current Canvas Diagram Context: ${JSON.stringify({ nodes: cleanNodes, connectors: cleanConnectors })}`;
      }

      const fullPrompt = `${this.getSystemInstruction()}\n${contextStr}\nUser Request: ${prompt}`;

      const text = await this.generateWithRetry(fullPrompt, undefined, model, 'Text');
      return this.parseJsonResponse(text);
    } catch (error: any) {
      return this.buildFailureResponse(error, 'Text');
    }
  }

  public static async processPhotoPrompt(
    filePath: string,
    mimeType: string,
    model?: string
  ): Promise<AIServiceResponse> {
    try {
      const imageBytes = fs.readFileSync(filePath);
      const base64Data = imageBytes.toString('base64');
      const cleanMimeType = (mimeType && mimeType.startsWith('image/')) ? mimeType : 'image/png';
      const promptText = `${this.getSystemInstruction()}\nAnalyze this whiteboard/notebook image of a UML software class diagram. Extract ALL detected classes with exact class names, stereotypes (Entity, Interface, Abstract, Enum), visibility (- private, + public, # protected), attribute names, attribute data types, method names, return types, AND spatial positionX/positionY coordinates.\nMANDATORY: You MUST detect and extract ALL connecting lines, arrows, and diamonds between classes into 'connectorsGenerated' specifying 'sourceTempId', 'targetTempId', 'sourceClassName', 'targetClassName', and 'type' (Association | Aggregation | Composition | Inheritance | Implementation | Dependency).\nSPECIAL ATTENTION: Verify BOTH endpoints of every line for multiplicities (e.g. '+*', '+1') and ensure ANY class (like 'Cliente') touching solid black diamonds to children (like 'comprador', 'Vendedor') has 'type': 'Composition' with targetTempId set to that parent class.\nCRITICAL: Respond ONLY with a valid JSON object matching the requested schema. Do not output any markdown text or conversational greeting outside the JSON object.`;

      const text = await this.generateWithRetry(
        [promptText, { inlineData: { mimeType: cleanMimeType, data: base64Data } }],
        { responseMimeType: 'application/json', temperature: 0.1 },
        model,
        'Vision'
      );
      return this.parseJsonResponse(text);
    } catch (error: any) {
      return this.buildFailureResponse(error, 'Vision');
    }
  }

  public static async processVoicePrompt(
    filePath: string,
    mimeType: string,
    currentDiagramContext?: any,
    model?: string
  ): Promise<AIServiceResponse> {
    try {
      const audioBytes = fs.readFileSync(filePath);
      const base64Data = audioBytes.toString('base64');
      const contextStr = currentDiagramContext
        ? `Current Canvas Diagram Context: ${JSON.stringify(currentDiagramContext)}`
        : '';

      const promptText = `${this.getSystemInstruction()}\n${contextStr}\nListen to this voice message audio. Transcribe the user command and perform the requested UML class diagram operations.`;

      const text = await this.generateWithRetry(
        [
          promptText,
          {
            inlineData: {
              mimeType: mimeType || 'audio/webm',
              data: base64Data,
            },
          },
        ],
        undefined,
        model,
        'Voice'
      );
      return this.parseJsonResponse(text);
    } catch (error: any) {
      return this.buildFailureResponse(error, 'Voice');
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
}

