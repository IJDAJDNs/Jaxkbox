// ==UserScript==
// @name         Jackbox AI Helper
// @namespace    jaxkbox
// @version      3.0.0
// @description  AI sidekick for every jackbox.tv game: writes answers, DRAWS pictures on the canvas, bids, votes, answers trivia, sets sliders. Humor dial up to unhinged. Autopilot mode.
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
    autoMode: 'off', // off | prompts | all
    autopilot: false, // auto-use the best option
    autoSubmit: false, // ...and press Submit
    memory: true,
    drawSpeed: 'fast', // fast | natural
    fabX: null,
    fabY: null,
  };

  const SPICE = {
    1: { label: '😇 Family', text: 'FAMILY FRIENDLY. No swearing, no innuendo, nothing gross. Clever, silly and wholesome - kids could be playing.' },
    2: { label: '🙂 Normal', text: 'PG-13. Mild swearing and light innuendo are fine. Cheeky, not crude.' },
    3: { label: '😈 Edgy', text: 'R-RATED. Swearing, sex jokes, gross-out, dark and morbid jokes are all fine. Be bold - the room is adults.' },
    4: { label: '💀 Unhinged', text: 'UNHINGED / NO FILTER. Adults-only room that explicitly wants the darkest, most shocking, most inappropriate jokes possible: death, sex, drugs, bodily fluids, existential dread, crime, disasters, terrible life choices, brutal roasts of the players by name. Make people gasp, then laugh. Do NOT soften, hedge or sanitize. Only limit: no slurs and no jokes whose entire punchline is "this race/religion/sexuality/disability is bad" - those get groans, not votes.' },
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
    if ((await store.get('autoSuggest')) === true && settings.autoMode === 'off') settings.autoMode = 'prompts'; // v2 migration
    settings.spice = Math.min(4, Math.max(1, +settings.spice || DEFAULTS.spice));
    settings.count = +settings.count || DEFAULTS.count;
  }

  // Game memory (this tab only) for callbacks
  const MEM_KEY = 'jbai_memory';
  const loadMemory = () => { try { return JSON.parse(sessionStorage.getItem(MEM_KEY)) || []; } catch (_) { return []; } };
  function remember(entry) {
    if (!settings.memory) return;
    const m = loadMemory();
    m.push(entry);
    try { sessionStorage.setItem(MEM_KEY, JSON.stringify(m.slice(-20))); } catch (_) { /* ignore */ }
  }
  const clearMemory = () => { try { sessionStorage.removeItem(MEM_KEY); } catch (_) { /* ignore */ } };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

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
        ontimeout: () => reject(new Error('Timed out. Try Sonnet/Haiku or Thinking = Fast.')),
      });
      if (r && typeof r.then === 'function') r.catch(reject);
    });
  }

  async function postJSON(url, headers, body) {
    const payload = JSON.stringify(body);
    const viaGM = gmRequest({ method: 'POST', url, headers, data: payload, timeout: 120000 });
    if (viaGM) return viaGM;
    const res = await fetch(url, { method: 'POST', headers, body: payload });
    return { status: res.status, text: await res.text() };
  }

  // ===========================================================================
  // Prompt
  // ===========================================================================
  const SYSTEM_PROMPT = `You are the best Jackbox Party Pack player alive, controlling one player's phone (jackbox.tv). Your goal: win - votes, points, money, survival.

You get: the phone's visible text, a numbered list of interactive ELEMENTS on screen (text boxes, buttons, sliders, dropdowns, color swatches, drawing canvases), sometimes images of what's on screen, and notes about earlier rounds. Work out the game and phase, then return ranked OPTIONS the player can tap; each option is a list of ACTIONS the phone will perform.

ACTIONS (reference elements by their [index]):
- {"do":"type","el":i,"text":"..."}            fill a text box (respect maxlength!)
- {"do":"set","el":i,"value":42}               set a slider / number box / dropdown (value within min-max; for dropdowns use the option value)
- {"do":"click","el":i}                        tap a button / choice / swatch
- {"do":"draw","el":i,"shapes":[...]}          draw on a canvas
Do NOT include the final Submit/Send/Done tap in actions - put that button's index in "submit" instead.

DRAWING: coordinates use the canvas's own space given in the element list (x 0-1000, y 0-H). Shapes, drawn in order:
  {"line":[x1,y1,x2,y2,x3,y3,...]}   freehand polyline (use many points for curves)
  {"poly":[x1,y1,...],"fill":true}   closed polygon
  {"circle":[cx,cy,r],"fill":true}  {"ellipse":[cx,cy,rx,ry],"fill":true}  {"rect":[x,y,w,h],"fill":true}
Any shape may have "color": <index of a color swatch element> (tapped before that shape) and "brush": <index of a brush-size element>. The selected color STAYS selected for later shapes until you set another, so set "color" whenever it changes (and on the first shape). "fill" scribble-fills the shape.
Drawing craft: draw BIG and centered, filling ~80% of the canvas. Bold, simple, instantly recognizable doodle. Big color fills first, then outlines and details on top, then the funny detail that sells the joke. Use 15-60 shapes. Faces: eyes + expressive mouth. No written words in pictures (in Drawful words are lame) unless the game asks for text.

GAME PLAYBOOK:
- Quiplash / Thriplash / Word Lash / Comic Lash: killer short punchline; Thriplash = 3 lines that escalate.
- Fibbage / Enough About You: write a believable LIE matching the real answer's length & style. When voting, pick the most likely TRUTH (real answers are weirder and more specific). Likes: like the funniest.
- Trivia Murder Party 1/2 + all its death minigames: correct answers; in minigames follow the on-screen rules to survive (math, dictionary, chalices, etc. - reason carefully).
- Bidiots: draw the prompt clearly when drawing; when bidding, estimate value from the screen and bid smart (set slider/number; bid button = submit).
- Guesspionage / Timejinx / any number guess: best real-world estimate via set.
- Drawful 1/2/Animate: draw so people can GUESS the prompt. When writing a lie for someone's drawing, make a plausible-sounding title. When picking, choose the most likely real title.
- Tee K.O.: funny striking drawings and slogans; in battles pick the shirt the room will vote for. Champ'd Up: draw a champion that fits the category + punny name.
- Civic Doodle: add to the existing drawing to make it funnier. Patently Stupid: draw the invention, punchy name/tagline.
- Job Job: use ONLY words from your word bank. Survive the Internet: most damning out-of-context twist. Mad Verse City: rhyming roast bars. Joke Boat, Talking Points, Blather 'Round, Dictionarium, Quixort, Role Models, Weapons Drawn, Suspectives, Hypnotorious, Nonsensory, Junktopia, Roomerang, Split the Room, Lie Swatter, Push the Button, Monster Seeking Monster, Earwax and anything else: read the on-screen rules and play to win.
- Voting on others' answers: pick what this crowd will vote for. Lobby / waiting screens: return no options and a short "advice".

COMEDY: first idea = everyone's idea, skip to the 3rd/4th. Specific beats generic (brands, celebs, oddly precise details). Short. Funniest word last. Misdirection, escalation, brutal honesty, callbacks to earlier rounds and players' names. Each option a different angle.

Respond with ONLY JSON, no markdown:
{"game":"<game - phase>","advice":"<one short sentence or empty>","submit":<index of submit button or null>,
 "options":[{"label":"<2-5 word title>","text":"<the answer as shown to the player>","actions":[...]}]}`;

  // ===========================================================================
  // Reading the screen: build an indexed inventory of interactive elements
  // ===========================================================================
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight * 3) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0;
  }

  function onJoinScreen() {
    const t = document.body.innerText || '';
    return /room\s*code/i.test(t) && /\b(play|join)\b/i.test(t) && !!document.querySelector('input');
  }

  function solidColor(el) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)|transparent/.test(bg)) return bg;
    const dc = el.getAttribute('data-color') || el.getAttribute('data-value');
    if (dc && /^#|rgb/.test(dc)) return dc;
    return null;
  }

  const SUBMIT_RE = /^(submit|send|done|confirm|lock ?in|bid|place bid|ok|okay|enter|go|vote|finish|i'?m done|send it)\b/i;
  const clean = (s, n) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, n);

  function canvasSpace(r) {
    return { W: 1000, H: Math.max(1, Math.round(1000 * r.height / r.width)) };
  }

  function inventory() {
    const items = [];
    if (onJoinScreen()) return items;
    const seen = new Set();
    const add = (el, kind, desc, extra) => {
      if (seen.has(el) || items.length >= 90) return;
      seen.add(el);
      items.push({ el, kind, desc, ...extra });
    };
    const nodes = document.querySelectorAll('textarea, input, select, button, [role="button"], [role="radio"], [role="option"], canvas, [data-color], [class*="color" i], [class*="swatch" i], [class*="choice" i], [class*="option" i]');
    for (const el of nodes) {
      if (el.closest('#jbai-host') || !isVisible(el)) continue;
      const tag = el.tagName;
      if (tag === 'TEXTAREA' || (tag === 'INPUT' && /^(text|search|email|)$/i.test(el.type || ''))) {
        if (el.disabled || el.readOnly) continue;
        add(el, 'text', `text box placeholder="${clean(el.placeholder, 80)}" maxlength=${el.maxLength > 0 ? el.maxLength : 'none'} current="${clean(el.value, 120)}"`);
      } else if (tag === 'INPUT' && /^(number|tel|range)$/i.test(el.type)) {
        if (el.disabled) continue;
        add(el, 'number', `${el.type === 'range' ? 'slider' : 'number box'} min=${el.min || '?'} max=${el.max || '?'} step=${el.step || 1} current=${el.value} ${clean(el.getAttribute('aria-label') || el.placeholder, 60)}`);
      } else if (tag === 'INPUT' && /^(radio|checkbox)$/i.test(el.type)) {
        const lbl = el.labels && el.labels[0] ? el.labels[0].innerText : el.value;
        add(el, 'click', `${el.type} "${clean(lbl, 120)}"${el.checked ? ' (checked)' : ''}`);
      } else if (tag === 'SELECT') {
        const opts = [...el.options].slice(0, 30).map((o) => `${o.value}=${clean(o.text, 30)}`).join(', ');
        add(el, 'number', `dropdown current=${el.value} options: ${opts}`);
      } else if (tag === 'CANVAS') {
        const r = el.getBoundingClientRect();
        if (r.width < 120 || r.height < 120) continue;
        const { W, H } = canvasSpace(r);
        add(el, 'canvas', `canvas (drawing area) on screen ${Math.round(r.width)}x${Math.round(r.height)}px - draw coords x 0-${W}, y 0-${H}`);
      } else if (tag !== 'INPUT') {
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
        const img = el.querySelector('img');
        const text = clean(el.innerText || el.getAttribute('aria-label') || el.title || (img && img.alt), 160);
        const r = el.getBoundingClientRect();
        const color = solidColor(el);
        const btnish = tag === 'BUTTON' || el.getAttribute('role') || el.onclick || getComputedStyle(el).cursor === 'pointer';
        if (!text && color && r.width <= 90 && r.height <= 90) {
          add(el, 'swatch', `color swatch ${color}`, { color });
        } else if (text && btnish) {
          add(el, 'click', `button "${text}"`);
        } else if (!text && btnish && r.width <= 90) {
          add(el, 'click', `icon button${el.querySelector('img, svg') ? ' (image)' : ''}${typeof el.className === 'string' && el.className ? ' class=' + clean(el.className, 40) : ''}`);
        }
      }
    }
    // Drop a clickable wrapper whose description equals a clickable child's
    return items.filter((it) => !(it.kind === 'click' && items.some((o) => o !== it && o.kind === 'click' && it.el.contains(o.el) && o.desc === it.desc)));
  }

  function guessSubmit(items) {
    const i = items.findIndex((it) => it.kind === 'click' && SUBMIT_RE.test(it.desc.replace(/^button "/, '')));
    return i === -1 ? null : i;
  }

  // Images: canvases with content (others' drawings, the thing to add to) + inline images
  function toJpegB64(source, w, h) {
    const s = Math.min(1, 512 / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(h * s));
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(source, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8).split(',')[1];
  }

  function canvasHasInk(c) {
    try {
      const s = 48;
      const t = document.createElement('canvas');
      t.width = s; t.height = s;
      const g = t.getContext('2d');
      g.drawImage(c, 0, 0, s, s);
      const d = g.getImageData(0, 0, s, s).data;
      let first = null, diff = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 10) continue;
        const v = d[i] + d[i + 1] * 3 + d[i + 2] * 7;
        if (first === null) first = v; else if (Math.abs(v - first) > 30) diff++;
      }
      return diff > 15;
    } catch (_) { return false; }
  }

  function screenImages() {
    const out = [];
    for (const el of document.querySelectorAll('canvas, img')) {
      if (out.length >= 3) break;
      if (el.closest('#jbai-host') || !isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 80) continue;
      try {
        if (el.tagName === 'CANVAS') {
          if (canvasHasInk(el)) out.push(toJpegB64(el, el.width, el.height));
        } else if (el.complete && el.naturalWidth) {
          out.push(toJpegB64(el, el.naturalWidth, el.naturalHeight));
        }
      } catch (_) { /* cross-origin image - skip */ }
    }
    return out;
  }

  function screenText() {
    return (document.body.innerText || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
  }

  function readContext(tweak) {
    const items = inventory();
    return { screenText: screenText(), items, submitGuess: guessSubmit(items), images: screenImages(), tweak };
  }

  function screenKind(items) {
    const drawCue = items.some((i) => i.kind === 'swatch') || /\b(draw|sketch|doodle|paint|design)/i.test(document.body.innerText || '');
    if (drawCue && items.some((i) => i.kind === 'canvas')) return 'draw';
    if (items.some((i) => i.kind === 'text' || i.kind === 'number')) return 'write';
    if (items.filter((i) => i.kind === 'click').length >= 2) return 'pick';
    return 'none';
  }

  function buildUserText(ctx) {
    const L = [];
    L.push('PHONE SCREEN TEXT:\n"""\n' + ctx.screenText + '\n"""');
    L.push('\nELEMENTS:');
    if (!ctx.items.length) L.push('  (none)');
    ctx.items.forEach((it, i) => L.push(`  [${i}] ${it.desc}`));
    if (ctx.images.length) L.push(`\n(${ctx.images.length} image(s) of what's on screen attached above.)`);
    const mem = settings.memory ? loadMemory() : [];
    if (mem.length) {
      L.push('\nEARLIER THIS GAME (callbacks welcome, never repeat an answer):');
      mem.slice(-10).forEach((m) => L.push(`  - ${clean(m.prompt, 160)} -> player used: ${clean(m.answer, 120)}`));
    }
    L.push('\nHUMOR LEVEL: ' + SPICE[settings.spice].text);
    if (settings.style) L.push('THE ROOM: ' + settings.style);
    const kind = screenKind(ctx.items);
    L.push(kind === 'draw'
      ? 'Give 2 drawing options (different ideas). If there are also text boxes on screen, fill them in the same option.'
      : kind === 'pick' ? 'Give up to 3 options, best first.'
        : `Give ${settings.count} options, best first, each a different angle.`);
    if (ctx.tweak) L.push('\nPLAYER REQUEST FOR THIS BATCH: ' + ctx.tweak);
    return L.join('\n');
  }

  // ===========================================================================
  // Claude call
  // ===========================================================================
  async function askClaude(ctx) {
    if (!settings.apiKey) throw new Error('Add your Anthropic API key in ⚙️ settings.');
    const content = ctx.images.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }));
    content.push({ type: 'text', text: buildUserText(ctx) });

    const headers = {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2026-10-21',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    const body = {
      model: settings.model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      output_config: { effort: settings.effort },
      messages: [{ role: 'user', content }],
    };
    // Server-side refusal fallback exists for Opus/Sonnet, not Haiku
    if (/opus|sonnet/.test(settings.model)) {
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      body.fallbacks = 'default';
    }

    const res = await postJSON('https://api.anthropic.com/v1/messages', headers, body);
    let data;
    try { data = JSON.parse(res.text); } catch (_) { throw new Error('Bad response (HTTP ' + res.status + ')'); }
    if (res.status === 401) throw new Error('API key rejected. Re-check it in ⚙️.');
    if (res.status === 429) throw new Error('Rate limited or out of credit. Check console.anthropic.com.');
    if (res.status >= 500) throw new Error('Anthropic is busy right now. Tap Go to retry.');
    if (res.status >= 400) throw new Error((data.error && data.error.message) || ('HTTP ' + res.status));
    if (data.stop_reason === 'refusal') throw new Error('The AI passed on this one. Tap 😇 Cleaner or drop the humor level a notch.');
    if (data.stop_reason === 'max_tokens') throw new Error('Answer got cut off. Tap Go to retry.');

    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return parseResult(text, ctx);
  }

  function parseResult(text, ctx) {
    const s = text.indexOf('{');
    const e = text.lastIndexOf('}');
    if (s === -1 || e === -1) throw new Error('Could not read the AI response. Tap Go to retry.');
    const obj = JSON.parse(text.slice(s, e + 1));
    const n = ctx.items.length;
    const ok = (i) => Number.isInteger(i) && i >= 0 && i < n;
    obj.options = (Array.isArray(obj.options) ? obj.options : []).map((o) => ({
      label: clean(o.label, 60),
      text: String(o.text || '').trim(),
      actions: (Array.isArray(o.actions) ? o.actions : []).filter((a) => a && ok(a.el)),
    })).filter((o) => o.actions.length);
    obj.submit = ok(obj.submit) ? obj.submit : ctx.submitGuess;
    return obj;
  }

  // ===========================================================================
  // Doing things on the page
  // ===========================================================================
  function setNative(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function typeInto(el, text) {
    if (el.maxLength > 0) text = text.slice(0, el.maxLength);
    el.focus({ preventScroll: true });
    setNative(el, text);
  }

  function setValue(el, value) {
    if (el.tagName === 'INPUT' && el.type !== 'text') {
      let v = Number(value);
      if (Number.isNaN(v)) v = parseFloat(String(value).replace(/[^\d.-]/g, '')) || 0;
      if (el.min !== '' && v < +el.min) v = +el.min;
      if (el.max !== '' && v > +el.max) v = +el.max;
      value = String(v);
    }
    setNative(el, String(value));
  }

  function tap(el) {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1, isPrimary: true, pointerType: 'touch' };
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', o));
      el.dispatchEvent(new PointerEvent('pointerup', o));
    } catch (_) { /* old browser */ }
    el.click();
  }

  // --------------------------- drawing engine -------------------------------
  let cancelDraw = false;
  let drawMethod = null; // remembered once an input method visibly works

  function shapeToStrokes(shape, rect, space) {
    const sx = rect.width / space.W;
    const sy = rect.height / space.H;
    const P = (x, y) => [rect.left + x * sx, rect.top + y * sy];
    const ring = (cx, cy, rx, ry) => {
      const pts = [];
      const n = Math.max(24, Math.round((rx * sx + ry * sy) / 3));
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * Math.PI * 2;
        pts.push(P(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry));
      }
      return pts;
    };
    const pairs = (arr) => {
      const pts = [];
      for (let k = 0; k + 1 < arr.length; k += 2) pts.push(P(+arr[k], +arr[k + 1]));
      return pts;
    };
    let pts = null;
    let closed = true;
    if (Array.isArray(shape.circle)) { const [cx, cy, r] = shape.circle.map(Number); pts = ring(cx, cy, r, r); }
    else if (Array.isArray(shape.ellipse)) { const [cx, cy, rx, ry] = shape.ellipse.map(Number); pts = ring(cx, cy, rx, ry); }
    else if (Array.isArray(shape.rect)) { const [x, y, w, h] = shape.rect.map(Number); pts = [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h), P(x, y)]; }
    else if (Array.isArray(shape.poly)) { pts = pairs(shape.poly); if (pts.length) pts.push(pts[0]); }
    else if (Array.isArray(shape.line)) { pts = pairs(shape.line); closed = false; }
    if (!pts || !pts.length) return [];
    if (pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return [];
    const strokes = [];
    if (shape.fill && closed && pts.length > 2) strokes.push(...hatch(pts));
    strokes.push(pts);
    return strokes;
  }

  // Scribble-fill a polygon with zig-zag scanlines (one continuous stroke per run)
  function hatch(poly) {
    const gap = 3.5;
    let minY = Infinity, maxY = -Infinity;
    for (const [, y] of poly) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const strokes = [];
    let run = [];
    let flip = false;
    for (let y = minY + gap / 2; y < maxY; y += gap) {
      const xs = [];
      for (let k = 0; k < poly.length - 1; k++) {
        const [x1, y1] = poly[k];
        const [x2, y2] = poly[k + 1];
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
      xs.sort((a, b) => a - b);
      if (xs.length === 2) {
        run.push(...(flip ? [[xs[1], y], [xs[0], y]] : [[xs[0], y], [xs[1], y]]));
        flip = !flip;
      } else {
        if (run.length) strokes.push(run);
        run = [];
        for (let k = 0; k + 1 < xs.length; k += 2) strokes.push([[xs[k], y], [xs[k + 1], y]]);
      }
    }
    if (run.length) strokes.push(run);
    return strokes;
  }

  function densify(pts, step) {
    const out = [pts[0]];
    for (let k = 1; k < pts.length; k++) {
      const [x0, y0] = pts[k - 1];
      const [x1, y1] = pts[k];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let j = 1; j <= n; j++) out.push([x0 + ((x1 - x0) * j) / n, y0 + ((y1 - y0) * j) / n]);
    }
    return out;
  }

  function targetAt(x, y, fallback) {
    const prev = host.style.pointerEvents;
    host.style.pointerEvents = 'none';
    const t = document.elementFromPoint(x, y);
    host.style.pointerEvents = prev;
    return t && t !== host ? t : fallback;
  }

  function fire(method, phase, target, x, y) {
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, view: window };
    if (method === 'pointer') {
      const type = { down: 'pointerdown', move: 'pointermove', up: 'pointerup' }[phase];
      target.dispatchEvent(new PointerEvent(type, { ...base, pointerId: 7, pointerType: 'touch', isPrimary: true, pressure: phase === 'up' ? 0 : 0.5, buttons: phase === 'up' ? 0 : 1, button: 0, width: 2, height: 2 }));
    } else if (method === 'touch') {
      const type = { down: 'touchstart', move: 'touchmove', up: 'touchend' }[phase];
      const t = new Touch({ identifier: 7, target, clientX: x, clientY: y, pageX: x + scrollX, pageY: y + scrollY, screenX: x, screenY: y, radiusX: 2, radiusY: 2, force: 0.5 });
      const active = phase === 'up' ? [] : [t];
      target.dispatchEvent(new TouchEvent(type, { ...base, touches: active, targetTouches: active, changedTouches: [t] }));
    } else {
      const type = { down: 'mousedown', move: 'mousemove', up: 'mouseup' }[phase];
      target.dispatchEvent(new MouseEvent(type, { ...base, button: 0, buttons: phase === 'up' ? 0 : 1 }));
    }
  }

  async function strokeWith(method, pts, fallbackTarget) {
    const natural = settings.drawSpeed === 'natural';
    const path = densify(pts, natural ? 3 : 5);
    const target = targetAt(path[0][0], path[0][1], fallbackTarget);
    fire(method, 'down', target, path[0][0], path[0][1]);
    for (let k = 1; k < path.length; k++) {
      fire(method, 'move', target, path[k][0], path[k][1]);
      if (natural ? k % 2 === 0 : k % 25 === 0) await (natural ? sleep(8) : frame());
    }
    const last = path[path.length - 1];
    fire(method, 'up', target, last[0], last[1]);
    await sleep(natural ? 30 : 0);
  }

  function pixelSig() {
    let s = '';
    for (const c of document.querySelectorAll('canvas')) {
      if (c.closest('#jbai-host') || !isVisible(c)) continue;
      try { const d = c.toDataURL(); s += d.length + ':' + d.slice(-64); } catch (_) { s += 'x'; }
    }
    return s;
  }

  async function draw(canvas, shapes, items, onProgress) {
    const rect = canvas.getBoundingClientRect();
    const space = canvasSpace(rect);
    const all = [];
    for (const sh of shapes) {
      shapeToStrokes(sh, rect, space).forEach((s, k) => all.push({ s, color: k === 0 ? sh.color : undefined, brush: k === 0 ? sh.brush : undefined }));
    }
    const methods = ['pointer', 'touch', 'mouse'].filter((m) => m !== 'touch' || typeof Touch === 'function');
    for (let i = 0; i < all.length; i++) {
      if (cancelDraw) return 'cancelled';
      const st = all[i];
      for (const key of ['brush', 'color']) {
        const idx = st[key];
        if (Number.isInteger(idx) && items[idx] && items[idx].el.isConnected) { tap(items[idx].el); await sleep(40); }
      }
      if (!drawMethod) {
        // Find which input method this game listens to, using the first stroke
        let found = null;
        for (const m of methods) {
          const before = pixelSig();
          try { await strokeWith(m, st.s, canvas); } catch (_) { continue; }
          await frame(); await frame(); await sleep(50);
          if (pixelSig() !== before) { found = m; break; }
        }
        drawMethod = found || 'pointer';
        if (!found) toast('Can\'t confirm the canvas is taking it - watch it');
      } else {
        await strokeWith(drawMethod, st.s, canvas);
      }
      onProgress(i + 1, all.length);
    }
    return 'done';
  }

  // --------------------------- run an option --------------------------------
  async function execute(opt, ctx, submit) {
    let drew = false;
    for (const a of opt.actions) {
      const it = ctx.items[a.el];
      if (!it || !it.el.isConnected) throw new Error('The screen changed - tap ✨ again.');
      if (a.do === 'type') typeInto(it.el, String(a.text || ''));
      else if (a.do === 'set') setValue(it.el, a.value);
      else if (a.do === 'click') { tap(it.el); await sleep(120); }
      else if (a.do === 'draw' && it.kind === 'canvas' && Array.isArray(a.shapes)) {
        drew = true;
        cancelDraw = false;
        setDrawing(true);
        try {
          const r = await draw(it.el, a.shapes, ctx.items, (k, n) => { fab.dataset.p = Math.round((k / n) * 100) + '%'; });
          if (r === 'cancelled') { toast('Drawing stopped'); return false; }
        } finally { setDrawing(false); }
      }
      await sleep(30);
    }
    remember({ prompt: promptSummary(ctx), answer: opt.text || opt.label || (drew ? 'a drawing' : '') });
    if (submit && Number.isInteger(ctx.result.submit)) {
      const s = ctx.items[ctx.result.submit];
      if (s && s.el.isConnected) { await sleep(250); tap(s.el); toast('Submitted ✅'); return true; }
    }
    toast(drew ? 'Drawn ✅ check it, then Submit' : 'Done ✅ now hit Submit');
    return true;
  }

  function promptSummary(ctx) {
    return ctx.screenText.split('\n').filter((l) => l.trim().length > 3).slice(0, 4).join(' / ');
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
  // UI (shadow DOM, so it never leaks into the screen we read)
  // ===========================================================================
  const host = document.createElement('div');
  host.id = 'jbai-host';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: -apple-system, system-ui, sans-serif; -webkit-tap-highlight-color: transparent; }
      .fab { position: fixed; z-index: 2147483647; width: 56px; height: 56px; border-radius: 50%; border: 2px solid rgba(255,255,255,.3);
             background: linear-gradient(135deg,#7b5cff,#ff4fa3); color: #fff; font-size: 25px; touch-action: none; right: 14px; bottom: 14px;
             box-shadow: 0 4px 18px rgba(123,92,255,.55); transition: transform .15s; }
      .fab:active { transform: scale(.92); }
      .fab.busy { animation: spin 1s linear infinite; }
      .fab.drawing { animation: none; background: #ff3b5c; font-size: 20px; }
      .fab.drawing::after { content: attr(data-p); position: absolute; bottom: -18px; left: 0; right: 0; text-align: center; font-size: 11px; font-weight: 700; color: #fff; text-shadow: 0 1px 2px #000; }
      .fab .dot { position: absolute; top: -2px; right: -2px; width: 15px; height: 15px; border-radius: 50%; background: #2ee66b; border: 2px solid #111; display: none; }
      .fab.ready .dot { display: block; }
      .fab .pilot { position: absolute; bottom: -4px; left: -4px; font-size: 14px; display: none; }
      .fab.auto .pilot { display: block; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .panel { position: fixed; z-index: 2147483646; left: 8px; right: 8px; bottom: 80px; max-height: 72vh; overflow: auto; -webkit-overflow-scrolling: touch;
               background: rgba(18,18,26,.97); color: #f2f2f7; border-radius: 18px; padding: 12px; border: 1px solid #2c2c3a;
               box-shadow: 0 12px 44px rgba(0,0,0,.65); display: none; font-size: 15px; }
      .panel.open { display: block; animation: up .18s ease-out; }
      @keyframes up { from { transform: translateY(12px); opacity: 0; } }
      .row { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
      .title { font-weight: 800; flex: 1; font-size: 16px; }
      .muted { color: #9d9db0; font-size: 13px; }
      .err { color: #ff6b6b; }
      .chips { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 6px; margin-bottom: 4px; scrollbar-width: none; }
      .chip { flex: 0 0 auto; background: #262634; color: #fff; border: 1px solid #3a3a4c; border-radius: 999px; padding: 7px 11px; font-size: 13px; }
      .card { background: #20202c; border: 1px solid #353546; border-radius: 14px; margin: 8px 0; overflow: hidden; }
      .card.best { border-color: #7b5cff; box-shadow: 0 0 0 1px #7b5cff inset; }
      .card .use { display: block; width: 100%; text-align: left; background: none; color: #fff; border: none; padding: 11px 12px 6px; font-size: 16px; line-height: 1.3; }
      .card .use:active { background: #33305a; }
      .card .lbl { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #a99bff; margin-bottom: 3px; }
      .card .f { display: block; white-space: pre-wrap; }
      .card .f + .f { margin-top: 5px; padding-top: 5px; border-top: 1px dashed #444; }
      .card svg { display: block; width: 100%; max-height: 220px; background: #fff; border-radius: 10px; margin-top: 4px; }
      .card .meta { display: flex; gap: 6px; padding: 2px 8px 9px 12px; align-items: center; flex-wrap: wrap; }
      .card .meta .n { flex: 1; color: #7d7d92; font-size: 12px; }
      .card .meta .n.over { color: #ff6b6b; }
      .mini { background: #30303f; color: #ddd; border: none; border-radius: 8px; padding: 6px 9px; font-size: 13px; }
      .mini.go { background: #2ee66b; color: #052; font-weight: 700; }
      .btn { background: #30303f; color: #fff; border: none; border-radius: 9px; padding: 8px 11px; font-size: 14px; }
      .btn.primary { background: linear-gradient(135deg,#7b5cff,#ff4fa3); font-weight: 700; }
      input, select { background: #0c0c12; color: #fff; border: 1px solid #3a3a4c; border-radius: 9px; padding: 9px; font-size: 16px; }
      .row input[type=text] { flex: 1; min-width: 0; }
      label { display: block; margin: 10px 0 4px; font-size: 13px; color: #c0c0d2; }
      label.ck { display: flex; gap: 8px; align-items: center; font-size: 14px; color: #e0e0ee; }
      .settings input[type=text], .settings input[type=password], .settings select { width: 100%; }
      .seg { display: flex; gap: 4px; }
      .seg button { flex: 1; padding: 8px 2px; font-size: 12px; }
      .advice { background: #2a2540; border-radius: 10px; padding: 8px 10px; margin: 6px 0; font-size: 14px; }
      .toast { position: fixed; z-index: 2147483647; left: 50%; bottom: 150px; transform: translateX(-50%); background: rgba(0,0,0,.85); color: #fff;
               padding: 9px 15px; border-radius: 999px; font-size: 14px; display: none; white-space: nowrap; }
    </style>
    <button class="fab" title="Jackbox AI Helper">✨<span class="dot"></span><span class="pilot">🤖</span></button>
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
          <button class="chip" data-tweak="Much shorter: two to five words if possible. For drawings: simpler, bolder, fewer shapes.">✂️ Simpler</button>
          <button class="chip" data-tweak="Smarter: clever wordplay, puns, double meanings, visual puns.">🧠 Clever</button>
          <button class="chip" data-tweak="Roast the other players in the room by name (use names from the screen).">🎯 Roast</button>
          <button class="chip" data-tweak="For drawings: much more detailed and colorful, 50-80 shapes, more color fills.">🎨 Fancier art</button>
          <button class="chip" data-act="punch">✍️ Punch up mine</button>
        </div>
        <div class="row">
          <input type="text" class="extra" placeholder="Steer it or ask: 'about Mike', 'what do I do?'">
          <button class="btn primary" data-act="go">Go</button>
        </div>
        <div class="out muted">Tap ✨ on any screen: writing, drawing, voting, bidding, trivia.</div>
      </div>
      <div class="settings" style="display:none">
        <label>Anthropic API key</label>
        <input type="password" data-k="apiKey" placeholder="sk-ant-..." autocomplete="off">
        <label>Humor level</label>
        <div class="seg" data-seg="spice">
          <button class="btn" data-v="1">😇 Family</button>
          <button class="btn" data-v="2">🙂 Normal</button>
          <button class="btn" data-v="3">😈 Edgy</button>
          <button class="btn" data-v="4">💀 Unhinged</button>
        </div>
        <label>Who's in the room / inside jokes</label>
        <input type="text" data-k="style" placeholder="e.g. college roommates; Jake is always late; we love Shrek">
        <label>Auto-run when a new screen appears</label>
        <div class="seg" data-seg="autoMode">
          <button class="btn" data-v="off">Off</button>
          <button class="btn" data-v="prompts">Write + draw</button>
          <button class="btn" data-v="all">Everything</button>
        </div>
        <label class="ck"><input type="checkbox" data-k="autopilot"> 🤖 Autopilot: use the best answer automatically</label>
        <label class="ck"><input type="checkbox" data-k="autoSubmit"> …and press Submit for me</label>
        <label>Model</label>
        <select data-k="model">
          <option value="claude-opus-5-5">Opus 5.5 · funniest, best art</option>
          <option value="claude-sonnet-5-5">Sonnet 5.5 · faster, cheaper</option>
          <option value="claude-haiku-5-5">Haiku 5.5 · fastest, almost free</option>
        </select>
        <label>Thinking</label>
        <select data-k="effort">
          <option value="low">Fast (recommended)</option>
          <option value="medium">Balanced</option>
          <option value="high">Deep (slow - fine for drawing rounds)</option>
        </select>
        <label>Drawing speed</label>
        <select data-k="drawSpeed">
          <option value="fast">Fast</option>
          <option value="natural">Natural (looks hand-drawn live)</option>
        </select>
        <label>Answers per tap</label>
        <select data-k="count"><option value="3">3</option><option value="5">5</option><option value="8">8</option></select>
        <label class="ck"><input type="checkbox" data-k="memory"> Remember earlier rounds for callbacks</label>
        <div class="row" style="margin-top:12px">
          <button class="btn primary" data-act="save">Save</button>
          <button class="btn" data-act="forget">Forget this game</button>
        </div>
        <div class="muted">Key is stored only on this phone and only sent to api.anthropic.com. Drag ✨ to move it. Tap ✨ while drawing to stop.</div>
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
    toastTimer = setTimeout(() => { t.style.display = 'none'; }, 1800);
  }

  let drawing = false;
  function setDrawing(on) {
    drawing = on;
    fab.classList.toggle('drawing', on);
    fab.firstChild.nodeValue = on ? '⏹' : '✨';
    fab.dataset.p = '';
    if (on) panel.classList.remove('open');
  }

  // segmented controls
  const pending = {};
  function refreshSeg(name) {
    root.querySelectorAll(`[data-seg="${name}"] [data-v]`).forEach((b) => b.classList.toggle('primary', String(b.dataset.v) === String(pending[name])));
  }
  function refreshBadges() {
    $('.spiceLabel').textContent = SPICE[settings.spice].label;
    fab.classList.toggle('auto', !!settings.autopilot);
  }

  function showSettings(show) {
    $('.settings').style.display = show ? 'block' : 'none';
    $('.main').style.display = show ? 'none' : 'block';
    if (show) {
      root.querySelectorAll('[data-k]').forEach((el) => {
        const v = settings[el.dataset.k];
        if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
      });
      for (const n of ['spice', 'autoMode']) { pending[n] = settings[n]; refreshSeg(n); }
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
    settings.spice = +pending.spice;
    settings.autoMode = pending.autoMode;
    await store.set('spice', settings.spice);
    await store.set('autoMode', settings.autoMode);
    refreshBadges();
    showSettings(false);
    lastSig = '';
    setOut(settings.apiKey ? '<span class="muted">Saved. Tap ✨ on any game screen.</span>' : '<span class="err">Add your API key to start.</span>');
  }

  // ---------------------------------------------------------------------------
  // Running a request
  // ---------------------------------------------------------------------------
  let busy = false;

  async function run(tweak, quiet) {
    if (busy || drawing) return;
    if (!quiet) { panel.classList.add('open'); showSettings(false); }
    if (!settings.apiKey) { if (!quiet) showSettings(true); return; }

    const extra = $('.extra').value.trim();
    const ctx = readContext([extra, tweak].filter(Boolean).join(' '));
    if (!ctx.items.length && !extra) {
      if (!quiet) setOut('<span class="muted">Nothing to do on this screen yet. Tap ✨ when a prompt, drawing pad or choices show up.</span>');
      return;
    }
    busy = true;
    fab.classList.add('busy');
    fab.classList.remove('ready');
    const kind = screenKind(ctx.items);
    setOut(`<span class="muted">${kind === 'draw' ? 'Sketching… 🎨 (drawings take a little longer)' : 'Cooking… 🍳'}</span>`);
    const t0 = Date.now();
    let pilot = null;
    try {
      const result = await askClaude(ctx);
      ctx.result = result;
      render(result, ctx, ((Date.now() - t0) / 1000).toFixed(1));
      if (settings.autopilot && !tweak && result.options.length) pilot = result.options[0];
      else if (quiet && !panel.classList.contains('open')) fab.classList.add('ready');
    } catch (e) {
      setOut('<span class="err">' + esc(e.message || e) + '</span>');
      if (quiet) fab.classList.add('ready');
    } finally {
      busy = false;
      fab.classList.remove('busy');
    }
    if (pilot) {
      panel.classList.remove('open');
      toast('🤖 Autopilot: ' + (pilot.label || 'going'));
      try { await execute(pilot, ctx, !!settings.autoSubmit); } catch (e) { toast(e.message); }
    }
  }

  function previewSVG(shapes, ctx, canvasIdx) {
    const space = canvasSpace(ctx.items[canvasIdx].el.getBoundingClientRect());
    let cur = '#111';
    const colorOf = (i) => { if (Number.isInteger(i) && ctx.items[i] && ctx.items[i].color) cur = ctx.items[i].color; return cur; };
    const num = (v) => (Number.isFinite(+v) ? +v : 0);
    const parts = shapes.map((s) => {
      const c = esc(colorOf(s.color));
      const st = `stroke="${c}" stroke-width="${space.W / 120}" stroke-linecap="round" stroke-linejoin="round"`;
      const fill = s.fill ? c : 'none';
      if (Array.isArray(s.circle)) return `<circle cx="${num(s.circle[0])}" cy="${num(s.circle[1])}" r="${num(s.circle[2])}" ${st} fill="${fill}"/>`;
      if (Array.isArray(s.ellipse)) return `<ellipse cx="${num(s.ellipse[0])}" cy="${num(s.ellipse[1])}" rx="${num(s.ellipse[2])}" ry="${num(s.ellipse[3])}" ${st} fill="${fill}"/>`;
      if (Array.isArray(s.rect)) return `<rect x="${num(s.rect[0])}" y="${num(s.rect[1])}" width="${num(s.rect[2])}" height="${num(s.rect[3])}" ${st} fill="${fill}"/>`;
      const arr = s.poly || s.line;
      if (!Array.isArray(arr)) return '';
      const pts = [];
      for (let k = 0; k + 1 < arr.length; k += 2) pts.push(num(arr[k]) + ',' + num(arr[k + 1]));
      return s.poly ? `<polygon points="${pts.join(' ')}" ${st} fill="${fill}"/>` : `<polyline points="${pts.join(' ')}" ${st} fill="none"/>`;
    }).join('');
    return `<svg viewBox="0 0 ${space.W} ${space.H}" preserveAspectRatio="xMidYMid meet">${parts}</svg>`;
  }

  const typedOf = (o) => o.actions.filter((a) => a.do === 'type').map((a) => String(a.text || ''));

  function render(result, ctx, secs) {
    let html = `<div class="muted">🎮 ${esc(result.game || 'Jackbox')} · ${secs}s</div>`;
    if (result.advice) html += `<div class="advice">💡 ${esc(result.advice)}</div>`;
    const hasSubmit = Number.isInteger(result.submit);
    result.options.forEach((o, i) => {
      const drawAct = o.actions.find((a) => a.do === 'draw' && Array.isArray(a.shapes) && ctx.items[a.el].kind === 'canvas');
      const typed = o.actions.filter((a) => a.do === 'type').map((a) => ({ t: String(a.text || ''), max: ctx.items[a.el].el.maxLength }));
      let body = '';
      if (o.label) body += `<span class="lbl">${esc(o.label)}</span>`;
      if (typed.length) body += typed.map((x) => `<span class="f">${esc(x.t)}</span>`).join('');
      else if (o.text) body += `<span class="f">${esc(o.text)}</span>`;
      if (drawAct) body += previewSVG(drawAct.shapes, ctx, drawAct.el);
      const over = typed.some((x) => x.max > 0 && x.t.length > x.max);
      const longest = typed.length ? Math.max(...typed.map((x) => x.t.length)) : 0;
      const maxes = typed.map((x) => x.max).filter((m) => m > 0);
      const count = typed.length
        ? `${typed.length > 1 ? 'longest ' : ''}${longest}${maxes.length ? '/' + Math.min(...maxes) : ''} chars${over ? ' · will be cut' : ''}`
        : (drawAct ? `${drawAct.shapes.length} shapes` : '');
      html += `<div class="card${i === 0 ? ' best' : ''}">
        <button class="use" data-i="${i}">${body}</button>
        <div class="meta">
          <span class="n ${over ? 'over' : ''}">${count}</span>
          ${hasSubmit ? `<button class="mini go" data-sub="${i}">${drawAct ? 'Draw' : 'Use'} + Submit</button>` : ''}
          ${typed.length || o.text ? `<button class="mini" data-copy="${i}">📋</button>` : ''}
          <button class="mini" data-more="${i}">🔁</button>
        </div></div>`;
    });
    if (!result.options.length && !result.advice) html += '<div class="muted">Nothing to do here. Tap ✨ on the next screen.</div>';
    else if (result.options.length) html += '<div class="muted">Tap a card to use it (drawings draw themselves). 🔁 = more like this.</div>';
    setOut(html);

    const go = async (i, submit) => {
      panel.classList.remove('open');
      const o = result.options[i];
      try { await execute(o, ctx, submit); } catch (e) {
        const t = typedOf(o).join('\n') || o.text;
        if (t) { copyText(t); toast('Screen moved - copied instead 📋'); } else toast(e.message);
      }
    };
    out.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => go(+b.dataset.i, false)));
    out.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => go(+b.dataset.sub, true)));
    out.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
      const o = result.options[+b.dataset.copy];
      toast((await copyText(typedOf(o).join('\n') || o.text)) ? 'Copied 📋' : 'Copy failed');
    }));
    out.querySelectorAll('[data-more]').forEach((b) => b.addEventListener('click', () => {
      const o = result.options[+b.dataset.more];
      run(`The player loves this option: "${o.label} - ${typedOf(o).join(' / ') || o.text}". Give fresh variations in the same spirit, each one better.`);
    }));
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  root.addEventListener('click', (e) => {
    const t = e.target.closest ? e.target.closest('[data-act],[data-tweak],[data-v]') : null;
    if (!t) return;
    if (t.dataset.tweak) { run(t.dataset.tweak); return; }
    if (t.dataset.v !== undefined) {
      const seg = t.closest('[data-seg]').dataset.seg;
      pending[seg] = t.dataset.v;
      refreshSeg(seg);
      return;
    }
    const a = t.dataset.act;
    if (a === 'close') panel.classList.remove('open');
    else if (a === 'settings') showSettings($('.settings').style.display === 'none');
    else if (a === 'save') saveSettings();
    else if (a === 'go') run();
    else if (a === 'forget') { clearMemory(); toast('Game memory cleared'); }
    else if (a === 'punch') {
      const mine = inventory().filter((i) => i.kind === 'text').map((i) => i.el.value).filter(Boolean).join(' / ');
      if (!mine) { toast('Type your answer in the game first'); return; }
      run(`The player wrote: "${mine}". Punch it up: keep their core idea but make it funnier, tighter, and land harder. Include their version tightened as one option.`);
    }
  });
  $('.extra').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });

  // Draggable FAB: tap = open/run, drag = move, tap while drawing = stop
  (function dragFab() {
    let sx, sy, ox, oy, moved = false, down = false;
    fab.addEventListener('pointerdown', (e) => {
      down = true; moved = false; sx = e.clientX; sy = e.clientY;
      const r = fab.getBoundingClientRect(); ox = r.left; oy = r.top;
      try { fab.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    });
    fab.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 8) return;
      moved = true;
      const x = Math.min(innerWidth - 60, Math.max(4, ox + dx));
      const y = Math.min(innerHeight - 60, Math.max(4, oy + dy));
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
      if (drawing) { cancelDraw = true; return; }
      if (panel.classList.contains('open') && !busy) { panel.classList.remove('open'); return; }
      const fresh = fab.classList.contains('ready');
      fab.classList.remove('ready');
      if (fresh || busy) { panel.classList.add('open'); showSettings(false); return; }
      run();
    });
  })();

  // ---------------------------------------------------------------------------
  // Auto mode: run when a new actionable screen appears
  // ---------------------------------------------------------------------------
  let lastSig = '';
  let debounce = null;
  function signature() {
    const items = inventory();
    const kind = screenKind(items);
    if (kind === 'none') return '';
    if (settings.autoMode === 'prompts' && kind === 'pick') return '';
    // Already answered / already drawing on this screen -> leave it alone
    if (items.some((i) => i.kind === 'text' && i.el.value.trim())) return 'answered';
    if (kind === 'draw' && items.some((i) => i.kind === 'canvas' && canvasHasInk(i.el))) return 'answered';
    // Ignore countdown timers / scores: strip digits; ignore current values
    const shape = items.map((i) => i.kind + ':' + i.desc.replace(/current=("[^"]*"|\S+)/g, '')).join('|');
    return kind + '|' + screenText().replace(/\d+/g, '#').slice(0, 300) + '|' + shape;
  }
  let pendingSince = 0;
  const observer = new MutationObserver(() => {
    if (settings.autoMode === 'off' || busy || drawing) return;
    // Settle for 900ms, but never wait more than 2s (ticking timers keep mutating the page)
    const now = Date.now();
    if (!pendingSince) pendingSince = now;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      pendingSince = 0;
      if (busy || drawing) return;
      const sig = signature();
      if (!sig) { lastSig = ''; return; }
      if (sig === 'answered' || sig === lastSig) return;
      lastSig = sig;
      $('.extra').value = '';
      run('', !panel.classList.contains('open'));
    }, Math.max(0, Math.min(900, pendingSince + 2000 - now)));
  });

  // ===========================================================================
  // Boot
  // ===========================================================================
  loadSettings().then(() => {
    refreshBadges();
    if (settings.fabX !== null && settings.fabY !== null) {
      const x = Math.min(innerWidth - 60, Math.max(4, settings.fabX));
      const y = Math.min(innerHeight - 60, Math.max(4, settings.fabY));
      Object.assign(fab.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
    }
    document.documentElement.appendChild(host);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
})();
