// IA Local: modelos que corren en esta máquina con Ollama (sin internet ni API key).
// Recibe el mismo prompt que Gemini (reglas, contexto del diagrama e historial), así responde con el mismo JSON.

export const LOCAL_MODEL_PREFIX = 'local:';

export function isLocalModel(model?: string): boolean {
  return !!model && model.startsWith(LOCAL_MODEL_PREFIX);
}

// Error con un mensaje listo para mostrar en el chat
export class LocalAIError extends Error {
  readonly isLocalAI = true;
}

export interface LocalAIStatus {
  online: boolean;
  models: string[];
  defaultModel: string;
  visionModel: string;
}

const REQUEST_TIMEOUT_MS = 180_000;
// El prompt con el diagrama y el historial es largo: con el contexto por defecto de Ollama (2048-4096) se cortaría
const CONTEXT_TOKENS = 16384;

export class LocalLLMService {
  static get baseUrl(): string {
    return (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '');
  }

  static get defaultModel(): string {
    return process.env.OLLAMA_MODEL || 'qwen2.5:7b';
  }

  static get visionModel(): string {
    return process.env.OLLAMA_VISION_MODEL || 'qwen2.5vl:7b';
  }

  // 'local:qwen2.5:7b' → 'qwen2.5:7b'; 'local:' solo → el modelo por defecto
  static modelName(model?: string): string {
    const name = isLocalModel(model) ? model!.slice(LOCAL_MODEL_PREFIX.length).trim() : '';
    return name || this.defaultModel;
  }

  static async status(): Promise<LocalAIStatus> {
    const base = { defaultModel: this.defaultModel, visionModel: this.visionModel };
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return { online: false, models: [], ...base };
      const data: any = await res.json();
      const models = (data?.models || []).map((m: any) => String(m?.name || m?.model || '')).filter(Boolean);
      return { online: true, models, ...base };
    } catch {
      return { online: false, models: [], ...base };
    }
  }

  /**
   * Mismos argumentos que generateContent de Gemini: `contents` es un texto o un arreglo de textos
   * y partes `{ inlineData: { mimeType, data } }`. Las imágenes van en `images` (modelo con visión).
   */
  static async generate(contents: any, config: Record<string, any> | undefined, model: string): Promise<string> {
    const parts = Array.isArray(contents) ? contents : [contents];
    const texts: string[] = [];
    const images: string[] = [];
    for (const part of parts) {
      if (typeof part === 'string') texts.push(part);
      else if (part?.inlineData?.data) {
        if (String(part.inlineData.mimeType || '').startsWith('image/')) images.push(part.inlineData.data);
        else throw new LocalAIError('La IA local no puede escuchar audio. Usa el texto reconocido o escribe el pedido.');
      } else if (typeof part?.text === 'string') texts.push(part.text);
    }

    const wantsJson = String(config?.responseMimeType || '').includes('json');
    const body = {
      model,
      stream: false,
      messages: [{ role: 'user', content: texts.join('\n'), ...(images.length ? { images } : {}) }],
      ...(wantsJson ? { format: 'json' } : {}),
      options: {
        num_ctx: CONTEXT_TOKENS,
        ...(typeof config?.temperature === 'number' ? { temperature: config.temperature } : {}),
      },
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err: any) {
      if (err?.name === 'TimeoutError') {
        throw new LocalAIError(`La IA local (${model}) tardó demasiado en responder. Prueba con un modelo más pequeño.`);
      }
      throw new LocalAIError('La IA local no está disponible: inicia Ollama en el servidor (ollama serve).');
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      if (res.status === 404 || /not found/i.test(detail)) {
        throw new LocalAIError(`El modelo local "${model}" no está instalado. Ejecuta en el servidor: ollama pull ${model}`);
      }
      throw new LocalAIError(`La IA local respondió con error (${res.status}). ${detail.slice(0, 200)}`.trim());
    }

    const data: any = await res.json();
    return String(data?.message?.content || '');
  }
}
