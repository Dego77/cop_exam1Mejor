import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

async function listModels() {
  const apiKey = process.env.GEMINI_API_KEY || '';
  const ai = new GoogleGenAI({ apiKey });

  const testList = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-2.0-flash-exp',
    'gemini-3.6-flash',
    'gemini-flash-latest'
  ];

  for (const m of testList) {
    try {
      const res = await ai.models.generateContent({
        model: m,
        contents: ['Say hello in 3 words'],
      });
      console.log(`MODEL ${m}: SUCCESS ->`, res.text?.trim());
      break;
    } catch (err: any) {
      console.log(`MODEL ${m}: FAILED ->`, err.message || err);
    }
  }
}

listModels();
