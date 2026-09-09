import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

async function testFast() {
  const apiKey = process.env.GEMINI_API_KEY || '';
  const ai = new GoogleGenAI({ apiKey });

  console.time('Gemini Vision Request');
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: [
        'Analyze this class diagram concept. Return JSON with classes array containing Animal, Bird, Cat.',
      ],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });
    console.timeEnd('Gemini Vision Request');
    console.log('Response JSON:', response.text);
  } catch (err: any) {
    console.error('Error:', err.message || err);
  }
}

testFast();
