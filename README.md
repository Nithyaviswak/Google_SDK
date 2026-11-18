# Toolbox — Gemini SDK tool-calling demo

A small chat web app built on the official
[`@google/genai`](https://www.npmjs.com/package/@google/genai) JavaScript SDK.
When the model needs a fact, a calculation, or a place to store something, it
calls one of six local tools — and the UI shows every call, its arguments, its
result, and how long it took.

```
Browser (vanilla JS)  ──POST /api/chat──▶  Express server
                                               │
                                     Gemini generateContent (v1beta)
                                               │
                              functionCalls ───┴──▶ src/tools.js
                                       ▲                 │
                                       └── functionResponse
```

## Quick start

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
# paste your key from https://aistudio.google.com/apikey into .env
npm start
```

Open <http://localhost:3000>. The app boots without a key and shows a setup
banner instead of crashing, so you can inspect the UI first.

Current `.env` in this folder:

```ini
GEMINI_API_KEY=AIza...
GEMINI_MODEL=gemini-3.5-flash-lite
```

The model is pinned to the one with free quota available right now; remove the
line to let the app start from `gemini-3.8-flash` and fall back automatically.

## What are tool calls?

Tool calling (function calling) lets the model ask your code to do something
instead of guessing. The model never runs code itself. One round works like this:

1. **Declare** each function with a name, description and JSON parameter schema.
2. **Send** the declarations in `config.tools` with the user's message.
3. **Read** `response.functionCalls` — structured `{ name, args }` requests.
4. **Execute** the function locally and send a `functionResponse` part back.
5. Repeat until the model answers in plain text.

Gemini can request several functions in one turn (parallel calling), and the
loop can run several times per message (compositional calling). This app runs
that loop manually so every step can be rendered in the UI.

## Tool calls this app handles

| Scenario | Example prompt | What happens |
| --- | --- | --- |
| No tool needed | "Say hi in one sentence." | Single API call, plain text, no tool cards |
| Single tool call | "What time is it in Tokyo?" | `get_current_time` with an IANA zone |
| Exact arithmetic | "What is 18% of 2,480, then divided by 7?" | `calculate` (parser, **no `eval()`**) |
| Parallel calls in one turn | "Compare the weather in Reykjavik and Lisbon." | Two `get_weather` calls; both `functionResponse` parts go back together |
| Compositional / sequential | "Search the docs for function calling, then save a three-step note." | `search_knowledge_base` → `save_note` → final answer |
| Session memory | "What did I ask you to remember?" | `list_notes` reads notes saved earlier in the session |
| Tool errors | "Divide 5 by 0." | Tool returns `{ error }`; the model explains it and the card turns red |
| Bad arguments | Unknown time zone, empty note, unknown tool | Validated locally, error object returned to the model |
| Multi-turn context | Follow-ups after a tool call | Full history kept, including Gemini thought signatures |
| Runaway loops | A model that keeps calling tools | Loop stops after 6 rounds with an explanation |
| Service failures | Invalid key, rate limit, busy model, offline | Friendly message; 401/404/429/503/network mapped |

The UI also handles: streaming-style "thinking" state, collapsible argument and
result JSON, per-tool duration, sidebar activity flash, session reset, and
Markdown replies (rendered from escaped text, no `innerHTML` passthrough).

### Tools exposed

| Tool | What it does |
| --- | --- |
| `get_current_time` | Real date/time in any IANA time zone via `Intl` |
| `calculate` | Arithmetic with a hand-written parser — no `eval()` |
| `get_weather` | Deterministic, clearly-labelled simulated weather |
| `search_knowledge_base` | Keyword search over notes about Gemini / this app |
| `save_note` | Stores a note for the current session |
| `list_notes` | Reads the session's notes back |

## Metrics you can put on a resume

### Static metrics

| Metric | Value |
| --- | --- |
| Custom function declarations | **6** |
| HTTP API routes | **3** (`/api/chat`, `/api/reset`, `/api/health`) |
| Frontend dependencies / build steps | **0 / 0** |
| Backend runtime dependencies | **3** (`@google/genai`, `express`, `dotenv`) |
| Source | **2,648 lines** (2,301 non-blank) across 8 files, **67.3 KB** |
| Session cap / message cap / tool rounds | 200 / 4,000 chars / 6 |
| Error classes mapped | 5 (401/403, 404, 429, 503, network) |

### Measured latency

Measured on 2026-11-18, local machine, via `npm run metrics` (n = 5 samples on
`gemini-2.5-flash`, n = 3 on `gemini-3.5-flash-lite`):

| Model | Flow | API calls | Min | Median | Max |
| --- | --- | --- | --- | --- | --- |
| `gemini-2.5-flash` | Tool-assisted answer ("17 × 23") | 2 | 2,212 ms | **2,548 ms** | 2,646 ms |
| `gemini-3.5-flash-lite` | Tool-assisted answer ("17 × 23") | 2 | 7,622 ms | **7,722 ms** | 10,469 ms |
| `gemini-2.5-flash` | Plain answer | 1 | 1,059 ms | ~1,116 ms | 1,174 ms |
| any | Local tool execution | — | 0 ms | <1 ms | 1 ms |

`3.5-flash-lite` is slower but kept working when the 2.5 quota ran out and the
3.x flash models were returning 503 "high demand" during testing. Samples that
hit a free-tier **429** are excluded from the table (the metrics script retries
once, then reports the failed sample).

### Resume bullets

- Built a Gemini SDK web app with **6 function-calling tools**, **3 API routes**,
  and **no frontend dependencies or build step**, using a manual
  tool-calling loop (declaration → `functionCalls` → local execution →
  `functionResponse`).
- Supported **parallel and sequential tool calls**, multi-turn session memory,
  and tool-error recovery, with a **median 2.55 s** end-to-end response for a
  tool-assisted answer on `gemini-2.5-flash` (7.72 s on the free-tier
  `gemini-3.5-flash-lite`) and **0–1 ms** local tool execution.
- Added resilient model selection: automatic fallback across up to eight Gemini
  models, a **60 s cooldown** for unavailable models, SDK retries disabled for
  fast switching, and friendly handling of **401/404/429/503/network** errors.
- Hardened inputs and state: 4,000-character message cap, 6-round tool-loop
  guard, 200-session in-memory cap, argument validation, and arithmetic
  restricted to `0-9 + - * / % ^ ( ) .` with **no `eval()`**.

Regenerate these numbers any time (server must be running):

```bash
npm run metrics        # 3 samples
npm run metrics 5      # 5 samples
```

## How the tool loop works

1. The user message is appended to the session history.
2. `ai.models.generateContent()` is called with `config.tools` and
   `automaticFunctionCalling: { disable: true }`.
3. If `response.functionCalls` is present, each call runs in `src/tools.js`
   and a `functionResponse` part is appended for the next turn.
4. The loop repeats (max 6 rounds) until the model returns plain text.

Implementation details worth knowing:

- The full model `content` is pushed back into history, including thought
  signatures, so multi-turn tool use stays valid on Gemini 3 models.
- `httpOptions.apiVersion` is set to **`v1beta`** — function calling is not
  enabled on `v1` for the Gemini API.
- `httpOptions.retryOptions.attempts` is **1** so a busy model fails fast and
  the next candidate can be tried instead of waiting ~35 s.
- If a model returns **404** (retired / unavailable for the key) or **503**
  (high demand), the app tries the next candidate, remembers the working model,
  and skips failed models for 60 s.
- Model order: `GEMINI_MODEL` first, then `gemini-3.8-flash`, `3.7`, `3.6`,
  `3.5`, `3.5-flash-lite`, `3.1-flash-lite`, `2.5`. The active model is shown
  in the header and in `/api/health`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | Required. Server-side only; never sent to the browser |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Preferred model; falls back automatically. This workspace pins `gemini-3.5-flash-lite` |
| `PORT` | `3000` | HTTP port |
| `GEMINI_BASE_URL` | public API | Only for a proxy or mock endpoint |
| `APP_URL` | `http://localhost:3000` | Used by `npm run metrics` |

## Project layout

```
server.js              Express routes + session store
src/gemini.js          SDK client, system prompt, tool loop, model fallback
src/tools.js           Function declarations + implementations
public/                Chat UI (HTML, CSS, JS — no build step)
scripts/metrics.mjs    Static + live metrics for the README/resume
scripts/list-models.mjs  Lists models available to your API key
```

## Troubleshooting

### The page says "No API key found"

The server only reads `.env` at startup. Check, in order:

1. The file is named exactly `.env`, in the same folder as `package.json`
   (Windows Notepad can silently save `.env.txt`).
2. `GEMINI_API_KEY` has a value and no `#` in front of it.
3. **Restart the server** after editing. `npm start` does not watch `.env`
   (`npm run dev` only watches JS files).
4. Confirm with:
   ```bash
   curl http://localhost:3000/api/health
   ```
   `"configured": true` means the key was loaded. The banner is rendered from
   that endpoint, so a stale tab can also be refreshed.

### "Gemini rejected the API key"

The key loaded but the API returned 401/403. Regenerate it at
<https://aistudio.google.com/apikey> and restart.

### "None of the candidate models are available"

The key may not have access to any listed model. Check what it can use:

```bash
node scripts/list-models.mjs
```

Then set `GEMINI_MODEL` to one of them.

### 429 or 503

**429** is quota/rate limiting (free tier is tight). **503** means the model is
temporarily busy; the app switches models automatically. Retry after a few
seconds.

## Notes and limits

- History and notes live in memory per session (max 200 sessions); restarting
  the server clears everything.
- The API key stays on the server; tool output is treated as data.
- Weather is simulated and labelled as such; no weather service is called.
- If a tool fails, the error object goes back to the model and appears in red
  in the UI.
- `GEMINI_BASE_URL` is only for testing against a proxy/mock; leave it unset
  for the public API.
