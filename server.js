import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  ChatSession,
  availableToolNames,
  getModelName,
  isConfigured,
} from './src/gemini.js';
import { getToolCatalog } from './src/tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MAX_SESSIONS = 200;
const MAX_MESSAGE_LENGTH = 4000;

const app = express();
const sessions = new Map();

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

function getSession(sessionId) {
  const id = typeof sessionId === 'string' && sessionId.trim() ? sessionId : randomUUID();
  let session = sessions.get(id);
  if (!session) {
    if (sessions.size >= MAX_SESSIONS) {
      // Drop the oldest session when the in-memory store is full.
      const oldest = sessions.keys().next().value;
      sessions.delete(oldest);
    }
    session = new ChatSession(id);
    sessions.set(id, session);
  }
  return session;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    configured: isConfigured,
    model: getModelName(),
    tools: getToolCatalog(),
    toolCount: availableToolNames.length,
    activeSessions: sessions.size,
  });
});

app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body ?? {};

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Send a non-empty "message".' });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({
      error: `Messages are limited to ${MAX_MESSAGE_LENGTH} characters.`,
    });
  }
  if (!isConfigured) {
    return res.status(503).json({
      error:
        'The server has no Gemini API key. Add GEMINI_API_KEY to .env and restart.',
      code: 'NOT_CONFIGURED',
    });
  }

  const session = getSession(sessionId);

  try {
    const { reply, steps } = await session.send(message.trim());
    res.json({ sessionId: session.id, reply, steps });
  } catch (error) {
    const status = error?.code === 'NOT_CONFIGURED' ? 503 : 502;
    res.status(status).json({
      error: error instanceof Error ? error.message : 'Unexpected server error.',
      sessionId: session.id,
    });
  }
});

app.post('/api/reset', (req, res) => {
  const { sessionId } = req.body ?? {};
  if (typeof sessionId === 'string' && sessions.has(sessionId)) {
    sessions.get(sessionId).reset();
  }
  res.json({ ok: true, sessionId: sessionId ?? null });
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Unknown API route.' });
});

app.use((error, _req, res, _next) => {
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body must be valid JSON.' });
  }
  console.error('[server]', error);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

app.listen(PORT, () => {
  console.log('');
  console.log('  Toolbox — Gemini tool-calling demo');
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  model: ${getModelName()}`);
  console.log(
    `  key:   ${isConfigured ? 'found' : 'MISSING — add GEMINI_API_KEY to .env'}`
  );
  console.log('');
});
