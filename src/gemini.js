import { GoogleGenAI } from '@google/genai';
import {
  createToolState,
  runTool,
  toolDeclarations,
  toolNames,
} from './tools.js';

const CONFIGURED_MODEL = process.env.GEMINI_MODEL?.trim();
const MODEL_CANDIDATES = [
  ...new Set(
    [
      CONFIGURED_MODEL,
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash',
    ].filter(Boolean)
  ),
];

// The newest model can be missing from a key or retired after a release. The
// app starts with the preferred model and quietly falls back down the list.
let activeModel = MODEL_CANDIDATES[0];

// Models that returned 404/503 are skipped for a minute instead of costing
// every request another failed round-trip.
const MODEL_COOLDOWN_MS = 60_000;
const modelCooldown = new Map();

function modelsInOrder() {
  const now = Date.now();
  const ordered = [
    activeModel,
    ...MODEL_CANDIDATES.filter((model) => model !== activeModel),
  ];
  const ready = ordered.filter((model) => (modelCooldown.get(model) ?? 0) <= now);
  return ready.length ? ready : ordered;
}

const API_KEY = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
const BASE_URL = process.env.GEMINI_BASE_URL?.trim();

// Without a key the server still boots so the UI can show a setup message.
const ai = API_KEY
  ? new GoogleGenAI({
      apiKey: API_KEY,
      httpOptions: {
        ...(BASE_URL ? { baseUrl: BASE_URL } : {}),
        // Function calling is only enabled on v1beta for the Gemini API.
        apiVersion: 'v1beta',
        // Fail fast so a busy model can fall through to the next candidate.
        // Without this the SDK retries a 503 for ~35 seconds.
        retryOptions: { attempts: 1 },
      },
    })
  : null;

export const isConfigured = Boolean(ai);
export const getModelName = () => activeModel;

const MAX_TOOL_TURNS = 6;

const SYSTEM_INSTRUCTION = [
  'You are Toolbox, a compact demo assistant running inside a small web app.',
  'You can call local tools. Use them whenever they would give a more accurate',
  'or more concrete answer: check the clock for dates and times, use the',
  'calculator for arithmetic, look up weather for forecasts, search the',
  'knowledge base for questions about Gemini or this app, and store notes when',
  'the user asks you to remember something.',
  'Never invent a tool result. If a tool returns an error, explain it plainly.',
  'Weather data from get_weather is simulated; say so when you report it.',
  'Answer in short Markdown: a sentence or two, then bullets only when useful.',
].join(' ');

function friendlyError(error) {
  const message = String(error?.message ?? error ?? 'Unknown error');
  const status = Number(error?.status ?? error?.code ?? 0);

  if (/API key|API_KEY_INVALID|PERMISSION_DENIED|unauthenticated/i.test(message) || status === 401 || status === 403) {
    return 'Gemini rejected the API key. Check GEMINI_API_KEY in your .env file and restart the server.';
  }
  if (status === 503 || /UNAVAILABLE|overloaded|high demand/i.test(message)) {
    return 'Gemini is temporarily busy (503) on every candidate model. Try again in a few seconds.';
  }
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(message)) {
    return 'Gemini is rate limiting this key (429). Wait a moment and try again, or use a different key.';
  }
  if (status === 404 || /not found|NOT_FOUND/i.test(message)) {
    return `None of the candidate models are available for this key (tried ${MODEL_CANDIDATES.join(', ')}). Set GEMINI_MODEL in .env to a model your key can use.`;
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network|ETIMEDOUT/i.test(message)) {
    return 'Could not reach the Gemini API. Check your network connection and try again.';
  }
  return `Gemini request failed: ${message.slice(0, 400)}`;
}

function isModelUnavailable(error) {
  const status = Number(error?.status ?? error?.code ?? 0);
  const message = String(error?.message ?? '');
  return (
    status === 404 ||
    status === 503 ||
    /NOT_FOUND|not found|not supported|does not exist|UNAVAILABLE|overloaded|high demand/i.test(
      message
    )
  );
}

function generateOnce(model, contents) {
  return ai.models.generateContent({
    model,
    contents,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      tools: [{ functionDeclarations: toolDeclarations }],
      temperature: 0.7,
      automaticFunctionCalling: { disable: true },
    },
  });
}

/**
 * Tries the active model first, then any remaining candidates if the model is
 * missing for this API key. The working model is remembered for later turns.
 */
async function generateWithFallback(contents) {
  let lastError;

  for (const model of modelsInOrder()) {
    try {
      const response = await generateOnce(model, contents);
      modelCooldown.delete(model);
      if (model !== activeModel) {
        console.log(`[gemini] "${activeModel}" unavailable, now using "${model}"`);
        activeModel = model;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (!isModelUnavailable(error)) throw error;
      modelCooldown.set(model, Date.now() + MODEL_COOLDOWN_MS);
      console.warn(`[gemini] model "${model}" is unavailable, trying next`);
    }
  }

  throw lastError;
}

export class ChatSession {
  constructor(id) {
    this.id = id;
    this.contents = [];
    this.toolState = createToolState();
    this.createdAt = new Date().toISOString();
  }

  reset() {
    this.contents = [];
    this.toolState = createToolState();
  }

  /**
   * Runs the full tool-calling loop:
   *   prompt -> model -> (tool calls -> tool results -> model)* -> final text
   * Each executed tool is collected so the browser can render it.
   */
  async send(text) {
    if (!ai) {
      const error = new Error('GEMINI_API_KEY is not set.');
      error.code = 'NOT_CONFIGURED';
      throw error;
    }

    this.contents.push({ role: 'user', parts: [{ text }] });

    const steps = [];

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
      let response;
      try {
        response = await generateWithFallback(this.contents);
      } catch (error) {
        throw new Error(friendlyError(error));
      }

      const modelContent = response.candidates?.[0]?.content;
      if (modelContent?.parts?.length) {
        // Store the whole content, including thought signatures, so multi-turn
        // tool use stays valid.
        this.contents.push(modelContent);
      }

      const calls = (response.functionCalls ?? []).filter((call) => call.name);

      if (calls.length === 0) {
        const textPart = readText(response);
        if (!modelContent && !textPart) {
          throw new Error(
            'Gemini returned an empty response. This can happen if the prompt was blocked by a safety filter.'
          );
        }
        return { reply: textPart || 'No text came back from Gemini.', steps };
      }

      const responseParts = [];

      for (const call of calls) {
        const started = Date.now();
        const args = call.args ?? {};
        const result = await runTool(call.name, args, this.toolState);
        const durationMs = Date.now() - started;

        steps.push({
          name: call.name,
          args,
          result,
          ok: !(result && typeof result === 'object' && 'error' in result),
          durationMs,
        });

        responseParts.push({
          functionResponse: {
            name: call.name,
            ...(call.id ? { id: call.id } : {}),
            response:
              result && typeof result === 'object' && !Array.isArray(result)
                ? result
                : { output: result },
          },
        });
      }

      this.contents.push({ role: 'user', parts: responseParts });
    }

    return {
      reply: `I stopped after ${MAX_TOOL_TURNS} tool rounds without reaching an answer. Try narrowing the question.`,
      steps,
    };
  }
}

function readText(response) {
  try {
    const value = response.text;
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    // The .text getter throws when the model returned only tool calls.
    return '';
  }
}

export const availableToolNames = toolNames;
