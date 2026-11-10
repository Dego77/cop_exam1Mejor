import { TextToSpeechClient } from '@google-cloud/text-to-speech';

const client = new TextToSpeechClient();
const audioByMessage = new Map<string, Promise<Buffer>>();
const MAX_CACHED_AUDIO = 80;
export type ChirpVoice = 'Puck' | 'Leda';

export function synthesizeAIMessage(messageId: string, text: string, voice: ChirpVoice): Promise<Buffer> {
  const cacheKey = `${messageId}:${voice}`;
  const cached = audioByMessage.get(cacheKey);
  if (cached) return cached;

  const cleanText = text.replace(/[*_#`~]/g, '').trim();
  if (!cleanText) return Promise.reject(new Error('El mensaje no contiene texto para sintetizar.'));
  if (Buffer.byteLength(cleanText, 'utf8') > 4800) {
    return Promise.reject(new Error('El mensaje supera el límite de síntesis en una sola solicitud.'));
  }

  const voiceName = `es-US-Chirp3-HD-${voice}`;
  const synthesis = client.synthesizeSpeech({
    input: { text: cleanText },
    voice: { languageCode: 'es-US', name: voiceName },
    audioConfig: { audioEncoding: 'MP3' },
  }).then(([response]) => {
    if (!response.audioContent) throw new Error('Google Cloud no devolvió audio.');
    return Buffer.from(response.audioContent as Uint8Array);
  }).catch((error) => {
    audioByMessage.delete(cacheKey);
    throw error;
  });

  audioByMessage.set(cacheKey, synthesis);
  if (audioByMessage.size > MAX_CACHED_AUDIO) {
    const oldestKey = audioByMessage.keys().next().value;
    if (oldestKey) audioByMessage.delete(oldestKey);
  }
  return synthesis;
}
