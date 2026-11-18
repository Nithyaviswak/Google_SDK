import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is not set in .env');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const pager = await ai.models.list({ config: { pageSize: 100 } });

const rows = [];
for await (const model of pager) {
  rows.push({
    name: model.name.replace(/^models\//, ''),
    displayName: model.displayName,
    supportsGenerateContent: (model.supportedActions ?? []).includes('generateContent'),
  });
}

console.table(rows);
console.log(`\n${rows.length} models available to this key.`);
