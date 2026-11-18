import { Type } from '@google/genai';

/**
 * Every tool has two parts:
 *   1. a declaration the model can read (name, description, JSON schema)
 *   2. an implementation that runs locally
 *
 * Tool results are always plain JSON-serializable objects so they can be
 * sent straight back to Gemini as a `functionResponse`.
 */

const TOOL_META = {
  get_current_time: {
    label: 'Clock',
    blurb: 'Current date and time in any time zone',
  },
  calculate: {
    label: 'Calculator',
    blurb: 'Safe arithmetic without eval()',
  },
  get_weather: {
    label: 'Weather',
    blurb: 'Simulated forecast for a city',
  },
  search_knowledge_base: {
    label: 'Docs search',
    blurb: 'Search a small local knowledge base',
  },
  save_note: {
    label: 'Save note',
    blurb: 'Store a note for this session',
  },
  list_notes: {
    label: 'List notes',
    blurb: 'Read back saved notes',
  },
};

export const toolDeclarations = [
  {
    name: 'get_current_time',
    description:
      'Get the current date, time and day of week in a specific IANA time zone. Use this whenever the user asks about "now", today\'s date, or time in a place.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        timezone: {
          type: Type.STRING,
          description:
            'IANA time zone such as "Europe/London", "America/New_York" or "Asia/Tokyo". Defaults to the server time zone.',
        },
      },
    },
  },
  {
    name: 'calculate',
    description:
      'Evaluate an arithmetic expression exactly. Supports + - * / % ^ and parentheses. Use this instead of doing mental math for anything non-trivial.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        expression: {
          type: Type.STRING,
          description: 'The expression to evaluate, e.g. "(12 * 7 + 3) / 2".',
        },
      },
      required: ['expression'],
    },
  },
  {
    name: 'get_weather',
    description:
      'Get the current weather for a city. The data is simulated for demo purposes, so mention that it is simulated when you report it.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        location: {
          type: Type.STRING,
          description: 'City name, e.g. "Berlin" or "San Francisco".',
        },
        unit: {
          type: Type.STRING,
          enum: ['celsius', 'fahrenheit'],
          description: 'Temperature unit. Defaults to celsius.',
        },
      },
      required: ['location'],
    },
  },
  {
    name: 'search_knowledge_base',
    description:
      'Search the local knowledge base for notes about the Gemini API, function calling, and how this demo app works. Use it for questions about Gemini models, tools, or this project.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Keywords to search for, e.g. "function calling".',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'save_note',
    description:
      'Save a short note in this chat session. Use it when the user asks to remember something, make a list, or keep track of an idea.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        text: {
          type: Type.STRING,
          description: 'The note content.',
        },
        tag: {
          type: Type.STRING,
          description: 'Optional single-word tag, e.g. "todo" or "idea".',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'list_notes',
    description:
      'List every note saved in this chat session. Use it when the user asks what you remembered or wants a recap.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
];

export function getToolCatalog() {
  return toolDeclarations.map((declaration) => ({
    name: declaration.name,
    label: TOOL_META[declaration.name]?.label ?? declaration.name,
    description: TOOL_META[declaration.name]?.blurb ?? declaration.description,
  }));
}

const KNOWLEDGE_BASE = [
  {
    title: 'What the Gemini SDK is',
    tags: ['sdk', 'gemini', 'npm', 'install', 'javascript', 'node'],
    body: 'The official JavaScript/TypeScript package is @google/genai. Install it with "npm install @google/genai", create a client with new GoogleGenAI({ apiKey }), and generate text with ai.models.generateContent({ model, contents }). The API key can be created for free in Google AI Studio.',
  },
  {
    title: 'How function calling works',
    tags: ['function', 'calling', 'tools', 'tool', 'calls', 'schema'],
    body: 'Function calling has four steps: declare functions with name/description/parameters, send them in config.tools, read response.functionCalls when the model asks for data, then send a functionResponse part back. The loop repeats until the model answers in plain text. The model never runs code itself.',
  },
  {
    title: 'Manual vs automatic tool loops',
    tags: ['automatic', 'afc', 'manual', 'loop', 'history'],
    body: 'This app uses a manual loop so every tool call can be rendered in the UI. The SDK also supports automatic function calling: pass JavaScript function implementations to the model and it will execute and re-prompt for you (config.automaticFunctionCalling tunes it). Manual loops are easier to audit and stream.',
  },
  {
    title: 'Choosing a Gemini model',
    tags: ['model', 'models', 'flash', 'pro', 'latest', 'version'],
    body: 'gemini-flash-latest is an alias that always points at the newest stable Flash model, which makes it a good default. Pin an explicit ID such as gemini-3.8-flash when you need reproducible behaviour. Override the model in this app with GEMINI_MODEL in .env.',
  },
  {
    title: 'How this demo app is built',
    tags: ['app', 'demo', 'architecture', 'express', 'server', 'session'],
    body: 'The backend is Express 5 with three routes: POST /api/chat, POST /api/reset and GET /api/health. Chat history lives in memory per session id. Tools are declared in src/tools.js and executed on the server; the browser receives a reply plus an array of tool steps to display.',
  },
  {
    title: 'Safety and tool data',
    tags: ['safety', 'security', 'keys', 'secrets', 'prompt', 'injection'],
    body: 'Keep GEMINI_API_KEY on the server and never ship it to the browser. Treat tool output as untrusted data, validate arguments, and keep tool permissions narrow. This demo whitelists arithmetic characters and never uses eval().',
  },
];

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

function getCurrentTime(args) {
  const timezone =
    args.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    throw new Error(
      `Unknown time zone "${timezone}". Use an IANA name like "Europe/Paris".`
    );
  }

  const now = new Date();
  return {
    timezone,
    formatted: formatter.format(now),
    iso: now.toISOString(),
    dayOfWeek: new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
    }).format(now),
  };
}

/**
 * Tiny recursive-descent arithmetic parser. No eval, no Function constructor.
 * Grammar: expr -> term (('+'|'-') term)* ; term -> unary (('*'|'/'|'%') unary)*
 */
function evaluateExpression(input) {
  const source = String(input ?? '').replace(/[\s,]/g, '');
  if (!source) throw new Error('The expression is empty.');
  if (!/^[0-9+\-*/%^().]+$/.test(source)) {
    throw new Error(
      'Only numbers and the operators + - * / % ^ ( ) are allowed.'
    );
  }

  const tokens =
    source.match(/\d*\.?\d+(?:e[+-]?\d+)?|[+\-*/%^()]/gi) ?? [];
  let position = 0;

  const peek = () => tokens[position];
  const next = () => tokens[position++];

  function parseExpression() {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const operator = next();
      const right = parseTerm();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  function parseTerm() {
    let value = parseUnary();
    while (['*', '/', '%'].includes(peek())) {
      const operator = next();
      const right = parseUnary();
      if ((operator === '/' || operator === '%') && right === 0) {
        throw new Error('Division by zero is not allowed.');
      }
      if (operator === '*') value *= right;
      else if (operator === '/') value /= right;
      else value %= right;
    }
    return value;
  }

  function parseUnary() {
    if (peek() === '-') {
      next();
      return -parseUnary();
    }
    if (peek() === '+') {
      next();
      return parseUnary();
    }
    return parsePower();
  }

  function parsePower() {
    const base = parsePrimary();
    if (peek() === '^') {
      next();
      return base ** parseUnary(); // right-associative
    }
    return base;
  }

  function parsePrimary() {
    const token = next();
    if (token === undefined) throw new Error('Unexpected end of expression.');
    if (token === '(') {
      const value = parseExpression();
      if (next() !== ')') throw new Error('Missing a closing parenthesis.');
      return value;
    }
    const number = Number(token);
    if (!Number.isFinite(number)) {
      throw new Error(`Unexpected token "${token}".`);
    }
    return number;
  }

  const result = parseExpression();
  if (position !== tokens.length) {
    throw new Error(`Could not parse near "${tokens[position]}".`);
  }
  if (!Number.isFinite(result)) {
    throw new Error('The result is not a finite number.');
  }
  return result;
}

function calculate(args) {
  const expression = args.expression;
  const value = evaluateExpression(expression);
  const rounded = Math.round(value * 1e10) / 1e10;
  return { expression: String(expression).trim(), result: rounded };
}

const WEATHER_SEED = [
  { condition: 'sunny', temperature: 24, humidity: 34, wind: 9 },
  { condition: 'partly cloudy', temperature: 19, humidity: 48, wind: 14 },
  { condition: 'overcast', temperature: 15, humidity: 63, wind: 11 },
  { condition: 'light rain', temperature: 12, humidity: 81, wind: 18 },
  { condition: 'thunderstorms', temperature: 27, humidity: 74, wind: 26 },
];

function getWeather(args) {
  const location = String(args.location ?? '').trim();
  if (!location) throw new Error('A location is required.');

  // Deterministic hash so the same city always reports the same weather.
  let hash = 0;
  for (const character of location.toLowerCase()) {
    hash = (hash * 31 + character.charCodeAt(0)) % 100000;
  }
  const sample = WEATHER_SEED[hash % WEATHER_SEED.length];
  const unit = args.unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
  const temperature = sample.temperature + (hash % 5) - 2;

  return {
    location,
    condition: sample.condition,
    temperature:
      unit === 'fahrenheit'
        ? Math.round((temperature * 9) / 5 + 32)
        : temperature,
    unit,
    humidityPercent: sample.humidity,
    windKph: sample.wind,
    simulated: true,
    note: 'Demo data generated locally. No weather service was called.',
  };
}

function searchKnowledgeBase(args) {
  const query = String(args.query ?? '').toLowerCase().trim();
  if (!query) throw new Error('A query is required.');

  const words = query.split(/\W+/).filter((word) => word.length > 2);
  const scored = KNOWLEDGE_BASE.map((entry) => {
    const haystack = `${entry.title} ${entry.tags.join(' ')} ${entry.body}`.toLowerCase();
    let score = 0;
    for (const word of words) {
      if (entry.title.toLowerCase().includes(word)) score += 5;
      if (entry.tags.some((tag) => tag.includes(word))) score += 3;
      if (haystack.includes(word)) score += 1;
    }
    return { entry, score };
  })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (scored.length === 0) {
    return {
      query,
      matches: [],
      message: 'No knowledge base entries matched that query.',
    };
  }

  return {
    query,
    matches: scored.map(({ entry, score }) => ({
      title: entry.title,
      text: entry.body,
      score,
    })),
  };
}

function saveNote(args, state) {
  const text = String(args.text ?? '').trim();
  if (!text) throw new Error('Note text is required.');
  if (text.length > 500) throw new Error('Notes are limited to 500 characters.');

  const note = {
    id: state.notes.length + 1,
    text,
    tag: args.tag ? String(args.tag).toLowerCase().slice(0, 24) : null,
    createdAt: new Date().toISOString(),
  };
  state.notes.push(note);

  return { saved: true, note, totalNotes: state.notes.length };
}

function listNotes(_args, state) {
  return {
    totalNotes: state.notes.length,
    notes: state.notes.map(({ id, text, tag, createdAt }) => ({
      id,
      text,
      tag,
      createdAt,
    })),
  };
}

const IMPLEMENTATIONS = {
  get_current_time: getCurrentTime,
  calculate,
  get_weather: getWeather,
  search_knowledge_base: searchKnowledgeBase,
  save_note: saveNote,
  list_notes: listNotes,
};

export const toolNames = Object.keys(IMPLEMENTATIONS);

export function createToolState() {
  return { notes: [] };
}

export async function runTool(name, args, state) {
  const implementation = IMPLEMENTATIONS[name];
  if (!implementation) {
    return { error: `Unknown tool "${name}".` };
  }
  try {
    const output = implementation(args ?? {}, state);
    return output;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
