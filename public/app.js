const chatEl = document.getElementById('chat');
const inputEl = document.getElementById('input');
const composerEl = document.getElementById('composer');
const sendButton = document.getElementById('send-button');
const resetButton = document.getElementById('reset-button');
const toolListEl = document.getElementById('tool-list');
const toolCountEl = document.getElementById('tool-count');
const suggestionsEl = document.getElementById('suggestions');
const noticeEl = document.getElementById('notice');
const modelBadgeEl = document.getElementById('model-badge');
const statusDotEl = document.getElementById('status-dot');
const statusTextEl = document.getElementById('status-text');

const welcomeTemplate = document.getElementById('welcome').cloneNode(true);

const TOOL_GLYPHS = {
  get_current_time: '⏱',
  calculate: '∑',
  get_weather: '☁',
  search_knowledge_base: '⌕',
  save_note: '✎',
  list_notes: '☰',
};

const state = {
  sessionId: createId(),
  busy: false,
  configured: false,
  toolNames: [],
};

// ------------------------------------------------------------------ helpers

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `s-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Deliberately small Markdown renderer: escapes everything first, then adds
 * a handful of safe tags. No third-party parser, no raw HTML passthrough.
 */
function renderMarkdown(raw) {
  const codeBlocks = [];
  const inlineCode = [];

  let text = escapeHtml(raw ?? '');

  text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (_match, code) => {
    codeBlocks.push(code.replace(/\n$/, ''));
    return `\u0000B${codeBlocks.length - 1}\u0000`;
  });
  text = text.replace(/`([^`\n]+)`/g, (_match, code) => {
    inlineCode.push(code);
    return `\u0000I${inlineCode.length - 1}\u0000`;
  });

  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, '$1<em>$2</em>');
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>'
  );

  const html = [];
  let paragraph = [];
  let listType = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${paragraph.join('<br>')}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const line of text.split('\n')) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = trimmed.match(/^#{1,4}\s+(.*)$/);
    if (heading) {
      flushParagraph();
      closeList();
      html.push(`<h3>${heading[1]}</h3>`);
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      if (listType !== 'ul') {
        closeList();
        html.push('<ul>');
        listType = 'ul';
      }
      html.push(`<li>${bullet[1]}</li>`);
      continue;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      if (listType !== 'ol') {
        closeList();
        html.push('<ol>');
        listType = 'ol';
      }
      html.push(`<li>${ordered[1]}</li>`);
      continue;
    }

    closeList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  closeList();

  return html
    .join('')
    .replace(/\u0000B(\d+)\u0000/g, (_match, index) => {
      return `<pre><code>${codeBlocks[Number(index)]}</code></pre>`;
    })
    .replace(/\u0000I(\d+)\u0000/g, (_match, index) => {
      return `<code>${inlineCode[Number(index)]}</code>`;
    });
}

function scrollToBottom(smooth = true) {
  chatEl.scrollTo({
    top: chatEl.scrollHeight,
    behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto',
  });
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function setBusy(busy) {
  state.busy = busy;
  sendButton.disabled = busy;
  inputEl.setAttribute('aria-busy', String(busy));
  statusTextEl.textContent = busy
    ? 'Working…'
    : state.configured
      ? `Connected · ${state.toolNames.length} tools`
      : 'API key missing';
}

// ----------------------------------------------------------------- rendering

function assistantAvatar() {
  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
      <path d="M13.5 3.5 6 13h5l-1.5 7.5L18 10h-5l.5-6.5Z" stroke-linejoin="round" />
    </svg>`;
  return avatar;
}

function userAvatar() {
  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = 'You';
  avatar.style.fontSize = '9px';
  avatar.style.fontWeight = '700';
  return avatar;
}

function addMessage(role, { text = '', steps = [], pending = false, error = false } = {}) {
  document.getElementById('welcome')?.remove();

  const article = document.createElement('article');
  article.className = `message ${role}`;
  article.appendChild(role === 'user' ? userAvatar() : assistantAvatar());

  const body = document.createElement('div');
  body.className = 'message-body';

  const label = document.createElement('div');
  label.className = 'message-role';
  label.textContent = role === 'user' ? 'You' : 'Toolbox';
  body.appendChild(label);

  if (role === 'assistant' && steps.length) {
    body.appendChild(renderSteps(steps));
  }

  const bubble = document.createElement('div');

  if (pending) {
    bubble.className = 'thinking';
    bubble.innerHTML = `
      <span class="thinking-dots"><i></i><i></i><i></i></span>
      <span>Thinking…</span>`;
  } else if (error) {
    bubble.className = 'bubble is-error';
    bubble.textContent = text;
  } else {
    bubble.className = role === 'user' ? 'bubble' : 'bubble prose';
    if (role === 'user') {
      bubble.textContent = text;
    } else {
      bubble.innerHTML = renderMarkdown(text);
    }
  }

  body.appendChild(bubble);
  article.appendChild(body);
  chatEl.appendChild(article);
  scrollToBottom();

  return { article, body, bubble };
}

function renderSteps(steps) {
  const wrap = document.createElement('div');
  wrap.className = 'steps';

  for (const step of steps) {
    const details = document.createElement('details');
    details.className = step.ok === false ? 'step is-error' : 'step';

    const summary = document.createElement('summary');
    const argsPreview = compactJson(step.args, 52);
    const duration =
      typeof step.durationMs === 'number'
        ? step.durationMs > 0
          ? `${step.durationMs} ms`
          : '<1 ms'
        : '';
    summary.innerHTML = `
      <span class="step-icon" aria-hidden="true">${step.ok === false ? '!' : '⚙'}</span>
      <span class="step-name">${escapeHtml(step.name)}</span>
      <span class="step-args">${escapeHtml(argsPreview)}</span>
      <span class="step-status">${step.ok === false ? 'error' : 'ok'}</span>
      ${duration ? `<span class="step-time">${duration}</span>` : ''}`;

    const body = document.createElement('div');
    body.className = 'step-body';

    body.appendChild(labelledPre('Arguments', prettyJson(step.args)));
    body.appendChild(labelledPre('Result', prettyJson(step.result)));

    details.appendChild(summary);
    details.appendChild(body);
    wrap.appendChild(details);
  }

  return wrap;
}

function labelledPre(labelText, content) {
  const block = document.createElement('div');
  const label = document.createElement('p');
  label.className = 'step-label';
  label.textContent = labelText;
  const pre = document.createElement('pre');
  pre.textContent = content;
  block.appendChild(label);
  block.appendChild(pre);
  return block;
}

function prettyJson(value) {
  let text;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (!text) return 'undefined';
  return text.length > 1600 ? `${text.slice(0, 1600)}\n… truncated` : text;
}

function compactJson(value, maxLength) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (!text || text === '{}') return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

// -------------------------------------------------------------------- tools

function renderToolList(tools) {
  toolListEl.innerHTML = '';
  toolListEl.classList.add('is-live');

  for (const tool of tools) {
    const item = document.createElement('li');
    item.className = 'tool-item';
    item.dataset.tool = tool.name;

    const glyph = document.createElement('span');
    glyph.className = 'tool-glyph';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = TOOL_GLYPHS[tool.name] ?? tool.name.slice(0, 2);

    const copy = document.createElement('div');
    copy.className = 'tool-copy';

    const name = document.createElement('div');
    name.className = 'tool-name';
    name.textContent = tool.name;

    const blurb = document.createElement('div');
    blurb.className = 'tool-blurb';
    blurb.textContent = tool.description;

    copy.appendChild(name);
    copy.appendChild(blurb);
    item.appendChild(glyph);
    item.appendChild(copy);
    toolListEl.appendChild(item);
  }

  toolCountEl.textContent = String(tools.length);
  state.toolNames = tools.map((tool) => tool.name);
}

function flashTool(name, ok) {
  const item = toolListEl.querySelector(`[data-tool="${CSS.escape(name)}"]`);
  if (!item) return;

  item.classList.add('is-running');
  window.setTimeout(() => {
    item.classList.remove('is-running');
    item.classList.add(ok ? 'is-done' : 'is-error');
    window.setTimeout(() => item.classList.remove('is-done', 'is-error'), 1800);
  }, 500);
}

// --------------------------------------------------------------------- send

async function sendMessage(rawText) {
  const text = rawText.trim();
  if (!text || state.busy) return;

  await healthReady;

  if (!state.configured) {
    noticeEl.hidden = false;
    inputEl.focus();
    return;
  }

  addMessage('user', { text });
  inputEl.value = '';
  resizeInput();
  setBusy(true);

  const pending = addMessage('assistant', { pending: true });

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, sessionId: state.sessionId }),
    });

    const data = await response.json().catch(() => ({}));
    if (data.sessionId) state.sessionId = data.sessionId;

    if (!response.ok) {
      pending.article.remove();
      addMessage('assistant', {
        text: data.error || `Request failed with status ${response.status}.`,
        error: true,
      });
      if (data.code === 'NOT_CONFIGURED') {
        state.configured = false;
        noticeEl.hidden = false;
        statusDotEl.className = 'dot is-warn';
      }
      return;
    }

    pending.article.remove();

    for (const step of data.steps ?? []) {
      flashTool(step.name, step.ok !== false);
    }

    addMessage('assistant', {
      text: data.reply ?? '',
      steps: data.steps ?? [],
    });
  } catch (error) {
    pending.article.remove();
    addMessage('assistant', {
      text: `Could not reach the server. ${error instanceof Error ? error.message : ''}`.trim(),
      error: true,
    });
  } finally {
    setBusy(false);
    inputEl.focus();
  }
}

function resizeInput() {
  inputEl.style.height = 'auto';
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 190)}px`;
}

function resetChat() {
  const oldSession = state.sessionId;
  state.sessionId = createId();
  chatEl.innerHTML = '';
  chatEl.appendChild(welcomeTemplate.cloneNode(true));
  inputEl.value = '';
  resizeInput();
  inputEl.focus();
  scrollToBottom(false);

  fetch('/api/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: oldSession }),
  }).catch(() => {});
}

// ---------------------------------------------------------------- wiring up

composerEl.addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage(inputEl.value);
});

inputEl.addEventListener('input', resizeInput);

inputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendMessage(inputEl.value);
  }
});

resetButton.addEventListener('click', resetChat);

suggestionsEl.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (state.busy) return;
  inputEl.value = button.textContent;
  sendMessage(button.textContent);
});

async function connect() {
  try {
    const response = await fetch('/api/health');
    const health = await response.json();

    state.configured = Boolean(health.configured);
    renderToolList(health.tools ?? []);
    modelBadgeEl.textContent = health.model ?? 'gemini';
    modelBadgeEl.title = `Model: ${health.model ?? 'unknown'}`;

    if (state.configured) {
      statusDotEl.className = 'dot is-ok';
      statusTextEl.textContent = `Connected · ${state.toolNames.length} tools`;
      noticeEl.hidden = true;
    } else {
      statusDotEl.className = 'dot is-warn';
      statusTextEl.textContent = 'API key missing';
      noticeEl.hidden = false;
    }
  } catch {
    statusDotEl.className = 'dot is-warn';
    statusTextEl.textContent = 'Server unreachable';
    toolListEl.innerHTML =
      '<li class="tool-item"><div class="tool-copy"><div class="tool-name">Could not load tools</div><div class="tool-blurb">Is the Node server running?</div></div></li>';
    toolListEl.classList.add('is-live');
  }
}

resizeInput();
const healthReady = connect();
inputEl.focus();
