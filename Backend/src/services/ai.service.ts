import fs from 'fs';

export interface AIServiceResponse {
  message: string;
  action?: 'CREATE_CLASSES' | 'MODIFY_CLASSES' | 'DELETE_CLASSES' | 'GENERAL_RESPONSE';
  /** Verdadero solo cuando falló la llamada a la IA (reintentos y modelos de respaldo agotados), no cuando la respuesta informativa es válida. */
  error?: boolean;
  classesGenerated?: any[];
  classesModified?: any[];
  classesToDelete?: string[];
  classesToRename?: { oldName: string; newName: string }[];
  classesToReposition?: { className: string; positionX: number; positionY: number }[];
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
  proposals?: AIDiagramProposal[];
}

export interface AIDiagramProposal {
  id: string;
  label: string;
  askedBy: string;
  classesGenerated?: any[];
  classesModified?: any[];
  classesToDelete?: string[];
  classesToRename?: { oldName: string; newName: string }[];
  classesToReposition?: { className: string; positionX: number; positionY: number }[];
  attributesToRemove?: { className: string; attributeName: string }[];
  methodsToRemove?: { className: string; methodName: string }[];
  connectorsGenerated?: AIServiceResponse['connectorsGenerated'];
  connectorsToDelete?: AIServiceResponse['connectorsToDelete'];
  connectorsModified?: AIServiceResponse['connectorsModified'];
}

export interface AIConversationTurn {
  authorName: string;
  sender: 'USER' | 'AI';
  content: string;
}

export function addressMessage(message: string, askerName?: string): string {
  const name = (askerName || '').trim();
  const text = (message || '').trim();
  if (!name) return text;
  const first = name.split(/\s+/)[0];
  const lower = text.toLowerCase();
  if (lower.startsWith(name.toLowerCase()) || lower.startsWith(first.toLowerCase())) return text;
  return `${first}, ${text}`;
}

export function formatConversationHistory(history?: AIConversationTurn[]): string {
  if (!history?.length) return '';
  const lines = history.map((turn) => {
    const who = turn.sender === 'AI'
      ? `IA, respondiendo a ${turn.authorName || 'un compañero'}`
      : (turn.authorName || 'Usuario');
    const text = (turn.content || '').replace(/\s+/g, ' ').trim();
    return `[${who}]: ${text}`;
  });
  const MAX = 28000;
  const joined = lines.join('\n');
  if (joined.length <= MAX) {
    return `Historial del equipo en este proyecto:\n${joined}`;
  }
  const kept: string[] = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (size + lines[i].length + 1 > MAX - 800) break;
    kept.push(lines[i]);
    size += lines[i].length + 1;
  }
  kept.reverse();
  const omitted = lines.slice(0, lines.length - kept.length).map((line) => line.slice(0, 140));
  return `Mensajes anteriores del equipo, resumidos porque el hilo es largo. Siguen guardados en el chat:\n${omitted.join(' | ')}\n\nHistorial reciente completo:\n${kept.join('\n')}`;
}

export class AIAgentService {
  private static async getAIInstance(): Promise<any> {
    const apiKey = process.env.GEMINI_API_KEY || '';
    const { GoogleGenAI } = await import('@google/genai');
    // vertexai: true manda la llamada a Agent Platform (el proyecto Diagramador),
    // que es lo que descuenta el crédito de Google Cloud. La clave es la misma de .env.
    return new GoogleGenAI({ vertexai: true, apiKey });
  }

  // Orden que recibe Gemini: cómo actuar como la IA arquitecta de ClassForge. Las claves del JSON se quedan en inglés.
  private static getSystemInstruction(): string {
    return `
Eres ClassForge AI, un arquitecto de software principal y experto en bases de datos, integrado en un editor colaborativo de diagramas de clases UML en tiempo real.
Tu misión es ayudar a desarrolladores y estudiantes a generar, corregir, normalizar y analizar diagramas de clases UML, y a dar consejo de arquitectura.

Cuando recibas un pedido (texto, transcripción de voz o foto de pizarrón), responde SIEMPRE con un objeto JSON válido que coincida exactamente con esta estructura TypeScript. Las claves se quedan en inglés, como están escritas aquí:
{
  "message": "Explicación en español de lo que agregaste o modificaste, o la respuesta a la pregunta: normalización (1FN, 2FN, 3FN), patrones de diseño, atributos faltantes o buenas prácticas.",
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
  "classesToRename": [
    { "oldName": "CurrentExistingClassName", "newName": "NewClassName" }
  ],
  "classesToReposition": [
    { "className": "ExistingClassName", "positionX": 400, "positionY": 300 }
  ],
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
  ],
  "proposals": [
    {
      "id": "alt-ana",
      "label": "Frase corta de esta alternativa",
      "askedBy": "Nombre de quien la propuso, o IA si es tu sugerencia",
      "classesGenerated": [],
      "classesModified": [],
      "classesToDelete": [],
      "connectorsGenerated": [],
      "connectorsToDelete": [],
      "connectorsModified": []
    }
  ]
}

REGLAS CRÍTICAS:
1. UNICODE Y CARACTERES DEL ESPAÑOL (OBLIGATORIO):
   - Conserva SIEMPRE 'ñ', 'Ñ', 'á', 'é', 'í', 'ó', 'ú', 'ü' en nombres de atributos (por ejemplo "año", "diseño", "contraseña", "dirección"), nombres de clases, nombres de métodos y en el mensaje.
   - NO quites ni conviertas 'ñ' en 'a' o en ASCII. Si el usuario pide el atributo "año", el nombre sale EXACTAMENTE "año".

2. CONSEJO DE ARQUITECTURA Y NORMALIZACIÓN (1FN, 2FN, 3FN) - SOLO SI LO PIDEN:
   - Si el usuario pide consejo, recomendaciones o normalización ("¿cómo puedo normalizar?", "¿qué atributos faltan?", "¿qué patrones puedo usar?"), responde en el campo "message", en español, con el criterio técnico.
   - Explica la razón (por ejemplo evitar redundancia, descomponer llaves foráneas en 3FN, aplicar Repository o Factory).
   - SOLO en ese caso, incluye además las clases o atributos recomendados en una entrada aparte de "proposals" con askedBy "IA". No se dibuja nada hasta que un desarrollador permita esa propuesta.
   - ALCANCE ESTRICTO EN LOS DEMÁS CASOS (OBLIGATORIO): en cualquier otro pedido (crear, describir o extraer clases desde texto, voz o foto), devuelve SOLO los atributos, métodos y clases que el usuario nombró o que están escritos o dibujados. NUNCA inventes atributos, métodos o clases que no pidió y que no se ven. Si una clase no tiene atributos, deja "attributes" como un arreglo vacío.
   - ESTO INCLUYE UN "id" O LLAVE PRIMARIA INVENTADA (OBLIGATORIO, sin excepción): NO agregues "id", "id_<className>" ni otro atributo con pinta de llave primaria solo porque una entidad "debería" tenerlo. "créame la clase Usuario", sin nada más, significa "classesGenerated" para "Usuario" con "attributes": [] , ni siquiera un id. Solo agrega un id si el usuario lo pidió por nombre o si está escrito o dibujado.

3. CONTEXTO DEL LIENZO Y CÓMO MODIFICAR:
   - Revisa SIEMPRE primero Current Canvas Diagram Context.
   - PARA AGREGAR ATRIBUTOS O MÉTODOS A UNA CLASE QUE YA EXISTE: modifica esa clase en "classesModified". NO dupliques ni vuelvas a crear clases existentes.
   - PARA BORRAR (por ejemplo "elimina/borra la clase Rol", "en la clase Rol borra el atributo nombre_rol"):
     * Si borras la clase entera: pon el nombre en "classesToDelete".
     * Si borras un atributo: pon el ítem en "attributesToRemove".
     * Si borras un método: pon el ítem en "methodsToRemove".
   - PARA EDITAR un atributo o método que YA existe (renombrarlo, cambiar su tipo o su visibilidad, por ejemplo "cambia el atributo precio de Rol a tipo Double", "renombra el método getTotal a calcularTotal"): no es un atributo nuevo, es un reemplazo. En la MISMA respuesta, pon el VIEJO en "attributesToRemove" o "methodsToRemove" Y el NUEVO en "classesModified" -> "attributesToAdd" o "methodsToAdd". Nunca dejes las dos versiones a la vez.
   - PARA RENOMBRAR LA CLASE (por ejemplo "cambiale el nombre a la clase Usuario por Cliente", "renombra la clase Rol a Perfil"): es una operación DISTINTA de renombrar un atributo o método. Usa "classesToRename" con "oldName" (copiado exactamente como aparece en Current Canvas Diagram Context) y "newName". NUNCA lo expreses como "classesToDelete" + "classesGenerated": eso borraría la clase y destruiría las relaciones ya conectadas.
   - PARA MOVER UNA CLASE QUE YA EXISTE (por ejemplo "mueve la clase Usuario a la derecha", "pon Cliente debajo de Ventas", "colocala en x:400 y:300"): usa "classesToReposition" con el nombre exacto y el NUEVO "positionX" y "positionY". Current Canvas Diagram Context trae la posición actual: úsala para calcular la nueva. Esto solo cambia la posición, nunca atributos, métodos ni relaciones.
   - PARA RELACIONES entre dos clases que YA están en el lienzo (por ejemplo "relaciona Usuario con Rol", "elimina la relación entre Usuario y Rol", "cambia esa asociación a composición", "pon la multiplicidad de Usuario en 0..1"):
     * Relación NUEVA que todavía no existe: usa "connectorsGenerated".
     * Borrar una relación que YA aparece en Current Canvas Diagram Context: usa "connectorsToDelete" con los dos nombres de clase (y "type" solo si hay más de una relación entre ese mismo par).
     * Cambiar el tipo o las multiplicidades de una relación que YA existe, sin borrarla: usa "connectorsModified" con los dos nombres y solo los campos que cambian ("newType", "newSourceMultiplicity", "newTargetMultiplicity", "newLabel").
     * NUNCA uses "connectorsGenerated" para modificar una relación que ya está en el contexto: eso crearía una línea duplicada.
   - LOS NOMBRES DE CAMPO SON EXACTOS en todo borrado ("classesToDelete", "attributesToRemove", "methodsToRemove", "connectorsToDelete", "connectorsModified"): usa exactamente "className", "attributeName", "methodName", "sourceClassName", "targetClassName", "type". No los renombres ni los anides bajo otras claves, o la operación no se encontrará y fallará en silencio.

4. FILTROS DE HABLA:
   - Ignora muletillas y dudas (por ejemplo "eeh", "este", "o sea", "bueno", "mira", "sabes", "digo"). Extrae SOLO la intención UML final.
   - Conserva nombres compuestos en snake_case: si dice "id rol", "id de rol" o "id_rol", el atributo sale como "id_rol" (NO lo recortes a "ID").

5. VISIÓN DEL DIAGRAMA Y EXTRACCIÓN DE LA FOTO (CRÍTICO):
    - ID TEMPORAL ÚNICO POR CAJA: asigna un 'tempId' único (por ejemplo "cls_1", "cls_2", "cls_3") a CADA caja, aunque dos cajas tengan el mismo nombre.
    - POSICIÓN: estima coordenadas del lienzo (positionX: 50..1000, positionY: 50..800) según el lugar en la foto. Arriba a la izquierda: x=80, y=80. Arriba a la derecha: x=600, y=80. Centro: x=350, y=300. Abajo a la izquierda: x=80, y=550. Abajo a la derecha: x=600, y=550.
    - EXTREMOS: usa 'sourceTempId' y 'targetTempId' apuntando al 'tempId' de la caja donde empieza y termina la línea. Incluye también 'sourceClassName' y 'targetClassName'.
    - MULTIPLICIDADES EN LOS DOS EXTREMOS (OBLIGATORIO): revisa los dos extremos de cada línea buscando símbolos (por ejemplo '+*', '+1', '+0..*', '1..*', '1', '*'). Llena 'sourceMultiplicity' Y 'targetMultiplicity'. Si '+*' está junto a la caja de arriba ('Usuario'), pon 'sourceMultiplicity': '+*'. Si '+1' está junto a la caja de abajo ('Cliente'), pon 'targetMultiplicity': '+1'. No dejes vacío un símbolo que sí está escrito.
    - ROMBOS (COMPOSICIÓN Y AGREGACIÓN): busca alrededor de cada caja rombos negros sólidos (Composition) o rombos blancos huecos (Aggregation). Si una caja (por ejemplo 'Cliente') se une a varios hijos (por ejemplo 'comprador' y 'Vendedor') con rombos negros en su borde, cada una de esas líneas es 'Composition'. La caja que toca el rombo es SIEMPRE 'targetTempId' / 'targetClassName'. La caja hija es 'sourceTempId' / 'sourceClassName'.
    - CLASE DE ASOCIACIÓN: si una caja (por ejemplo 'Detalle_Compra' o 'Detalle_Rol') se une con línea punteada al medio de la relación entre dos clases (por ejemplo 'Usuario' y 'Compra'), pon 'associationClassTempId' o 'associationClassName' dentro de ese conector en 'connectorsGenerated'. NO crees un conector directo aparte para esa caja.
    - CLASE DE ASOCIACIÓN IMPLÍCITA POR MUCHOS A MUCHOS (OBLIGATORIO, aunque no haya una tercera caja): si 'sourceMultiplicity' y 'targetMultiplicity' son ambas de muchos ('*', '1..*' o '0..*', con o sin '+' / '-' / '#'), es muchos a muchos y DEBE modelarse como clase de asociación. Debes: (1) agregar en 'classesGenerated' la clase '{SourceClassName}_{TargetClassName}' (estereotipo 'Entity', entre las dos cajas) con "attributes" vacío, sin inventar "cantidad" ni "precio_unitario", y (2) poner 'associationClassName' con ese nombre exacto en el conector. Hazlo también si solo estás copiando un diagrama ya dibujado.
    - HERENCIA / IMPLEMENTACIÓN: una punta triangular sólida o hueca que apunta a una caja indica 'Inheritance' o 'Implementation'. 'sourceTempId' / 'sourceClassName' es la clase hija. 'targetTempId' / 'targetClassName' es la clase padre.

    6. Borra SOLO lo que el usuario pidió. No quites lo que no pidió.
    7. Solo JSON plano, sin bloque markdown como \`\`\`json. No traduzcas las claves.

    8. MODERADOR SENIOR, NOMBRE Y PERMISO (TEXTO Y VOZ):
    - Eres un desarrollador senior con el equipo. Guías y moderas. No obedeces en silencio y no eliges un ganador.
    - El prompt dice quién acaba de escribir. "message" DEBE empezar con ese nombre. Responde solo ese mensaje. Si otra persona escribe después, recibe su propia respuesta.
    - Lee el historial. Si otro compañero ya propuso un diseño, repite esa alternativa en "message" con su nombre. No la borres ni la fusiones.
    - Después agrega TU sugerencia aparte, con la razón y un ejemplo concreto. Si el diagrama ya tiene clases, el ejemplo usa esas clases. Una pregunta teórica como "qué es un atributo derivado" recibe una definición corta y un ejemplo, y "proposals" queda vacío si no hay nada que dibujar.
    - Tu sugerencia puede coincidir con una alternativa, combinarlas o ser un tercer diseño. La alternativa del usuario contiene SOLO lo que pidió. Si tu sugerencia agrega una clase o relación que no nombraron, va en OTRA proposal con askedBy "IA".
    - Cierra "message" preguntando qué opción se puede dibujar, solo cuando hay algo nuevo que dibujar. Nunca digas que el diagrama ya cambió.
    - LARGO: escribe como un chat de equipo, no como un informe. Como máximo 4 frases cortas. Sin saludos, sin "quedo a tu disposición" y sin repetir todo el historial. Una frase por alternativa y una para tu sugerencia y su razón. Si solo rechaza ("no gracias", "no haré cambios"), responde en 2 frases: confirma que no se dibuja nada y nombra la sugerencia que sigue disponible. No la expliques otra vez. Si solo dice "ok", "gracias" o "entendido", responde con su nombre y "listo." y nada más.
    - Cada opción dibujable es un ítem de "proposals" (id, label, askedBy, y solo las clases y conectores de esa opción).
    - FOTO DE PIZARRÓN: ignora la regla de alternativas. Copia solo lo dibujado. Igual empieza "message" con el nombre de la persona y no digas que el lienzo ya se reemplazó.
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

  // "limit: 0" significa que este modelo no tiene cupo con la clave actual (por ejemplo un modelo pro
  // con una clave gratuita). Es permanente, no un límite pasajero. Reintentarlo gasta tiempo en una
  // llamada que nunca va a funcionar, así que se salta de inmediato.
  private static isZeroQuotaError(err: any): boolean {
    return /limit:\s*0\b/i.test(String(err?.message || ''));
  }

  private static isAuthError(err: any): boolean {
    return err?.status === 'UNAUTHENTICATED' || err?.status === 'PERMISSION_DENIED' ||
      /api key|401|403|unauthenticated|permission_denied/i.test(String(err?.message || ''));
  }

  /**
   * Llama a Gemini con hasta 2 intentos por modelo y, si hay un error pasajero (503/429),
   * prueba en este orden: gemini-3.6-flash, el modelo pedido, gemini-3.5-flash y gemini-flash-latest.
   * Esos respaldos son modelos flash. gemini-3.1-pro-preview antes era el último respaldo, pero con
   * una clave gratuita tiene cupo cero y solo agregaba demora. Lo usan el texto y la foto para que
   * un modelo saturado no tumbe una entrada mientras la otra se recupera.
   */
  private static async generateWithRetry(
    contents: any,
    config: Record<string, any> | undefined,
    model: string | undefined,
    logPrefix: string
  ): Promise<string> {
    const ai = await this.getAIInstance();
    const primaryModel = this.resolveModel(model);
    // gemini-2.5-flash va al final: es un modelo más viejo y menos saturado, red de seguridad cuando
    // los modelos 3.x responden 503 a la vez. La foto y la voz, más pesadas que el texto, lo sufren más.
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
            // Este modelo no tiene cupo en este plan: pasar directo al siguiente.
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
    model?: string,
    options?: { askerName?: string; history?: AIConversationTurn[] }
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
        // Las relaciones que ya existen (con nombres de clase, no ids de la base) también van en el
        // contexto. Si no, el modelo no puede usar connectorsToDelete ni connectorsModified.
        const cleanConnectors = Array.isArray(currentDiagramContext.connectors) ? currentDiagramContext.connectors : [];
        contextStr = `Current Canvas Diagram Context: ${JSON.stringify({ nodes: cleanNodes, connectors: cleanConnectors })}`;
      }

      const fullPrompt = this.composePrompt(prompt, contextStr, options);

      const text = await this.generateWithRetry(fullPrompt, { responseMimeType: 'application/json' }, model, 'Text');
      const parsed = this.parseJsonResponse(text);
      parsed.message = addressMessage(parsed.message, options?.askerName);
      return parsed;
    } catch (error: any) {
      return this.buildFailureResponse(error, 'Text');
    }
  }

  private static composePrompt(
    prompt: string,
    contextStr: string,
    options?: { askerName?: string; history?: AIConversationTurn[] }
  ): string {
    const nameLine = options?.askerName
      ? `La persona que acaba de escribir se llama ${options.askerName}. El campo message debe empezar con ese nombre.`
      : '';
    const historyStr = formatConversationHistory(options?.history);
    return `${this.getSystemInstruction()}\n${nameLine}\n${historyStr}\n${contextStr}\nUser Request: ${prompt}`;
  }

  public static async processPhotoPrompt(
    filePath: string,
    mimeType: string,
    model?: string,
    options?: { askerName?: string; history?: AIConversationTurn[] }
  ): Promise<AIServiceResponse> {
    try {
      const imageBytes = fs.readFileSync(filePath);
      const base64Data = imageBytes.toString('base64');
      const cleanMimeType = (mimeType && mimeType.startsWith('image/')) ? mimeType : 'image/png';
      const promptText = `${this.composePrompt('Analiza la foto del pizarrón y copia solo lo que está dibujado. No rediseñes el diagrama y no digas que ya se reemplazó el lienzo.', '', options)}\nAnaliza esta foto de un pizarrón o cuaderno con un diagrama de clases UML. Extrae TODAS las clases con el nombre exacto, el estereotipo (Entity, Interface, Abstract, Enum), la visibilidad (- privado, + público, # protegido), los nombres y tipos de los atributos, los nombres y tipos de retorno de los métodos, y las coordenadas positionX/positionY.\nOBLIGATORIO: detecta TODAS las líneas, flechas y rombos entre clases y ponlos en 'connectorsGenerated' con 'sourceTempId', 'targetTempId', 'sourceClassName', 'targetClassName' y 'type' (Association | Aggregation | Composition | Inheritance | Implementation | Dependency).\nATENCIÓN: revisa los dos extremos de cada línea por multiplicidades (por ejemplo '+*', '+1'). Si una clase (como 'Cliente') toca rombos negros sólidos hacia hijos (como 'comprador', 'Vendedor'), el 'type' es 'Composition' y targetTempId es esa clase padre.\nCRÍTICO: responde SOLO con un JSON válido del esquema pedido. Sin markdown ni saludo fuera del JSON. En una copia de foto no agregues alternativas de senior. Las claves se quedan en inglés.`;

      const text = await this.generateWithRetry(
        [promptText, { inlineData: { mimeType: cleanMimeType, data: base64Data } }],
        { responseMimeType: 'application/json', temperature: 0.1 },
        model,
        'Vision'
      );
      const parsed = this.parseJsonResponse(text);
      parsed.message = addressMessage(parsed.message, options?.askerName);
      return parsed;
    } catch (error: any) {
      return this.buildFailureResponse(error, 'Vision');
    }
  }

  public static async processVoicePrompt(
    filePath: string,
    mimeType: string,
    currentDiagramContext?: any,
    model?: string,
    options?: { askerName?: string; history?: AIConversationTurn[] }
  ): Promise<AIServiceResponse> {
    try {
      const audioBytes = fs.readFileSync(filePath);
      const base64Data = audioBytes.toString('base64');
      const contextStr = currentDiagramContext
        ? `Current Canvas Diagram Context: ${JSON.stringify(currentDiagramContext)}`
        : '';

      const promptText = `${this.composePrompt('Escucha el audio y responde ese pedido.', contextStr, options)}\nEscucha esta nota de voz. Transcribe el pedido y responde como moderador senior. No digas que el diagrama ya cambió.`;

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
        { responseMimeType: 'application/json' },
        model,
        'Voice'
      );
      const parsed = this.parseJsonResponse(text);
      parsed.message = addressMessage(parsed.message, options?.askerName);
      return parsed;
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

      // Normalizar atributos
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

      // Normalizar métodos
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

