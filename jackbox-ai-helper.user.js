// ==UserScript==
// @name         Jackbox AI Helper
// @namespace    jaxkbox
// @version      1.0.0
// @description  Adds an AI button to jackbox.tv that suggests crowd-pleasing answers (Quiplash, Fibbage, Job Job, Tee K.O., Champ'd Up, Survive the Internet, and more) using Claude.
// @match        https://jackbox.tv/*
// @match        https://*.jackbox.tv/*
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @connect      api.anthropic.com
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Config / storage
  // ---------------------------------------------------------------------------
  const DEFAULTS = {
    apiKey: '',
    model: 'claude-opus-5-5',
    effort: 'low', // low = fastest; Jackbox timers are short
    count: 4,
    style: '', // e.g. "my friends love dark humor and puns", "keep it family friendly"
    autoSuggest: false, // fetch suggestions automatically when a new prompt appears
  };

  const store = {
    async get(key) {
      try {
        if (typeof GM !== 'undefined' && GM.getValue) {
          const v = await GM.getValue(key);
          if (v !== undefined) return v;
        }
      } catch (_) { /* fall through */ }
      try {
        const raw = localStorage.getItem('jbai_' + key);
        return raw === null ? undefined : JSON.parse(raw);
      } catch (_) { return undefined; }
    },
    async set(key, value) {
      try {
        if (typeof GM !== 'undefined' && GM.setValue) { await GM.setValue(key, value); return; }
      } catch (_) { /* fall through */ }
      try { localStorage.setItem('jbai_' + key, JSON.stringify(value)); } catch (_) { /* ignore */ }
    },
  };

  let settings = { ...DEFAULTS };
  async function loadSettings() {
    for (const k of Object.keys(DEFAULTS)) {
      const v = await store.get(k);
      if (v !== undefined) settings[k] = v;
    }
  }

  // ---------------------------------------------------------------------------
  // HTTP (GM.xmlHttpRequest avoids CORS; fall back to fetch)
  // ---------------------------------------------------------------------------
  function gmRequest(opts) {
    const fn = (typeof GM !== 'undefined' && GM.xmlHttpRequest) ||
      (typeof GM_xmlhttpRequest !== 'undefined' && GM_xmlhttpRequest);
    if (!fn) return null;
    return new Promise((resolve, reject) => {
      const r = fn({
        ...opts,
        onload: (res) => resolve({ status: res.status, text: res.responseText }),
        onerror: () => reject(new Error('Network error')),
        ontimeout: () => reject(new Error('Request timed out')),
      });
      if (r && typeof r.then === 'function') r.catch(reject);
    });
  }

  async function postJSON(url, headers, body) {
    const payload = JSON.stringify(body);
    const viaGM = gmRequest({ method: 'POST', url, headers, data: payload, timeout: 60000 });
    if (viaGM) return viaGM;
    const res = await fetch(url, { method: 'POST', headers, body: payload });
    return { status: res.status, text: await res.text() };
  }

  // ---------------------------------------------------------------------------
  // Claude call
  // ---------------------------------------------------------------------------
  const SYSTEM_PROMPT = `You are a world-class Jackbox Party Pack player helping one player on their phone (jackbox.tv).
You receive the visible text of their phone screen and info about the input fields / buttons on it. Work out which game and which phase it is, then help them win the most votes / points.

Game-specific strategy:
- Quiplash (1/2/3/XL), Thriplash: short, punchy, surprising, specific. Subvert the obvious answer. Callbacks to pop culture work. Thriplash = 3 lines that work together or escalate.
- Fibbage / Fibbage 4 / Enough About You: write a LIE that sounds like the real answer - plausible, matching the expected format/length, not obviously jokey (unless the screen says it's a funny-lie round). Never write the likely true answer.
- Job Job: answers may ONLY use words available in the word bank shown on screen; build a funny/impressive interview answer from them.
- Tee K.O.: slogans that are funny standing alone and pair with many drawings.
- Champ'd Up: champion names that are punny and fit the category.
- Survive the Internet: twist the original quote into the most out-of-context, damning caption.
- Joke Boat: complete the punchline with a twist; Talking Points / Blather Round / Dictionarium / Patently Stupid / Quixort / Hypnotorious / Roomerang / others: adapt to the visible instructions.
- Trivia (Murder Trivia, Trivia Murder Party, etc.): give the correct answer.
- Drawful: titles/lies for drawings - if a drawing image is attached, base it on that.

Respect any character limit given. Never include quotes around answers, emojis (unless fitting), or explanations inside the answers.
Answers must be things the player can type as-is.

Respond with ONLY a JSON object, no markdown fences:
For text-entry screens:
{"game":"<game guess>","mode":"write","suggestions":[["answer for field 1","answer for field 2 (only if there are multiple fields)"], ...],"tip":"<one short sentence of strategy>"}
(Each suggestion is an array with exactly one string per input field, in order.)
For pick/vote screens (choice buttons, no text field):
{"game":"<game guess>","mode":"pick","pick":<0-based index into the choices list>,"reason":"<one short sentence>"}`;

  async function askClaude(ctx) {
    if (!settings.apiKey) throw new Error('Add your Anthropic API key in settings (⚙️).');

    const userContent = [];
    for (const img of ctx.images) {
      userContent.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: img } });
    }
    userContent.push({ type: 'text', text: buildUserText(ctx) });

    const body = {
      model: settings.model,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      output_config: { effort: settings.effort },
      fallbacks: 'default',
      messages: [{ role: 'user', content: userContent }],
    };

    const res = await postJSON('https://api.anthropic.com/v1/messages', {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2026-10-21',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    }, body);

    let data;
    try { data = JSON.parse(res.text); } catch (_) { throw new Error('Bad response (HTTP ' + res.status + ')'); }
    if (res.status >= 400) throw new Error((data.error && data.error.message) || ('HTTP ' + res.status));
    if (data.stop_reason === 'refusal') throw new Error('The model declined this prompt. Try writing your own!');

    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return parseResult(text);
  }

  function buildUserText(ctx) {
    const lines = [];
    lines.push('PHONE SCREEN TEXT:\n"""\n' + ctx.screenText + '\n"""');
    if (ctx.fields.length) {
      lines.push('\nTEXT INPUT FIELDS (' + ctx.fields.length + '):');
      ctx.fields.forEach((f, i) => {
        lines.push(`  ${i + 1}. placeholder="${f.placeholder}" maxlength=${f.maxLength || 'none'} current="${f.value}"`);
      });
    }
    if (ctx.choices.length) {
      lines.push('\nCHOICE BUTTONS:');
      ctx.choices.forEach((c, i) => lines.push(`  [${i}] ${c}`));
    }
    lines.push('\nGive ' + settings.count + ' suggestions (best first) if this is a text-entry screen.');
    if (settings.style) lines.push('Audience / style notes from the player: ' + settings.style);
    if (ctx.extra) lines.push('Extra request from the player: ' + ctx.extra);
    return lines.join('\n');
  }

  function parseResult(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('Could not read the AI response.');
    const obj = JSON.parse(text.slice(start, end + 1));
    if (Array.isArray(obj.suggestions)) {
      obj.suggestions = obj.suggestions.map((s) => (Array.isArray(s) ? s.map(String) : [String(s)]));
    }
    return obj;
  }

  // ---------------------------------------------------------------------------
  // Reading the Jackbox screen
  // ---------------------------------------------------------------------------
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  }

  function getFields() {
    return [...document.querySelectorAll('textarea, input[type="text"], input:not([type])')]
      .filter((el) => isVisible(el) && !el.disabled && !el.readOnly)
      // skip the join screen's room-code / name inputs
      .filter((el) => !/room|code|name/i.test((el.id || '') + ' ' + (el.name || '')) || el.tagName === 'TEXTAREA');
  }

  function getChoiceButtons() {
    return [...document.querySelectorAll('button')]
      .filter((b) => isVisible(b) && !b.disabled)
      .filter((b) => {
        const t = (b.innerText || '').trim();
        return t && !/^(submit|send|done|ok|start|everybody'?s in|vip|menu|settings|back|cancel)$/i.test(t);
      });
  }

  function getCanvasImages() {
    const out = [];
    for (const c of document.querySelectorAll('canvas')) {
      if (out.length >= 2) break;
      if (!isVisible(c) || c.width < 50 || c.height < 50) continue;
      try {
        const url = c.toDataURL('image/png');
        if (url.length > 5000) out.push(url.split(',')[1]); // skip blank canvases
      } catch (_) { /* tainted canvas */ }
    }
    return out;
  }

  function readContext(extra) {
    const fields = getFields();
    const choiceEls = fields.length ? [] : getChoiceButtons();
    const screenText = (document.body.innerText || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
    return {
      screenText,
      fields: fields.map((f) => ({
        el: f,
        placeholder: f.placeholder || '',
        maxLength: f.maxLength > 0 ? f.maxLength : null,
        value: f.value || '',
      })),
      choiceEls,
      choices: choiceEls.map((b) => b.innerText.trim().replace(/\s+/g, ' ').slice(0, 200)),
      images: getCanvasImages(),
      extra,
    };
  }

  // React-controlled inputs need the native setter + an input event.
  function fillField(el, value) {
    if (el.maxLength > 0) value = value.slice(0, el.maxLength);
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ---------------------------------------------------------------------------
  // UI (inside a shadow root so it is not part of the screen text we send)
  // ---------------------------------------------------------------------------
  const host = document.createElement('div');
  host.id = 'jbai-host';
  host.style.cssText = 'position:fixed;z-index:2147483647;inset:auto 0 0 auto;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: -apple-system, system-ui, sans-serif; }
      .fab { position: fixed; right: 14px; bottom: 14px; width: 52px; height: 52px; border-radius: 50%;
             border: none; background: #6d4aff; color: #fff; font-size: 24px; box-shadow: 0 4px 14px rgba(0,0,0,.35); }
      .fab.busy { animation: pulse 1s infinite; }
      @keyframes pulse { 50% { transform: scale(.9); opacity: .7; } }
      .panel { position: fixed; left: 10px; right: 10px; bottom: 76px; max-height: 65vh; overflow: auto;
               background: #16161d; color: #f2f2f7; border-radius: 14px; padding: 12px;
               box-shadow: 0 8px 30px rgba(0,0,0,.5); display: none; font-size: 15px; }
      .panel.open { display: block; }
      .row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
      .row input[type=text] { flex: 1; }
      .title { font-weight: 700; flex: 1; }
      .muted { color: #a0a0b0; font-size: 13px; }
      .err { color: #ff6b6b; }
      button.s { display: block; width: 100%; text-align: left; background: #2a2a36; color: #fff; border: 1px solid #3a3a4a;
                 border-radius: 10px; padding: 10px; margin: 6px 0; font-size: 15px; }
      button.s:active { background: #6d4aff; }
      button.s .f { display: block; }
      button.s .f + .f { margin-top: 4px; border-top: 1px dashed #444; padding-top: 4px; }
      .btn { background: #3a3a4a; color: #fff; border: none; border-radius: 8px; padding: 8px 10px; font-size: 14px; }
      .btn.primary { background: #6d4aff; }
      input, select { background: #0e0e14; color: #fff; border: 1px solid #3a3a4a; border-radius: 8px; padding: 8px; font-size: 16px; }
      label { display: block; margin: 8px 0 4px; font-size: 13px; color: #c0c0d0; }
      .settings input, .settings select { width: 100%; }
    </style>
    <button class="fab" title="Jackbox AI Helper">✨</button>
    <div class="panel">
      <div class="row">
        <span class="title">Jackbox AI</span>
        <button class="btn" data-act="settings">⚙️</button>
        <button class="btn" data-act="close">✕</button>
      </div>
      <div class="main">
        <div class="row">
          <input type="text" class="extra" placeholder="Optional: 'more savage', 'about Mike'…">
          <button class="btn primary" data-act="go">Go</button>
        </div>
        <div class="out muted">Tap Go (or the ✨ button) when a prompt is on screen.</div>
      </div>
      <div class="settings" style="display:none">
        <label>Anthropic API key</label>
        <input type="password" data-k="apiKey" placeholder="sk-ant-...">
        <label>Model</label>
        <select data-k="model">
          <option value="claude-opus-5-5">Claude Opus 5.5 (best)</option>
          <option value="claude-sonnet-5-5">Claude Sonnet 5.5 (faster/cheaper)</option>
          <option value="claude-haiku-5-5">Claude Haiku 5.5 (fastest/cheapest)</option>
        </select>
        <label>Speed vs. quality (effort)</label>
        <select data-k="effort">
          <option value="low">Low – fastest</option>
          <option value="medium">Medium</option>
          <option value="high">High – slowest, most thoughtful</option>
        </select>
        <label>Number of suggestions</label>
        <input type="text" inputmode="numeric" data-k="count">
        <label>Audience / humor style</label>
        <input type="text" data-k="style" placeholder="e.g. college friends, dark humor OK">
        <label><input type="checkbox" data-k="autoSuggest"> Auto-suggest when a new prompt appears</label>
        <div class="row" style="margin-top:10px">
          <button class="btn primary" data-act="save">Save</button>
          <span class="muted">Key is stored only on this device.</span>
        </div>
      </div>
    </div>`;

  const $ = (sel) => root.querySelector(sel);
  const fab = $('.fab');
  const panel = $('.panel');
  const out = $('.out');

  function setOut(html) { out.innerHTML = html; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function showSettings(show) {
    $('.settings').style.display = show ? 'block' : 'none';
    $('.main').style.display = show ? 'none' : 'block';
    if (show) {
      root.querySelectorAll('[data-k]').forEach((el) => {
        const v = settings[el.dataset.k];
        if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
      });
    }
  }

  async function saveSettings() {
    for (const el of root.querySelectorAll('[data-k]')) {
      const k = el.dataset.k;
      let v = el.type === 'checkbox' ? el.checked : el.value.trim();
      if (k === 'count') v = Math.min(8, Math.max(1, parseInt(v, 10) || DEFAULTS.count));
      settings[k] = v;
      await store.set(k, v);
    }
    showSettings(false);
    setOut('<span class="muted">Saved.</span>');
  }

  let busy = false;
  let lastCtx = null;

  async function run() {
    if (busy) return;
    panel.classList.add('open');
    showSettings(false);
    if (!settings.apiKey) { showSettings(true); return; }

    const ctx = readContext($('.extra').value.trim());
    if (!ctx.fields.length && !ctx.choices.length) {
      setOut('<span class="muted">No text box or choices found on screen yet.</span>');
      return;
    }
    lastCtx = ctx;
    busy = true;
    fab.classList.add('busy');
    setOut('<span class="muted">Thinking…</span>');
    try {
      const result = await askClaude(ctx);
      render(result, ctx);
    } catch (e) {
      setOut('<span class="err">' + esc(e.message || e) + '</span>');
    } finally {
      busy = false;
      fab.classList.remove('busy');
    }
  }

  function render(result, ctx) {
    let html = result.game ? `<div class="muted">🎮 ${esc(result.game)}</div>` : '';
    if (result.mode === 'pick' && Number.isInteger(result.pick) && ctx.choiceEls[result.pick]) {
      html += `<div style="margin:8px 0">Pick: <b>${esc(ctx.choices[result.pick])}</b></div>`;
      html += result.reason ? `<div class="muted">${esc(result.reason)}</div>` : '';
      html += `<button class="s" data-pick="${result.pick}">👉 Tap to choose it</button>`;
    } else if (Array.isArray(result.suggestions) && result.suggestions.length) {
      result.suggestions.forEach((s, i) => {
        html += `<button class="s" data-i="${i}">` + s.map((f) => `<span class="f">${esc(f)}</span>`).join('') + '</button>';
      });
      html += '<div class="muted">Tap one to fill it in, then hit the game\'s submit button.</div>';
    } else {
      html += '<div class="muted">No suggestions returned. Try again.</div>';
    }
    if (result.tip) html += `<div class="muted" style="margin-top:6px">💡 ${esc(result.tip)}</div>`;
    setOut(html);

    out.querySelectorAll('button[data-i]').forEach((b) => b.addEventListener('click', () => {
      const s = result.suggestions[+b.dataset.i];
      ctx.fields.forEach((f, idx) => {
        if (s[idx] !== undefined && f.el.isConnected) fillField(f.el, s[idx]);
      });
      if (ctx.fields[0] && ctx.fields[0].el.isConnected) ctx.fields[0].el.focus();
      panel.classList.remove('open');
    }));
    out.querySelectorAll('button[data-pick]').forEach((b) => b.addEventListener('click', () => {
      const el = ctx.choiceEls[+b.dataset.pick];
      if (el && el.isConnected) el.click();
      panel.classList.remove('open');
    }));
  }

  fab.addEventListener('click', () => {
    if (panel.classList.contains('open') && !busy) { panel.classList.remove('open'); return; }
    run();
  });
  root.addEventListener('click', (e) => {
    const act = e.target.closest && e.target.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act;
    if (a === 'close') panel.classList.remove('open');
    else if (a === 'settings') showSettings($('.settings').style.display === 'none');
    else if (a === 'save') saveSettings();
    else if (a === 'go') run();
  });
  $('.extra').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });

  // ---------------------------------------------------------------------------
  // Auto-suggest: watch for a new prompt (new set of input fields) appearing
  // ---------------------------------------------------------------------------
  let lastSignature = '';
  let debounce = null;
  function screenSignature() {
    const f = getFields();
    if (!f.length) return '';
    return f.length + '|' + (document.body.innerText || '').slice(0, 600);
  }
  const observer = new MutationObserver(() => {
    if (!settings.autoSuggest) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const sig = screenSignature();
      if (sig && sig !== lastSignature) {
        lastSignature = sig;
        $('.extra').value = '';
        run();
      } else if (!sig) {
        lastSignature = '';
      }
    }, 700);
  });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  loadSettings().then(() => {
    document.documentElement.appendChild(host);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
})();
