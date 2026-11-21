// ==UserScript==
// @name         Jackbox AI Helper
// @namespace    jaxkbox
// @version      2.0.0
// @description  AI sidekick for jackbox.tv: vote-winning answers for Quiplash, Fibbage, Job Job, Tee K.O., Champ'd Up, Survive the Internet, trivia and more. Adjustable spice level up to unhinged dark humor.
// @match        https://jackbox.tv/*
// @match        https://*.jackbox.tv/*
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @connect      api.anthropic.com
// @run-at       document-idle
// @noframes
// @updateURL    https://raw.githubusercontent.com/IJDAJDNs/Jaxkbox/claude/keen-dirac-mt2d7f/jackbox-ai-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/IJDAJDNs/Jaxkbox/claude/keen-dirac-mt2d7f/jackbox-ai-helper.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (window.__jbaiLoaded) return;
  window.__jbaiLoaded = true;

  // ===========================================================================
  // Settings
  // ===========================================================================
  const DEFAULTS = {
    apiKey: '',
    model: 'claude-opus-5-5',
    effort: 'low',
    count: 5,
    spice: 3, // 1 family · 2 normal · 3 edgy · 4 unhinged
    style: '',
    autoSuggest: false,
    memory: true,
    fabX: null,
    fabY: null,
  };

  const SPICE = {
    1: { label: '😇 Family', text: 'FAMILY FRIENDLY. No swearing, no innuendo, nothing gross. Clever, silly and wholesome - kids could be playing.' },
    2: { label: '🙂 Normal', text: 'PG-13. Mild swearing and light innuendo are fine. Cheeky, not crude.' },
    3: { label: '😈 Edgy', text: 'R-RATED. Swearing, sex jokes, gross-out, dark and morbid jokes are all fine. Be bold - the room is adults.' },
    4: { label: '💀 Unhinged', text: 'UNHINGED / NO FILTER. This is an adults-only room that explicitly wants the darkest, most shocking, most inappropriate jokes possible: death, sex, drugs, bodily fluids, existential dread, crime, war, disasters, terrible life choices, brutal roasts of the players by name. Make people gasp and then laugh. Do NOT soften, hedge, or sanitize. The only limit: no slurs and no jokes whose entire punchline is "this race/religion/sexuality/disability is bad" - those get groans instead of votes. Everything else is on the table.' },
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
      try { localStorage.setItem('jbai_' + key, JSON.stringify(value)); } catch (_) { /* ignore */ }
      try { if (typeof GM !== 'undefined' && GM.setValue) await GM.setValue(key, value); } catch (_) { /* ignore */ }
    },
  };

  const settings = { ...DEFAULTS };
  async function loadSettings() {
    for (const k of Object.keys(DEFAULTS)) {
      const v = await store.get(k);
      if (v !== undefined && v !== null) settings[k] = v;
    }
  }

  // Game memory: prompts seen + answers used this session, for callbacks
  const MEM_KEY = 'jbai_memory';
  function loadMemory() {
    try { return JSON.parse(sessionStorage.getItem(MEM_KEY)) || []; } catch (_) { return []; }
  }
  function remember(entry) {
    if (!settings.memory) return;
    const m = loadMemory();
    m.push(entry);
    try { sessionStorage.setItem(MEM_KEY, JSON.stringify(m.slice(-20))); } catch (_) { /* ignore */ }
  }
  function clearMemory() { try { sessionStorage.removeItem(MEM_KEY); } catch (_) { /* ignore */ } }

  // ===========================================================================
  // HTTP - GM.xmlHttpRequest avoids CORS; fetch is the fallback
  // ===========================================================================
  function gmRequest(opts) {
    const fn = (typeof GM !== 'undefined' && GM.xmlHttpRequest) ||
      (typeof GM_xmlhttpRequest !== 'undefined' && GM_xmlhttpRequest);
    if (!fn) return null;
    return new Promise((resolve, reject) => {
      const r = fn({
        ...opts,
        onload: (res) => resolve({ status: res.status, text: res.responseText }),
        onerror: () => reject(new Error('Network error - check your connection.')),
        ontimeout: () => reject(new Error('Timed out. Try a faster model or lower effort.')),
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

  // ===========================================================================
  // Prompting
  // ===========================================================================
  const SYSTEM_PROMPT = `You are the funniest, sharpest Jackbox Party Pack player alive, whispering answers to one player through their phone (jackbox.tv). Your only goal: win the room's votes and points.

You get the visible text of their phone screen, the input fields / buttons on it, and sometimes images. Work out the game and phase from the text, then answer.

HOW TO WIN VOTES (comedy):
- Your first idea is everyone's first idea. Skip it. Go to the 3rd or 4th idea.
- Specific beats generic: real brands, places, celebrities, oddly precise numbers, tiny vivid details.
- Short wins. Front-load the setup, put the funniest word LAST.
- Misdirection, reversal, escalation, painfully relatable truth, and callbacks to earlier rounds or to players in the room (use their names from the screen).
- Variety: make each suggestion a different angle (absurd, dark, clever wordplay, brutally honest, roast, etc.) so the player can read the room.

GAME PLAYBOOK:
- Quiplash 1/2/3/XL: one killer punchline. Thriplash/last round: three lines that escalate or share a theme. Word Lash / Comic Lash: follow the on-screen format.
- Fibbage (all) / Enough About You / Fibbage 4 final: write a LIE that looks like the real answer - match its expected length, tone and format, believable enough to fool people. Don't be the obvious joke, don't accidentally write the truth. When VOTING in Fibbage, pick the choice most likely to be the TRUTH (real facts are often weirder and more specific than lies).
- Trivia Murder Party / any trivia: the correct answer. Pick the right choice.
- Job Job: you may ONLY use words from the word bank on screen (exact words, may reuse? only if the bank allows). Build a funny, coherent interview answer.
- Tee K.O.: slogans that are funny alone and fit lots of drawings. Champ'd Up: punny champion names that fit the category.
- Survive the Internet: twist the quote into the most damning out-of-context caption.
- Mad Verse City: rhyming bars that roast the opponent and end on the rhyme.
- Joke Boat: twist punchlines. Bracketeering: an answer that beats other answers head to head.
- Talking Points, Blather 'Round, Dictionarium, Patently Stupid, Quixort, Role Models, Weapons Drawn, Nonsensory, Junktopia, Suspectives, Hypnotorious, Roomerang, Quiplash variants and anything else: read the on-screen instructions and play to win.
- Drawful / Drawful Animate: base guesses / lies on any attached drawing; lies should be plausible titles.
- When voting between other players' answers (not Fibbage), pick the one most likely to win with this crowd.

RULES:
- Obey the character limit given for each field. Count carefully.
- Output answers exactly as they should be typed - no surrounding quotes, no explanations, no labels.

Respond with ONLY a JSON object, no markdown:
Text-entry screen:
{"game":"<game + phase>","mode":"write","suggestions":[["field 1 answer","field 2 answer if there are multiple fields"], ...],"tip":"<one short sentence>"}
(one string per input field, in order)
Pick/vote screen (choice buttons, no text field):
{"game":"<game + phase>","mode":"pick","pick":<0-based index>,"backup":<0-based index or null>,"reason":"<one short sentence>"}`;

  function buildUserText(ctx) {
    const L = [];
    L.push('PHONE SCREEN TEXT:\n"""\n' + ctx.screenText + '\n"""');
    if (ctx.fields.length) {
      L.push('\nTEXT INPUT FIELDS (' + ctx.fields.length + '):');
      ctx.fields.forEach((f, i) => L.push(`  ${i + 1}. placeholder="${f.placeholder}" maxlength=${f.maxLength || 'none'} current="${f.value}"`));
    }
    if (ctx.choices.length) {
      L.push('\nCHOICE BUTTONS:');
      ctx.choices.forEach((c, i) => L.push(`  [${i}] ${c}`));
    }
    const mem = settings.memory ? loadMemory() : [];
    if (mem.length) {
      L.push('\nEARLIER THIS GAME (use for callbacks / running jokes, do not repeat answers):');
      mem.slice(-10).forEach((m) => L.push(`  - prompt: ${m.prompt.slice(0, 160)}${m.answer ? ' | player answered: ' + m.answer : ''}`));
    }
    L.push('\nHUMOR LEVEL: ' + SPICE[settings.spice].text);
    if (settings.style) L.push('THE ROOM: ' + settings.style);
    L.push('Give ' + settings.count + ' suggestions, best first, each a different angle.');
    if (ctx.tweak) L.push('\nPLAYER REQUEST FOR THIS BATCH: ' + ctx.tweak);
    return L.join('\n');
  }

  async function askClaude(ctx) {
    if (!settings.apiKey) throw new Error('Add your Anthropic API key in ⚙️ settings.');
    const content = ctx.images.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }));
    content.push({ type: 'text', text: buildUserText(ctx) });

    const res = await postJSON('https://api.anthropic.com/v1/messages', {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2026-10-21',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    }, {
      model: settings.model,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      output_config: { effort: settings.effort },
      fallbacks: 'default',
      messages: [{ role: 'user', content }],
    });

    let data;
    try { data = JSON.parse(res.text); } catch (_) { throw new Error('Bad response (HTTP ' + res.status + ')'); }
    if (res.status === 401) throw new Error('API key rejected. Re-check it in ⚙️.');
    if (res.status === 429) throw new Error('Rate limited / out of credit. Check console.anthropic.com.');
    if (res.status >= 400) throw new Error((data.error && data.error.message) || ('HTTP ' + res.status));
    if (data.stop_reason === 'refusal') throw new Error('The AI passed on this one. Tap 😇 Cleaner or turn the spice down a notch and retry.');

    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return parseResult(text);
  }

  function parseResult(text) {
    const s = text.indexOf('{');
    const e = text.lastIndexOf('}');
    if (s === -1 || e === -1) throw new Error('Could not read the AI response. Tap Go to retry.');
    const obj = JSON.parse(text.slice(s, e + 1));
    if (Array.isArray(obj.suggestions)) {
      obj.suggestions = obj.suggestions
        .map((x) => (Array.isArray(x) ? x : [x]).map((v) => String(v).replace(/^["“]|["”]$/g, '').trim()))
        .filter((x) => x.some(Boolean));
    }
    return obj;
  }

  // ===========================================================================
  // Reading the Jackbox screen
  // ===========================================================================
  function isVisible(el) {
    if (!el || !el.isConnected || el.closest('#jbai-host')) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  }

  function onJoinScreen() {
    return !!document.querySelector('#roomcode, input[name="roomcode"], input[autocomplete="off"][maxlength="4"]') &&
      /room\s*code/i.test(document.body.innerText || '');
  }

  function getFields() {
    if (onJoinScreen()) return [];
    return [...document.querySelectorAll('textarea, input[type="text"], input:not([type])')]
      .filter((el) => isVisible(el) && !el.disabled && !el.readOnly);
  }

  const SKIP_BTN = /^(submit|send|done|ok|okay|start|everybody'?s in|vip|menu|settings|back|cancel|close|undo|clear|join|play again|same players|new players|skip|censor|✕|x)$/i;
  function getChoiceButtons() {
    return [...document.querySelectorAll('button, [role="button"]')]
      .filter((b) => isVisible(b) && !b.disabled)
      .filter((b) => {
        const t = (b.innerText || '').trim();
        return t && t.length < 300 && !SKIP_BTN.test(t);
      });
  }

  function getCanvasImages() {
    const out = [];
    for (const c of document.querySelectorAll('canvas')) {
      if (out.length >= 2) break;
      if (!isVisible(c) || c.width < 50 || c.height < 50) continue;
      try {
        const url = c.toDataURL('image/png');
        if (url.length > 5000) out.push(url.split(',')[1]);
      } catch (_) { /* tainted canvas */ }
    }
    return out;
  }

  function screenText() {
    return (document.body.innerText || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
  }

  function readContext(tweak) {
    const fields = getFields();
    const choiceEls = fields.length ? [] : getChoiceButtons();
    return {
      screenText: screenText(),
      fields: fields.map((f) => ({
        el: f,
        placeholder: f.placeholder || '',
        maxLength: f.maxLength > 0 ? f.maxLength : null,
        value: f.value || '',
      })),
      choiceEls,
      choices: choiceEls.map((b) => b.innerText.trim().replace(/\s+/g, ' ').slice(0, 200)),
      images: getCanvasImages(),
      tweak,
    };
  }

  // React-controlled inputs need the native value setter + input event
  function fillField(el, value) {
    if (el.maxLength > 0) value = value.slice(0, el.maxLength);
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (_) { /* fall back */ }
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { /* ignore */ }
    ta.remove();
    return ok;
  }

  // ===========================================================================
  // UI (shadow DOM so it never leaks into the screen text we send)
  // ===========================================================================
  const host = document.createElement('div');
  host.id = 'jbai-host';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: -apple-system, system-ui, sans-serif; -webkit-tap-highlight-color: transparent; }
      .fab { position: fixed; z-index: 2147483647; width: 54px; height: 54px; border-radius: 50%; border: 2px solid rgba(255,255,255,.25);
             background: linear-gradient(135deg,#7b5cff,#ff4fa3); color: #fff; font-size: 25px; touch-action: none;
             box-shadow: 0 4px 16px rgba(0,0,0,.4); right: 14px; bottom: 14px; }
      .fab.busy { animation: spin 1s linear infinite; }
      .fab .dot { position: absolute; top: -2px; right: -2px; width: 14px; height: 14px; border-radius: 50%; background: #2ee66b; border: 2px solid #111; display: none; }
      .fab.ready .dot { display: block; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .panel { position: fixed; z-index: 2147483646; left: 8px; right: 8px; bottom: 78px; max-height: 70vh; overflow: auto; -webkit-overflow-scrolling: touch;
               background: #14141b; color: #f2f2f7; border-radius: 16px; padding: 12px; border: 1px solid #2c2c3a;
               box-shadow: 0 10px 40px rgba(0,0,0,.6); display: none; font-size: 15px; }
      .panel.open { display: block; }
      .row { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
      .title { font-weight: 800; flex: 1; font-size: 16px; }
      .muted { color: #9d9db0; font-size: 13px; }
      .err { color: #ff6b6b; }
      .chips { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 6px; margin-bottom: 4px; }
      .chip { flex: 0 0 auto; background: #262634; color: #fff; border: 1px solid #3a3a4c; border-radius: 999px; padding: 7px 11px; font-size: 13px; }
      .chip.on { background: #7b5cff; border-color: #7b5cff; }
      .card { background: #23232f; border: 1px solid #353546; border-radius: 12px; margin: 8px 0; overflow: hidden; }
      .card .use { display: block; width: 100%; text-align: left; background: none; color: #fff; border: none; padding: 11px 12px 6px; font-size: 16px; line-height: 1.3; }
      .card .use:active { background: #7b5cff; }
      .card .f + .f { display: block; margin-top: 5px; padding-top: 5px; border-top: 1px dashed #444; }
      .card .f { display: block; }
      .card .meta { display: flex; gap: 6px; padding: 0 8px 8px 12px; align-items: center; }
      .card .meta .n { flex: 1; color: #7d7d92; font-size: 12px; }
      .card .meta .n.over { color: #ff6b6b; }
      .mini { background: #30303f; color: #ddd; border: none; border-radius: 8px; padding: 5px 9px; font-size: 13px; }
      .pick { font-size: 18px; margin: 8px 0; }
      .btn { background: #30303f; color: #fff; border: none; border-radius: 9px; padding: 8px 11px; font-size: 14px; }
      .btn.primary { background: linear-gradient(135deg,#7b5cff,#ff4fa3); font-weight: 700; }
      input, select { background: #0c0c12; color: #fff; border: 1px solid #3a3a4c; border-radius: 9px; padding: 9px; font-size: 16px; }
      .row input[type=text] { flex: 1; min-width: 0; }
      label { display: block; margin: 10px 0 4px; font-size: 13px; color: #c0c0d2; }
      .settings input[type=text], .settings input[type=password], .settings select { width: 100%; }
      .spice { display: flex; gap: 4px; }
      .spice button { flex: 1; padding: 8px 2px; font-size: 12px; }
      .toast { position: fixed; z-index: 2147483647; left: 50%; bottom: 140px; transform: translateX(-50%); background: #000c; color: #fff;
               padding: 8px 14px; border-radius: 999px; font-size: 14px; display: none; }
    </style>
    <button class="fab" title="Jackbox AI Helper">✨<span class="dot"></span></button>
    <div class="toast"></div>
    <div class="panel">
      <div class="row">
        <span class="title">✨ Jackbox AI</span>
        <span class="muted spiceLabel"></span>
        <button class="btn" data-act="settings">⚙️</button>
        <button class="btn" data-act="close">✕</button>
      </div>
      <div class="main">
        <div class="chips">
          <button class="chip" data-tweak="Way darker and more shocking. Push it further.">🔥 Darker</button>
          <button class="chip" data-tweak="Cleaner - safe for anyone in the room, still funny.">😇 Cleaner</button>
          <button class="chip" data-tweak="Way more absurd and surreal. Weird wins.">🤪 Weirder</button>
          <button class="chip" data-tweak="Much shorter. Two to five words each if possible.">✂️ Shorter</button>
          <button class="chip" data-tweak="Smarter: clever wordplay, puns, double meanings.">🧠 Clever</button>
          <button class="chip" data-tweak="Roast the other players in the room by name (use names from the screen).">🎯 Roast</button>
          <button class="chip" data-act="punch">✍️ Punch up mine</button>
        </div>
        <div class="row">
          <input type="text" class="extra" placeholder="Steer it: 'about Mike', 'reference Shrek'…">
          <button class="btn primary" data-act="go">Go</button>
        </div>
        <div class="out muted">Tap ✨ when a prompt is on screen.</div>
      </div>
      <div class="settings" style="display:none">
        <label>Anthropic API key</label>
        <input type="password" data-k="apiKey" placeholder="sk-ant-..." autocomplete="off">
        <label>Humor level</label>
        <div class="spice">
          <button class="btn" data-spice="1">😇 Family</button>
          <button class="btn" data-spice="2">🙂 Normal</button>
          <button class="btn" data-spice="3">😈 Edgy</button>
          <button class="btn" data-spice="4">💀 Unhinged</button>
        </div>
        <label>Who's in the room / inside jokes</label>
        <input type="text" data-k="style" placeholder="e.g. college roommates; Jake is always late; we love Shrek">
        <label>Model</label>
        <select data-k="model">
          <option value="claude-opus-5-5">Opus 5.5 · funniest</option>
          <option value="claude-sonnet-5-5">Sonnet 5.5 · faster, cheaper</option>
          <option value="claude-haiku-5-5">Haiku 5.5 · fastest, almost free</option>
        </select>
        <label>Speed</label>
        <select data-k="effort">
          <option value="low">Fast (recommended)</option>
          <option value="medium">Balanced</option>
          <option value="high">Thoughtful (slow)</option>
        </select>
        <label>Suggestions per tap</label>
        <select data-k="count">
          <option value="3">3</option><option value="5">5</option><option value="8">8</option>
        </select>
        <label><input type="checkbox" data-k="autoSuggest"> Auto-suggest when a new prompt appears</label>
        <label><input type="checkbox" data-k="memory"> Remember earlier rounds for callbacks</label>
        <div class="row" style="margin-top:12px">
          <button class="btn primary" data-act="save">Save</button>
          <button class="btn" data-act="forget">Forget this game</button>
        </div>
        <div class="muted">Your key is stored only on this phone and only sent to api.anthropic.com. Drag ✨ to move it.</div>
      </div>
    </div>`;

  const $ = (sel) => root.querySelector(sel);
  const fab = $('.fab');
  const panel = $('.panel');
  const out = $('.out');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const setOut = (html) => { out.innerHTML = html; };

  let toastTimer;
  function toast(msg) {
    const t = $('.toast');
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.display = 'none'; }, 1600);
  }

  function refreshSpiceUI(val) {
    root.querySelectorAll('[data-spice]').forEach((b) => b.classList.toggle('primary', +b.dataset.spice === +val));
    $('.spiceLabel').textContent = SPICE[settings.spice].label;
  }

  let pendingSpice = settings.spice;
  function showSettings(show) {
    $('.settings').style.display = show ? 'block' : 'none';
    $('.main').style.display = show ? 'none' : 'block';
    if (show) {
      root.querySelectorAll('[data-k]').forEach((el) => {
        const v = settings[el.dataset.k];
        if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
      });
      pendingSpice = settings.spice;
      refreshSpiceUI(pendingSpice);
    }
  }

  async function saveSettings() {
    for (const el of root.querySelectorAll('[data-k]')) {
      const k = el.dataset.k;
      let v = el.type === 'checkbox' ? el.checked : el.value.trim();
      if (k === 'count') v = parseInt(v, 10) || DEFAULTS.count;
      settings[k] = v;
      await store.set(k, v);
    }
    settings.spice = pendingSpice;
    await store.set('spice', pendingSpice);
    refreshSpiceUI(settings.spice);
    showSettings(false);
    setOut(settings.apiKey ? '<span class="muted">Saved. Tap Go when a prompt is up.</span>' : '<span class="err">Add your API key to start.</span>');
  }

  // ---------------------------------------------------------------------------
  // Running a request
  // ---------------------------------------------------------------------------
  let busy = false;
  let reqId = 0;

  async function run(tweak, quiet) {
    if (busy) return;
    if (!quiet) { panel.classList.add('open'); showSettings(false); }
    if (!settings.apiKey) { if (!quiet) showSettings(true); return; }

    const extra = $('.extra').value.trim();
    const ctx = readContext([extra, tweak].filter(Boolean).join(' '));
    if (!ctx.fields.length && !ctx.choices.length) {
      if (quiet) return;
      setOut('<span class="muted">No prompt, text box or choices on screen yet. Tap ✨ again when one shows up.</span>');
      return;
    }
    busy = true;
    const myId = ++reqId;
    fab.classList.add('busy');
    fab.classList.remove('ready');
    setOut('<span class="muted">Cooking… 🍳</span>');
    const t0 = Date.now();
    try {
      const result = await askClaude(ctx);
      if (myId !== reqId) return;
      render(result, ctx, ((Date.now() - t0) / 1000).toFixed(1));
      if (!panel.classList.contains('open')) fab.classList.add('ready');
    } catch (e) {
      setOut('<span class="err">' + esc(e.message || e) + '</span>');
    } finally {
      busy = false;
      fab.classList.remove('busy');
    }
  }

  function promptSummary(ctx) {
    return ctx.screenText.split('\n').filter((l) => l.trim().length > 3).slice(0, 4).join(' / ');
  }

  function render(result, ctx, secs) {
    let html = `<div class="muted">🎮 ${esc(result.game || 'Jackbox')} · ${secs}s</div>`;

    if (result.mode === 'pick' && Number.isInteger(result.pick) && ctx.choiceEls[result.pick]) {
      html += `<div class="pick">👉 <b>${esc(ctx.choices[result.pick])}</b></div>`;
      if (result.reason) html += `<div class="muted">${esc(result.reason)}</div>`;
      html += `<div class="row" style="margin-top:8px"><button class="btn primary" data-pick="${result.pick}">Tap it for me</button>`;
      if (Number.isInteger(result.backup) && ctx.choiceEls[result.backup] && result.backup !== result.pick) {
        html += `<button class="btn" data-pick="${result.backup}">Backup: ${esc(ctx.choices[result.backup].slice(0, 40))}</button>`;
      }
      html += '</div>';
    } else if (Array.isArray(result.suggestions) && result.suggestions.length) {
      result.suggestions.forEach((s, i) => {
        const max = ctx.fields[0] && ctx.fields[0].maxLength;
        const len = Math.max(...s.map((x) => x.length)); // longest box
        const over = ctx.fields.some((f, idx) => f.maxLength && s[idx] && s[idx].length > f.maxLength);
        html += `<div class="card">
          <button class="use" data-i="${i}">${s.map((f) => `<span class="f">${esc(f)}</span>`).join('')}</button>
          <div class="meta">
            <span class="n ${over ? 'over' : ''}">${s.length > 1 ? 'longest ' : ''}${len}${max ? '/' + max : ''} chars${over ? ' · will be cut' : ''}</span>
            <button class="mini" data-copy="${i}">📋</button>
            <button class="mini" data-more="${i}">🔁 More like this</button>
          </div></div>`;
      });
      html += '<div class="muted">Tap an answer to fill it in, then hit Submit in the game.</div>';
    } else {
      html += '<div class="muted">Nothing usable came back. Tap Go to retry.</div>';
    }
    if (result.tip) html += `<div class="muted" style="margin-top:8px">💡 ${esc(result.tip)}</div>`;
    setOut(html);

    out.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
      const s = result.suggestions[+b.dataset.i];
      let filled = 0;
      ctx.fields.forEach((f, idx) => {
        if (s[idx] !== undefined && f.el.isConnected) { fillField(f.el, s[idx]); filled++; }
      });
      if (!filled) { copyText(s.join('\n')); toast('Box moved - copied instead 📋'); return; }
      remember({ prompt: promptSummary(ctx), answer: s.join(' / ') });
      $('.extra').value = '';
      panel.classList.remove('open');
      toast('Filled ✅ now hit Submit');
    }));
    out.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await copyText(result.suggestions[+b.dataset.copy].join('\n'));
      toast(ok ? 'Copied 📋' : 'Copy failed');
    }));
    out.querySelectorAll('[data-more]').forEach((b) => b.addEventListener('click', () => {
      const s = result.suggestions[+b.dataset.more].join(' / ');
      run(`The player loves this one: "${s}". Give fresh variations in the same spirit, each one funnier.`);
    }));
    out.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.pick;
      const el = ctx.choiceEls[i];
      if (el && el.isConnected) {
        el.click();
        remember({ prompt: promptSummary(ctx), answer: 'voted: ' + ctx.choices[i] });
        toast('Picked ✅');
      } else {
        toast('That button is gone - tap it yourself');
      }
      panel.classList.remove('open');
    }));
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  root.addEventListener('click', (e) => {
    const t = e.target.closest ? e.target.closest('[data-act],[data-tweak],[data-spice]') : null;
    if (!t) return;
    if (t.dataset.tweak) { run(t.dataset.tweak); return; }
    if (t.dataset.spice) { pendingSpice = +t.dataset.spice; refreshSpiceUI(pendingSpice); return; }
    const a = t.dataset.act;
    if (a === 'close') panel.classList.remove('open');
    else if (a === 'settings') showSettings($('.settings').style.display === 'none');
    else if (a === 'save') saveSettings();
    else if (a === 'go') run();
    else if (a === 'forget') { clearMemory(); toast('Game memory cleared'); }
    else if (a === 'punch') {
      const mine = getFields().map((f) => f.value).filter(Boolean).join(' / ');
      if (!mine) { toast('Type your answer in the game first'); return; }
      run(`The player wrote: "${mine}". Punch it up: keep their core idea but make it funnier, tighter, and land harder. Include their version tightened as one option.`);
    }
  });
  $('.extra').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });

  // Draggable FAB (tap = open, drag = move)
  (function dragFab() {
    let sx, sy, ox, oy, moved = false, down = false;
    fab.addEventListener('pointerdown', (e) => {
      down = true; moved = false; sx = e.clientX; sy = e.clientY;
      const r = fab.getBoundingClientRect(); ox = r.left; oy = r.top;
      fab.setPointerCapture(e.pointerId);
    });
    fab.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 8) return;
      moved = true;
      const x = Math.min(window.innerWidth - 58, Math.max(4, ox + dx));
      const y = Math.min(window.innerHeight - 58, Math.max(4, oy + dy));
      Object.assign(fab.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
    });
    fab.addEventListener('pointerup', () => {
      if (!down) return;
      down = false;
      if (moved) {
        const r = fab.getBoundingClientRect();
        store.set('fabX', r.left); store.set('fabY', r.top);
        return;
      }
      if (panel.classList.contains('open') && !busy) { panel.classList.remove('open'); return; }
      const fresh = fab.classList.contains('ready');
      fab.classList.remove('ready');
      if (fresh) { panel.classList.add('open'); return; } // auto-suggest results waiting
      run();
    });
  })();

  // ---------------------------------------------------------------------------
  // Auto-suggest: detect a new prompt and pre-fetch suggestions
  // ---------------------------------------------------------------------------
  let lastSig = '';
  let debounce = null;
  function signature() {
    const f = getFields();
    if (!f.length) return '';
    return f.length + '|' + screenText().slice(0, 500);
  }
  const observer = new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const sig = signature();
      if (!sig) { lastSig = ''; return; }
      if (sig === lastSig) return;
      const isNew = lastSig === '' || sig.split('|')[1].slice(0, 120) !== lastSig.split('|')[1].slice(0, 120);
      lastSig = sig;
      if (!isNew) return;
      if (settings.autoSuggest && settings.apiKey) {
        $('.extra').value = '';
        run('', !panel.classList.contains('open'));
      }
    }, 800);
  });

  // ===========================================================================
  // Boot
  // ===========================================================================
  loadSettings().then(() => {
    settings.spice = Math.min(4, Math.max(1, +settings.spice || DEFAULTS.spice));
    settings.count = +settings.count || DEFAULTS.count;
    pendingSpice = settings.spice;
    refreshSpiceUI(settings.spice);
    if (settings.fabX !== null && settings.fabY !== null) {
      const x = Math.min(window.innerWidth - 58, Math.max(4, settings.fabX));
      const y = Math.min(window.innerHeight - 58, Math.max(4, settings.fabY));
      Object.assign(fab.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
    }
    document.documentElement.appendChild(host);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
})();
