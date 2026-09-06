import fs from 'fs';

export interface AIServiceResponse {
  message: string;
  action?: 'CREATE_CLASSES' | 'MODIFY_CLASSES' | 'DELETE_CLASSES' | 'GENERAL_RESPONSE';
  classesGenerated?: any[];
  classesModified?: any[];
  classesToDelete?: string[];
  attributesToRemove?: { className: string; attributeName: string }[];
  methodsToRemove?: { className: string; methodName: string }[];
  connectorsGenerated?: any[];
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
You are ClassForge AI, an expert Software Architect AI Agent integrated into a real-time collaborative UML Class Diagram Editor.
Your job is to assist developers by generating, updating, or analyzing UML Class Diagrams.

When given a prompt (Text, Voice transcription, or Whiteboard photo image), respond ALWAYS with a valid JSON object matching this exact TypeScript structure:
{
  "message": "A friendly concise explanation of what you added, modified, or deleted on the diagram.",
  "action": "CREATE_CLASSES" | "MODIFY_CLASSES" | "DELETE_CLASSES" | "GENERAL_RESPONSE",
  "classesGenerated": [
    {
      "name": "ClassName",
      "stereotype": "Entity | Interface | Abstract | Enum",
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
      "sourceClassName": "ClassNameA",
      "targetClassName": "ClassNameB",
      "type": "Association | Aggregation | Composition | Inheritance | Implementation | Dependency",
      "sourceMultiplicity": "1",
      "targetMultiplicity": "0..*"
    }
  ]
}

CRITICAL RULES:
1. ALWAYS inspect Current Canvas Diagram Context first.
2. FOR ADDING ATTRIBUTES/METHODS TO EXISTING CLASSES: modify that existing class, DO NOT create a new class.
3. FOR DELETION COMMANDS (e.g. "elimina/borra la clase Rol", "en la clase Rol borra el atributo nombre_rol"):
   - If deleting an entire class: put class name in "classesToDelete".
   - If deleting an attribute from a class: put item in "attributesToRemove".
   - If deleting a method from a class: put item in "methodsToRemove".
4. SPEECH & CONVERSATIONAL FILTERS:
   - Ignore conversational fillers, stutters, hesitations (e.g. "eeh", "este", "o sea", "bueno", "mira", "sabes", "digo"). Extract ONLY the final core UML intention.
   - Preserve compound attribute names in snake_case: when user says "id rol", "id de rol" or "id_rol", output attribute name as "id_rol" (DO NOT truncate to "ID").
5. RELATIONSHIP DIRECTION RULES:
   - For Composition and Aggregation: "sourceClassName" MUST be the container/owner class that holds the diamond symbol. "targetClassName" MUST be the contained class. (e.g. Customer -> Orders, Customer -> Shopping Cart, Orders -> Order Details).
   - For Inheritance / Implementation: "sourceClassName" MUST be the child class and "targetClassName" MUST be the parent/superclass receiving the triangle arrow head. (e.g. Customer -> User).
6. Delete ONLY what is requested by the user. Do not remove unrequested items.
7. Plain JSON output only without markdown code block formatting like \`\`\`json.
`;
  }

  public static async processTextPrompt(
    prompt: string,
    currentDiagramContext?: any
  ): Promise<AIServiceResponse> {
    try {
      const ai = await this.getAIInstance();
      const contextStr = currentDiagramContext
        ? `Current Canvas Diagram Context: ${JSON.stringify(currentDiagramContext)}`
        : '';

      const fullPrompt = `${this.getSystemInstruction()}\n${contextStr}\nUser Request: ${prompt}`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
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
    mimeType: string
  ): Promise<AIServiceResponse> {
    try {
      const ai = await this.getAIInstance();
      const imageBytes = fs.readFileSync(filePath);
      const base64Data = imageBytes.toString('base64');

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            text: `${this.getSystemInstruction()}\nAnalyze this image of a UML software class diagram. Extract ALL detected classes with exact class names, stereotypes (Entity, Interface, Abstract, Enum), visibility (- private, + public, # protected), attribute names, attribute data types, method names, return types, and all relationships/connectors (Inheritance, Composition, Aggregation, Association) into the requested JSON structure.`,
          },
          {
            inlineData: {
              mimeType: mimeType || 'image/png',
              data: base64Data,
            },
          },
        ],
      });

      const text = response.text || '';
      return this.parseJsonResponse(text);
    } catch (error: any) {
      console.error('AI Photo Vision Error:', error);
      return {
        message: `Error al procesar la imagen con Gemini Vision: ${error.message}`,
        action: 'GENERAL_RESPONSE',
      };
    }
  }

  public static async processVoicePrompt(
    filePath: string,
    mimeType: string,
    currentDiagramContext?: any
  ): Promise<AIServiceResponse> {
    try {
      const ai = await this.getAIInstance();
      const audioBytes = fs.readFileSync(filePath);
      const base64Data = audioBytes.toString('base64');
      const contextStr = currentDiagramContext
        ? `Current Canvas Diagram Context: ${JSON.stringify(currentDiagramContext)}`
        : '';

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            text: `${this.getSystemInstruction()}\n${contextStr}\nListen to this voice message audio. Transcribe the user command and perform the requested UML class diagram operations.`,
          },
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
    try {
      const cleaned = rawText
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();
      return JSON.parse(cleaned) as AIServiceResponse;
    } catch {
      return {
        message: rawText,
        action: 'GENERAL_RESPONSE',
      };
    }
  }
}
