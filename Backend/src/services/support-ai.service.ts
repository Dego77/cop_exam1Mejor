export class SupportAIAgentService {
  private static async getAIInstance(): Promise<any> {
    const apiKey = process.env.GEMINI_API_KEY || '';
    const { GoogleGenAI } = await import('@google/genai');
    return new GoogleGenAI({ apiKey });
  }

  // Support Agent AI Prompt Processor
  public static async processSupportPrompt(
    prompt: string,
    isInteractiveMode: boolean = false,
    model: string = 'gemini-3.6-flash'
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

      const targetModel = (model && !model.includes('2.5')) ? model : 'gemini-3.6-flash';

      const response = await ai.models.generateContent({
        model: targetModel,
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
      console.error('Support AI Error:', err?.message || err);
      return {
        message: `Hola! Entiendo tu consulta sobre "${prompt}". Para cualquier duda en ClassForge: 1. Puedes crear clases desde la barra izquierda. 2. Conectarlas con las líneas UML. 3. Exportar tu diagrama a SQL desde el botón superior. ¿Deseas ayuda con algún tema específico?`,
        suggestedAction: "NONE",
        quickReplies: ["¿Cómo exportar a SQL?", "¿Cómo conectar dos clases?", "¿Cómo invitar a mi equipo?"]
      };
    }
  }
}
