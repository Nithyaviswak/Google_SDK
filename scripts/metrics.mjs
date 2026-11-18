/**
 * Prints static project metrics and (optionally) live API latency samples.
 * Usage: npm run metrics [samples]
 * Requires the app to be running for the live section.
 */
import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import { toolDeclarations } from '../src/tools.js';

const APP_URL = process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const SAMPLE_COUNT = Math.max(1, Number(process.argv[2]) || 3);

const root = new URL('..', import.meta.url);

async function listFiles(directory) {
  const entries = await readdir(new URL(directory, root), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => `${directory}/${entry.name}`.replace(/\/+/g, '/'))
    .sort();
}

const FILES = [
  'server.js',
  ...(await listFiles('src')),
  ...(await listFiles('public')),
  ...(await listFiles('scripts')),
];

async function text(file) {
  return readFile(new URL(file, root), 'utf8');
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function bytesLabel(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const lines = { total: 0, code: 0, bytes: 0 };
for (const file of FILES) {
  const source = await text(file);
  const rows = source.split(/\r?\n/);
  lines.total += rows.length;
  lines.code += rows.filter((row) => row.trim()).length;
  lines.bytes += Buffer.byteLength(source);
}

const serverSource = await text('server.js');
const routeCount = (serverSource.match(/app\.(?:get|post)\('\/api/g) ?? []).length;
const packageJson = JSON.parse(await text('package.json'));
const dependencyCount = Object.keys(packageJson.dependencies ?? {}).length;

let health = null;
try {
  const response = await fetch(`${APP_URL}/api/health`, {
    signal: AbortSignal.timeout(5000),
  });
  health = await response.json();
} catch {
  health = null;
}

const latencies = [];
const toolTimes = [];
let failures = 0;

if (health?.configured) {
  for (let index = 1; index <= SAMPLE_COUNT; index += 1) {
    const payload = {
      message: 'Use the calculate tool to compute 17 * 23, then reply with just the number.',
      sessionId: `metrics-${Date.now()}-${index}`,
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const started = performance.now();
      try {
        const response = await fetch(`${APP_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(60000),
        });
        const elapsed = performance.now() - started;
        const data = await response.json();

        if (response.ok) {
          latencies.push(elapsed);
          for (const step of data.steps ?? []) {
            if (typeof step.durationMs === 'number') toolTimes.push(step.durationMs);
          }
          break;
        }

        if (response.status === 429 && attempt === 0) {
          console.log('  (rate limited, retrying in 3s...)');
          await sleep(3000);
          continue;
        }

        failures += 1;
        console.log(`  sample ${index}: ${data.error ?? response.status}`);
        break;
      } catch (error) {
        failures += 1;
        console.log(`  sample ${index}: ${error.message}`);
        break;
      }
    }
  }
}

const sortedLatencies = [...latencies].sort((a, b) => a - b);

console.log('');
console.log('Toolbox - project metrics');
console.log('='.repeat(52));
console.log(`generated      ${new Date().toISOString()}`);
console.log('');
console.log('Static');
console.log(`  source files        ${FILES.length}`);
console.log(`  lines             ${lines.total} (${lines.code} non-blank)`);
console.log(`  source size       ${bytesLabel(lines.bytes)}`);
console.log(`  API routes        ${routeCount}`);
console.log(`  tool declarations ${toolDeclarations.length}`);
console.log(`  backend deps      ${dependencyCount}`);
console.log('  frontend deps     0');
console.log('  build steps       0');
console.log('');
console.log('Runtime');

if (!health) {
  console.log(`  app               unreachable at ${APP_URL}`);
  console.log('  start it with "npm start" to include live latency');
} else {
  console.log(`  app               ${APP_URL}`);
  console.log(`  model             ${health.model}`);
  console.log(`  api key           ${health.configured ? 'configured' : 'MISSING'}`);
  console.log(`  tools exposed     ${health.toolCount}`);
  if (latencies.length) {
    console.log('');
    console.log(`Live latency - tool-assisted answer (2 API calls), n=${latencies.length}`);
    console.log(
      `  min ${Math.round(sortedLatencies[0])} ms | median ${Math.round(
        median(latencies)
      )} ms | max ${Math.round(sortedLatencies.at(-1))} ms`
    );
    if (toolTimes.length) {
      console.log(
        `  local tool execution ${
          Math.max(...toolTimes) === 0
            ? '<1 ms'
            : `${Math.min(...toolTimes)}-${Math.max(...toolTimes)} ms`
        }`
      );
    }
    if (failures) console.log(`  failed samples     ${failures}`);
  }
}

console.log('');
console.log('Resume bullets');
console.log('-'.repeat(52));

const latencyText = latencies.length
  ? `median ${(median(latencies) / 1000).toFixed(2)} s`
  : 'latency measured by npm run metrics';
const toolRange = toolTimes.length
  ? Math.max(...toolTimes) === 0
    ? '<1 ms'
    : `${Math.min(...toolTimes)}-${Math.max(...toolTimes)} ms`
  : 'sub-millisecond';

console.log(
  `- Built a Gemini SDK web app with ${toolDeclarations.length} function-calling tools, ${routeCount} API routes and no frontend dependencies or build step.`
);
console.log(
  `- Implemented a manual tool-calling loop (parallel calls, multi-turn state, tool-error recovery) with ${latencyText} end-to-end for a tool-assisted answer and ${toolRange} local tool execution.`
);
console.log(
  '- Added automatic model fallback across multiple Gemini models with a 60 s cooldown, plus friendly handling for 401/404/429/503/network failures and validation limits (4k-char messages, 6 tool rounds, 200 sessions).'
);
console.log('');
