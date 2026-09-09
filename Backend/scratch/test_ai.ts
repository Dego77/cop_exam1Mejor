import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

async function test() {
  const apiKey = process.env.GEMINI_API_KEY || '';
  const ai = new GoogleGenAI({ apiKey });

  console.log('Testing gemini-3.6-flash with vision prompt...');
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: [
        'Analyze this image and describe what you see.',
      ],
    });
    console.log('Success gemini-3.6-flash:', response.text);
  } catch (err: any) {
    console.error('Error gemini-3.6-flash:', err.message || err);
  }
}

test();
