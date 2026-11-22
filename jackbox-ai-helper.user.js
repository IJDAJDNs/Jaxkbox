// ==UserScript==
// @name         Jackbox AI Helper
// @namespace    jaxkbox
// @version      11.0.0
// @description  Free AI sidekick for every jackbox.tv game: auto-detects the exact game from the phone's connection, writes, DRAWS, bids, votes, finds trivia/Fibbage truths with web search, hunts impostors with a case file. Free AI built in, or Gemini/Groq/OpenRouter/Claude.
// @match        https://jackbox.tv/*
// @match        https://*.jackbox.tv/*
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @connect      api.anthropic.com
// @connect      generativelanguage.googleapis.com
// @connect      api.groq.com
// @connect      openrouter.ai
// @connect      text.pollinations.ai
// @connect      ecast.jackboxgames.com
// @run-at       document-start
// @noframes
// @updateURL    https://raw.githubusercontent.com/IJDAJDNs/Jaxkbox/claude/keen-dirac-mt2d7f/jackbox-ai-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/IJDAJDNs/Jaxkbox/claude/keen-dirac-mt2d7f/jackbox-ai-helper.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (window.__jbaiLoaded) return;
  window.__jbaiLoaded = true;

  // ===========================================================================
  // Phone connection tap: reads only what Jackbox already sends to THIS phone
  // (prompts, choices, player names, game id). Server-side secrets never reach
  // the phone, so they can't be read here.
  // ===========================================================================
  const entities = new Map(); // key -> { val, t }
  let roomCode = null;
  let appTag = null;
  let wsSeen = false;
  // ---- efficiency: reuse expensive page reads until the page actually changes ----
  let domVersion = 0; // bumped by the MutationObserver
  let entVersion = 0; // bumped when new game data arrives
  const memo = {};
  const memoOk = (m, v) => !!m && (Date.now() - m.t < 600 || (m.v === v && Date.now() - m.t < 800));
  function cached(name, version, compute) {
    const m = memo[name];
    if (memoOk(m, version)) return m.r;
    const r = compute();
    memo[name] = { v: version, t: Date.now(), r };
    return r;
  }
  let wsHudTimer = null; // re-pin X-ray labels shortly after new game data arrives
  (function tapSocket() {
    const hook = `(() => { if (window.__jbaiWS) return; window.__jbaiWS = 1; const W = window.WebSocket; if (!W) return;
      const out = (type, data) => { try { document.dispatchEvent(new CustomEvent('jbai-ws', { detail: JSON.stringify({ type, data }) })); } catch (e) {} };
      function P(url, protos) { const ws = protos === undefined ? new W(url) : new W(url, protos); out('open', String(url));
        ws.addEventListener('message', (e) => { if (typeof e.data === 'string' && e.data.length < 300000) out('msg', e.data); }); return ws; }
      P.prototype = W.prototype; try { Object.setPrototypeOf(P, W); } catch (e) {}
      ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((k) => { try { Object.defineProperty(P, k, { value: W[k] }); } catch (e) {} });
      window.WebSocket = P; })();`;
    // 1) If this userscript already runs in the page's world, hook directly.
    try { new Function(hook)(); } catch (_) { /* CSP may forbid eval */ }
    // 2) From an isolated userscript world, inject into the page (as soon as <html> exists).
    const inject = () => {
      try {
        const sc = document.createElement('script');
        sc.textContent = hook;
        (document.head || document.documentElement).appendChild(sc);
        sc.remove();
      } catch (_) { /* CSP may block this - screen reading still works */ }
    };
    if (document.documentElement) inject();
    else {
      const mo = new MutationObserver(() => { if (document.documentElement) { mo.disconnect(); inject(); } });
      mo.observe(document, { childList: true });
    }
    document.addEventListener('jbai-ws', (e) => {
      try {
        const m = JSON.parse(e.detail);
        wsSeen = true;
        if (m.type === 'open') {
          const r = String(m.data).match(/rooms\/([A-Z]{4})\b/i);
          if (r && r[1].toUpperCase() !== roomCode) { roomCode = r[1].toUpperCase(); appTag = null; entities.clear(); lookupRoom(); }
          return;
        }
        onWsMessage(m.data);
        clearTimeout(wsHudTimer);
        wsHudTimer = setTimeout(() => { if (document.hidden) return; try { dataHud(); const g = detectGame(screenText()); if (g && g.id === 'bidiots') { captureBidTips(screenText()); bidHud(); } } catch (_) { /* ignore */ } }, 300);
      } catch (_) { /* never let a stray message break anything */ }
    });
  })();

  function compactJSON(v, depth) {
    if (depth > 6) return '…';
    if (typeof v === 'string') return v.length > 300 ? (/^data:|^[A-Za-z0-9+/=]{200,}$/.test(v) ? '[image]' : v.slice(0, 300) + '…') : v;
    if (Array.isArray(v)) return v.slice(0, 30).map((x) => compactJSON(x, depth + 1));
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v).slice(0, 60)) o[k] = compactJSON(x, depth + 1);
      return o;
    }
    return v;
  }

  function onWsMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }
    const tag = String(raw).match(/"appTag"\s*:\s*"([^"]+)"/);
    if (tag && tag[1] !== appTag) { appTag = tag[1]; lockedGame = null; }
    const put = (key, val) => {
      if (typeof val === 'string') { try { val = JSON.parse(val); } catch (_) { /* keep string */ } }
      entities.set(String(key), { val: compactJSON(val, 0), t: Date.now() });
      entVersion++;
      if (entities.size > 40) entities.delete(entities.keys().next().value);
    };
    const r = msg.result || msg.params || msg.body;
    if (r && r.entities && typeof r.entities === 'object') {
      for (const [k, v] of Object.entries(r.entities)) put(k, Array.isArray(v) ? v[v.length - 1] && v[v.length - 1].val !== undefined ? v[v.length - 1].val : v : (v && v.val !== undefined ? v.val : v));
    }
    if (r && r.key !== undefined && (r.val !== undefined || r.value !== undefined)) put(r.key, r.val !== undefined ? r.val : r.value);
    else if (msg.opcode && r && !r.entities) put(msg.opcode, r);
  }

  async function lookupRoom() {
    if (!roomCode) return;
    try {
      const res = await http('GET', 'https://ecast.jackboxgames.com/api/v2/rooms/' + roomCode, {});
      const b = res.json && (res.json.body || res.json);
      if (b && b.appTag) { appTag = b.appTag; lockedGame = null; }
    } catch (_) { /* fine - screen detection still works */ }
  }

  // X-ray: every value the game sent to THIS phone that looks like a hidden number/answer/role
  const SECRET_KEY_RE = /^(price|prices|value|values|worth|cost|bid|minbid|maxbid|highbid|money|cash|amount|correct|iscorrect|correctanswer|answer|truth|istruth|real|isreal|secret|role|isimpostor|impostor|isalien|alien|faker|isfaker|liar|isliar|points|score|winner|rank|percent|percentage|year|multiplier|bonus)$/i;
  const LABEL_KEYS = ['text', 'name', 'title', 'label', 'choice', 'caption', 'word', 'prompt', 'artist'];
  function xrayScan() { return cached('xray', entVersion, xrayScanRaw); }
  function xrayScanRaw() {
    const fields = []; const pairs = []; let nodes = 0;
    const walk = (v, path, depth) => {
      if (nodes++ > 1500 || depth > 7 || v === null || typeof v !== 'object') return;
      if (!Array.isArray(v)) {
        const keys = Object.keys(v);
        const labelKey = LABEL_KEYS.find((k) => typeof v[k] === 'string' && v[k].trim().length >= 2 && v[k].length <= 120);
        for (const k of keys) {
          const val = v[k]; const kk = k.replace(/[^a-z]/gi, '');
          if (SECRET_KEY_RE.test(kk) && (typeof val === 'number' || typeof val === 'boolean' || (typeof val === 'string' && val.length <= 80))) {
            fields.push({ path: path + '.' + k, key: k, value: val });
            if (labelKey && k !== labelKey) pairs.push({ label: v[labelKey], key: k, value: val });
          }
        }
        for (const k of keys) walk(v[k], path + '.' + k, depth + 1);
      } else v.slice(0, 60).forEach((x, i) => walk(x, path + '[' + i + ']', depth + 1));
    };
    for (const [k, e] of entities.entries()) walk(e.val, k, 0);
    return { fields: fields.slice(0, 80), pairs: pairs.slice(0, 60) };
  }

  // ===========================================================================
  // Bidiots price engine: logs every tip shown on THIS phone and prices paintings with the real rules
  // ===========================================================================
  const BID = { HIGH: [3000, 5000], LOW: [500, 2500], PRIOR: 2750, PRIOR_MAX: 2200, START: 3000, LOAN: 1000, INTEREST: 500 };
  const TIP_RE = /\b(worth|valued?|valuable|appraised|sells? for|price[ds]?|expensive|cheap|worthless|priceless|masterpiece|junk|insider|psst|rumou?r|tip|heard|secret)\b/i;
  const BIDUI_RE = /\b(current bid|high(est)? bid|your (money|cash|balance|bid)|you have|place (a )?bid|bid now|going once|going twice|sold to|\+\s?\$|time left|waiting)\b/i;
  const BIDTIP_KEY = 'jbai_bidtips';
  const loadBidTips = () => { try { return JSON.parse(sessionStorage.getItem(BIDTIP_KEY)) || []; } catch (_) { return []; } };
  const normTitle = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  function captureBidTips(screenTxt) {
    const cands = String(screenTxt || '').split(/\n+/).map((x) => x.trim());
    // strings inside the game data too (tips may arrive there)
    const walk = (v, d) => { if (d > 6 || v == null) return; if (typeof v === 'string') { if (v.length >= 12 && v.length <= 240) cands.push(v); return; } if (typeof v === 'object') Object.values(v).slice(0, 80).forEach((x) => walk(x, d + 1)); };
    for (const [, e] of entities.entries()) walk(e.val, 0);
    const tips = loadBidTips(); let added = false;
    for (const c of cands) {
      if (c.length < 12 || c.length > 240 || !TIP_RE.test(c) || BIDUI_RE.test(c)) continue;
      if (!/\$\s?[\d,]{3,}|valuable|worthless|priceless|expensive|cheap|masterpiece|junk|high[- ]value|low[- ]value|most|least/i.test(c)) continue;
      if (tips.some((t) => t.text === c)) continue;
      tips.push({ text: c, t: Date.now() }); added = true;
    }
    if (added) try { sessionStorage.setItem(BIDTIP_KEY, JSON.stringify(tips.slice(-40))); } catch (_) { /* ignore */ }
  }
  // turn tip sentences into facts: { title, exact | min | max | tier }
  function parseBidTips() {
    let raw = ''; try { raw = sessionStorage.getItem(BIDTIP_KEY) || ''; } catch (_) { /* ignore */ }
    return cached('bidtips', raw, parseBidTipsRaw);
  }
  function parseBidTipsRaw() {
    const facts = {};
    for (const { text } of loadBidTips()) {
      let title = null;
      const q = text.match(/["“”‘’']([^"“”‘’']{3,80})["“”‘’']/);
      if (q) title = q[1];
      else { const m = text.match(/(?:painting|drawing|picture|piece|artwork|art)\s+(?:of|called|titled|named)\s+(.{3,70}?)(?:\s+(?:is|will|could|should|might|by)\b|[,.!]|$)/i); if (m) title = m[1]; }
      if (!title) continue;
      const key = normTitle(title); if (!key) continue;
      const f = facts[key] || (facts[key] = { title: title.trim(), tips: [] });
      f.tips.push(text);
      const amts = [...text.matchAll(/\$\s?([\d,]{3,})/g)].map((m) => +m[1].replace(/,/g, '')).filter((n) => n > 0);
      const lt = /\b(less than|under|below|at most|no more than|max(imum)?)\b/i.test(text);
      const gt = /\b(more than|over|above|at least|no less than|min(imum)?)\b/i.test(text);
      if (amts.length >= 2 && /\bbetween\b|\bto\b|-/i.test(text)) { f.min = Math.max(f.min || 0, Math.min(...amts)); f.max = Math.min(f.max || 1e9, Math.max(...amts)); }
      else if (amts.length === 1 && lt) f.max = Math.min(f.max || 1e9, amts[0]);
      else if (amts.length === 1 && gt) f.min = Math.max(f.min || 0, amts[0]);
      else if (amts.length === 1) f.exact = amts[0];
      if (/most valuable|worth the most|high[- ]value|priceless|masterpiece|big money|expensive/i.test(text)) f.tier = 'high';
      if (/least valuable|worth the least|low[- ]value|worthless|cheap|junk/i.test(text)) f.tier = 'low';
    }
    return facts;
  }
  // value + max bid for one painting
  function priceFact(f, cash) {
    let lo, hi, ev, src;
    if (f && f.exact) { lo = hi = ev = f.exact; src = 'your tip'; }
    else {
      lo = f && f.tier === 'high' ? BID.HIGH[0] : f && f.tier === 'low' ? BID.LOW[0] : BID.LOW[0];
      hi = f && f.tier === 'high' ? BID.HIGH[1] : f && f.tier === 'low' ? BID.LOW[1] : BID.HIGH[1];
      if (f && f.min) lo = Math.max(lo, f.min);
      if (f && f.max) hi = Math.min(hi, f.max);
      if (hi < lo) hi = lo;
      ev = f && (f.tier || f.min || f.max) ? (lo + hi) / 2 : BID.PRIOR;
      src = f && f.tier ? `tip: ${f.tier}-value` : f && (f.min || f.max) ? 'tip: range' : 'no tip, game averages';
    }
    // exact: anything under worth is profit; range: stay at the safe low end; unknown: below the average
    let maxBid = f && f.exact ? f.exact - 100 : f && (f.tier || f.min || f.max) ? Math.max(lo - 100, Math.min(ev * 0.85, hi - 100)) : BID.PRIOR_MAX;
    maxBid = Math.max(0, Math.floor(maxBid / 100) * 100);
    let loanTip = '';
    if (cash != null && maxBid > cash) {
      let bestCap = cash, bestN = 0;
      if (f && f.exact) { // a loan is only worth it if the painting still profits after $500 interest per loan
        for (let n = 1; n <= 3; n++) {
          const cap = Math.min(maxBid, f.exact - BID.INTEREST * n - 100, cash + BID.LOAN * n);
          if (cap > bestCap) { bestCap = cap; bestN = n; }
        }
      }
      maxBid = Math.floor(bestCap / 100) * 100;
      if (bestN) loanTip = ` · over ${money(cash)} = ${bestN} loan${bestN > 1 ? 's' : ''} (+$500 interest), still profit`;
    }
    return { lo, hi, ev, src, maxBid, loanTip };
  }
  function readCash(txt) {
    const m = String(txt || '').match(/(?:your (?:money|cash|balance)|you have|cash|balance|money)\D{0,12}\$\s?([\d,]+)/i) || String(txt || '').match(/\$\s?([\d,]+)\s*(?:left|available|in (?:the )?bank)/i);
    return m ? +m[1].replace(/,/g, '') : null;
  }
  // which painting is up right now? (title shown on the phone or in the game data)
  // a tip sentence mentions a title without that painting being up for auction - never match on those
  const isTipLine = (l) => TIP_RE.test(l) && !BIDUI_RE.test(l) && /\b(worth|valu|rumou?r|psst|tip|insider|heard|secret|appraised|sells? for)/i.test(l);
  function matchTitle(hay, facts) {
    let best = null;
    for (const [k, f] of Object.entries(facts)) if (hay.includes(' ' + k + ' ') && (!best || k.length > best.key.length)) best = { key: k, f };
    return best ? best.f : null;
  }
  function currentPainting(txt) {
    const facts = parseBidTips();
    // 1) the title shown on the phone right now
    const screenHay = ' ' + normTitle(String(txt || '').split(/\n+/).filter((l) => !isTipLine(l)).join(' ')) + ' ';
    const onScreen = matchTitle(screenHay, facts);
    if (onScreen) return onScreen;
    // 2) the newest game data (skipping tip messages)
    const newest = [...entities.values()].sort((x, y) => y.t - x.t)[0];
    if (!newest) return null;
    const strs = []; const walk = (v, d) => { if (d > 6 || v == null) return; if (typeof v === 'string') { if (!isTipLine(v)) strs.push(v); return; } if (typeof v === 'object') Object.values(v).slice(0, 80).forEach((x) => walk(x, d + 1)); };
    walk(newest.val, 0);
    return matchTitle(' ' + normTitle(strs.join(' | ')) + ' ', facts);
  }
  function isBidScreen(items) {
    return items.some((i) => i.kind === 'number') || items.some((i) => i.kind === 'click' && /\bbid\b|\$\s?\d/i.test(i.desc));
  }
  function bidAdvice(items, txt) {
    if (!isBidScreen(items)) return null;
    const f = currentPainting(txt);
    const cash = readCash(txt);
    const pr = priceFact(f, cash);
    const target = items.find((i) => i.kind === 'number') || items.find((i) => i.kind === 'click' && /\bbid\b/i.test(i.desc)) || items.find((i) => i.kind === 'click' && /\$\s?\d/.test(i.desc));
    return { f, cash, pr, target };
  }
  function bidLedgerText(items, txt) {
    const tips = loadBidTips();
    const L = ['BIDIOTS LEDGER (tips this player saw on their phone - these are the TRUE prices; use them before any guess):'];
    if (tips.length) tips.slice(-15).forEach((t) => L.push('  TIP: ' + clean(t.text, 200))); else L.push('  (no tips seen yet)');
    const ba = bidAdvice(items, txt);
    if (ba) L.push(`CALCULATED for the painting on screen${ba.f ? ' "' + ba.f.title + '"' : ' (not matched to a tip - identify it from the TV photo or screen and match it to the tips yourself)'}: worth ${ba.pr.lo === ba.pr.hi ? money(ba.pr.ev) : money(ba.pr.lo) + '-' + money(ba.pr.hi)} (${ba.pr.src}), max bid ${money(ba.pr.maxBid)}${ba.cash != null ? ', player cash ' + money(ba.cash) : ''}${ba.pr.loanTip}. Use these numbers unless you can identify the painting more precisely.`);
    return L.join('\n');
  }
  // deterministic overlay: no AI needed when the painting matches a tip
  // ===========================================================================
  // Truth catcher (Fibbage / Drawful): the game REJECTS a lie that is the real answer -
  // so a rejected submission tells us the truth for the voting round
  // ===========================================================================
  const TRUTH_REJECT_RE = /(that'?s (actually )?the (truth|real answer|correct answer|right answer|real title)|that is the (truth|real answer|correct answer)|you (entered|typed|wrote|guessed) the (truth|real answer|correct answer|right answer|real title)|too close to the (truth|real answer|correct answer|real title|answer)|is (actually )?the (real|correct) (answer|title)|oops[^.\n]{0,40}(truth|real answer|correct answer|real title))/i;
  const TRUTH_KEY = 'jbai_truths';
  const loadTruths = () => { try { return JSON.parse(sessionStorage.getItem(TRUTH_KEY)) || []; } catch (_) { return []; } };
  const truthGame = (g) => !g || g.id === 'fibbage' || g.id === 'drawful';
  let lastSubmitted = null; // { vals, t } - what was in the answer box when Submit was pressed
  function noteSubmit(e) {
    try {
      const b = e.target && e.target.closest && e.target.closest('button, [role="button"], input[type="submit"]');
      if (!b) return;
      if (!SUBMIT_RE.test(clean(b.textContent || b.value || b.getAttribute('aria-label'), 40))) return;
      const vals = inventory(true).filter((i) => i.kind === 'text').map(fieldVal).filter(Boolean);
      if (vals.length) lastSubmitted = { vals, t: Date.now() };
    } catch (_) { /* ignore */ }
  }
  function truthCatch(txt) {
    if (!lastSubmitted || Date.now() - lastSubmitted.t > 30000 || !TRUTH_REJECT_RE.test(txt)) return;
    const truth = lastSubmitted.vals[0]; lastSubmitted = null;
    const list = loadTruths();
    if (list.some((x) => normTitle(x.truth) === normTitle(truth))) return;
    list.push({ truth, t: Date.now() });
    try { sessionStorage.setItem(TRUTH_KEY, JSON.stringify(list.slice(-20))); } catch (_) { /* ignore */ }
    toast('🎯 Game confirmed the REAL answer: "' + clean(truth, 40) + '" - write another lie, then vote for it!');
    if (settings.autoMode !== 'off' && !busy) run(`The game REJECTED "${truth}" because it IS the real answer. Write believable lies that are clearly NOT this answer.`, !panel.classList.contains('open'));
  }
  // pin ✅ on the confirmed truth when the voting choices show up - no AI needed
  function truthHud() {
    if (!settings.hud) return;
    const truths = loadTruths(); if (!truths.length) return;
    const choices = inventory().filter((i) => i.kind === 'click'); if (choices.length < 2) return;
    const out = [];
    for (const { truth } of truths) {
      const k = normTitle(truth); if (k.length < 2) continue;
      const hit = choices.find((i) => { const d = normTitle(i.desc.replace(/^button "|"( \(selected\))?$/g, '')); return d === k || (k.length >= 4 && (d.includes(k) || (d.length >= 4 && k.includes(d)))); });
      if (hit) out.push({ el: hit.el, text: '✅ REAL ANSWER (game confirmed)', cls: 'best', ring: true });
    }
    if (out.length) addHud(out, hudPill || '🎯 The game confirmed the real answer - vote for the green one');
  }

  function bidHud() {
    if (!settings.hud) return;
    const g = detectGame(screenText());
    if (!g || g.id !== 'bidiots') return;
    const items = inventory(); const txt = screenText();
    const ba = bidAdvice(items, txt);
    if (!ba || !ba.target) return;
    const worth = ba.pr.lo === ba.pr.hi ? money(ba.pr.ev) : money(ba.pr.lo) + '–' + money(ba.pr.hi);
    addHud([{ el: ba.target.el, text: '🛑 max bid ' + money(ba.pr.maxBid), cls: 'best', ring: true }],
      hudPill || ('💰 ' + (ba.f ? '"' + clean(ba.f.title, 40) + '" ' : 'Unknown painting ') + 'worth ' + worth + ' (' + ba.pr.src + ') → stop at ' + money(ba.pr.maxBid) + ba.pr.loanTip));
  }

  function gameData() {
    if (!settings.readConnection || !entities.size) return '';
    const recent = [...entities.entries()].sort((a, b) => b[1].t - a[1].t).slice(0, 6);
    let outStr = '';
    for (const [k, v] of recent) {
      const line = k + ' = ' + JSON.stringify(v.val);
      if (outStr.length + line.length > 3500) break;
      outStr += line + '\n';
    }
    return outStr;
  }

  // ===========================================================================
  // Settings
  // ===========================================================================
  const DEFAULTS = {
    provider: 'auto', // auto | claude | gemini | groq | openrouter | pollinations
    claudeKey: '',
    geminiKey: '',
    groqKey: '',
    openrouterKey: '',
    claudeModel: 'claude-opus-5-5',
    effort: 'low',
    customModel: '', // optional override for the primary provider
    count: 5,
    spice: 3,
    persona: 'crowd',
    style: '',
    customPrompt: '',
    mode: 'copilot', // coach | copilot | autopilot | chaos
    autoMode: 'off', // off | prompts | all
    autoSubmit: false,
    memory: true,
    drawSpeed: 'fast',
    webSearch: true, // live search for trivia / truths (Gemini + Claude)
    hud: true, // pin answers/values right on top of the game screen
    readConnection: true, // use the data Jackbox sends to this phone
    race: false, // ask the top 2 AIs at once, show whichever answers first
    taste: { likes: [], dislikes: [] }, // learned from 👍/👎
    welcomed: false,
    fabX: null,
    fabY: null,
    modelCache: {},
  };

  const SPICE = {
    1: { label: '😇 Family', text: 'FAMILY FRIENDLY. No swearing, no innuendo, nothing gross. Clever, silly, wholesome - kids could be playing.' },
    2: { label: '🙂 Normal', text: 'PG-13. Mild swearing and light innuendo are fine. Cheeky, not crude.' },
    3: { label: '😈 Edgy', text: 'R-RATED. Swearing, sex jokes, gross-out, dark and morbid jokes are all ALLOWED - use them when they are the funniest angle for this prompt, not by default. A clever or absurd answer that kills beats a forced dirty one. Do not play it safe either.' },
    4: { label: '💀 Unhinged', text: 'UNHINGED / NO FILTER. Adults-only room: nothing is off-limits tone-wise - explicit sex jokes and innuendo, death, murder, drugs, bodily fluids, diseases, existential dread, crime, disasters, tragedies, brutal personal roasts of the players by name. BUT dark is a weapon, not a rule: go shocking when the prompt sets it up and it is genuinely the funniest answer; when a clever, absurd or brutally honest answer would get more votes, use that instead. Forced shock with no joke behind it bombs. When you do go dark, commit fully - no softening, hedging or disclaimers. Only line: no slurs and no jokes where a race, religion, sexuality or disability is the punchline - those get groans and lose votes; aim the darkness at situations, the players and yourself instead.' },
  };

  const PERSONAS = {
    crowd: ['🎯 Crowd-pleaser', 'Whatever wins the most votes with this room.'],
    deadpan: ['😐 Deadpan', 'Dry, understated, matter-of-fact delivery of absurd things.'],
    absurd: ['🌀 Absurdist', 'Surreal, random, unexpected left turns. Weird wins.'],
    puns: ['🧠 Pun master', 'Wordplay, puns, double meanings, clever twists.'],
    dad: ['👨 Dad jokes', 'Groan-worthy dad jokes delivered with full confidence.'],
    genz: ['💅 Gen Z', 'Gen Z / internet slang and brainrot energy, chronically online references.'],
    savage: ['🔪 Savage', 'Brutal roasts and merciless honesty.'],
    shakespeare: ['🎭 Shakespeare', 'Old-timey dramatic theatre voice for modern nonsense.'],
    corporate: ['💼 Corporate', 'HR-speak and LinkedIn corporate jargon applied to unhinged situations.'],
    conspiracy: ['🛸 Conspiracy', 'Paranoid conspiracy-theorist energy; everything is connected.'],
    wholesome: ['🌈 Wholesome chaos', 'Sweet and kind but escalating into chaos.'],
  };

  const MODES = {
    coach: ['🎓 Coach', 'Explain briefly WHY each option works in "why".'],
    copilot: ['🤝 Co-pilot', ''],
    autopilot: ['🤖 Autopilot', ''],
    chaos: ['🌀 Chaos', 'CHAOS MODE: the player wants maximum chaos - the most unexpected, absurd, room-derailing answers that still technically fit. Still try to win the laugh.'],
  };

  const ROOM_PRESETS = {
    '🎓 College': 'college friends in their 20s, very online, dark humor welcome',
    '👪 Family': 'family game night with parents and teens, keep it clever',
    '💼 Coworkers': 'coworkers after work, office humor, nothing HR-fireable',
    '🎮 Gamers': 'gamer friends, gaming and internet culture references land',
    '🍷 Adults': 'adults with drinks, anything goes, roast each other',
    '👵 Boomers': 'older relatives, classic references, gentle innuendo is hilarious to them',
  };

  // One-tap builders for the Custom Instructions box
  const STYLE_PRESETS = {
    '🤯 Pun machine': 'Always try a clever pun or wordplay first.',
    '🔪 Short & savage': 'Keep answers under 6 words and make them brutal.',
    '🎬 Movie buff': 'Work in a movie or TV reference whenever it fits.',
    '📱 Chronically online': 'Use current memes and internet/brainrot humor.',
    '🧠 Big brain': 'Smart, unexpected answers that reward clever people.',
    '🌀 Max absurd': 'Prefer surreal, random, absurd answers over obvious or gross ones.',
    '🥂 Roast the room': 'Roast the other players by name whenever you can.',
    '💀 As dark as allowed': 'Go as dark and twisted as the current humor level permits.',
    '🎯 Just win': 'Prioritise winning the vote over being clever or on-brand.',
    '🍆 Filthy': 'Lean into sex jokes and innuendo (within the humor level).',
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

  const settings = JSON.parse(JSON.stringify(DEFAULTS));
  async function loadSettings() {
    for (const k of Object.keys(DEFAULTS)) {
      const v = await store.get(k);
      if (v !== undefined && v !== null) settings[k] = v;
    }
    // migrations from older versions
    const oldKey = await store.get('apiKey');
    if (oldKey && !settings.claudeKey) settings.claudeKey = oldKey;
    const oldModel = await store.get('model');
    if (oldModel && /claude/.test(oldModel)) settings.claudeModel = oldModel;
    if ((await store.get('autopilot')) === true && settings.mode === 'copilot') settings.mode = 'autopilot';
    if ((await store.get('autoSuggest')) === true && settings.autoMode === 'off') settings.autoMode = 'prompts';
    settings.spice = Math.min(4, Math.max(1, +settings.spice || 3));
    settings.count = +settings.count || 5;
    if (!PERSONAS[settings.persona]) settings.persona = 'crowd';
    if (!MODES[settings.mode]) settings.mode = 'copilot';
    if (typeof settings.modelCache !== 'object' || !settings.modelCache) settings.modelCache = {};
    if (!settings.taste || typeof settings.taste !== 'object') settings.taste = { likes: [], dislikes: [] };
    if (!Array.isArray(settings.taste.likes)) settings.taste.likes = [];
    if (!Array.isArray(settings.taste.dislikes)) settings.taste.dislikes = [];
  }
  const save = (k, v) => { settings[k] = v; return store.set(k, v); };

  // Session memory + stats (this tab only)
  const MEM_KEY = 'jbai_memory';
  const STATS_KEY = 'jbai_stats';
  const loadMemory = () => { try { return JSON.parse(sessionStorage.getItem(MEM_KEY)) || []; } catch (_) { return []; } };
  function remember(entry) {
    if (!settings.memory) return;
    const m = loadMemory();
    m.push({ ...entry, t: Date.now() });
    try { sessionStorage.setItem(MEM_KEY, JSON.stringify(m.slice(-30))); } catch (_) { /* ignore */ }
  }
  const clearMemory = () => { try { sessionStorage.removeItem(MEM_KEY); sessionStorage.removeItem(STATS_KEY); sessionStorage.removeItem('jbai_obs'); sessionStorage.removeItem('jbai_suspects'); sessionStorage.removeItem('jbai_roomread'); sessionStorage.removeItem('jbai_bidtips'); sessionStorage.removeItem('jbai_truths'); } catch (_) { /* ignore */ } };
  function bumpStat(k) {
    let s = {};
    try { s = JSON.parse(sessionStorage.getItem(STATS_KEY)) || {}; } catch (_) { /* ignore */ }
    s[k] = (s[k] || 0) + 1;
    try { sessionStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch (_) { /* ignore */ }
  }
  const getStats = () => { try { return JSON.parse(sessionStorage.getItem(STATS_KEY)) || {}; } catch (_) { return {}; } };

  // Case file: every distinct screen this phone saw + the player's own notes
  const OBS_KEY = 'jbai_obs';
  const loadObs = () => { try { return JSON.parse(sessionStorage.getItem(OBS_KEY)) || []; } catch (_) { return []; } };
  function addObs(entry) {
    const o = loadObs();
    const norm = (x) => String(x || '').replace(/\d+/g, '#').slice(0, 300);
    if (!entry.note && o.length && norm(o[o.length - 1].text) === norm(entry.text)) return;
    o.push({ ...entry, t: Date.now() });
    try { sessionStorage.setItem(OBS_KEY, JSON.stringify(o.slice(-60))); } catch (_) { /* ignore */ }
  }
  const clearObs = () => { try { sessionStorage.removeItem(OBS_KEY); } catch (_) { /* ignore */ } };

  // Suspect-o-meter: a running probability per player, accumulated across rounds
  const SUS_KEY = 'jbai_suspects';
  function loadSus() { try { return JSON.parse(sessionStorage.getItem(SUS_KEY)) || { scores: {}, why: {} }; } catch (_) { return { scores: {}, why: {} }; } }
  function loadSusList() {
    const d = loadSus();
    return Object.keys(d.scores).map((name) => ({ name, prob: d.scores[name], why: d.why[name] || '' })).sort((a, b) => b.prob - a.prob);
  }
  function saveSus(list) {
    if (!list || !list.length) return;
    const d = { scores: {}, why: {} };
    list.forEach((sp) => { d.scores[sp.name] = sp.prob; if (sp.why) d.why[sp.name] = sp.why; });
    try { sessionStorage.setItem(SUS_KEY, JSON.stringify(d)); } catch (_) { /* ignore */ }
  }
  const clearSus = () => { try { sessionStorage.removeItem(SUS_KEY); } catch (_) { /* ignore */ } };

  // Room read: the AI's running one-line read of what THIS crowd laughs at
  const ROOM_KEY = 'jbai_roomread';
  const loadRoomRead = () => { try { return sessionStorage.getItem(ROOM_KEY) || ''; } catch (_) { return ''; } };
  const saveRoomRead = (t) => { try { if (t) sessionStorage.setItem(ROOM_KEY, t); } catch (_) { /* ignore */ } };
  // Screens that show how the room voted (results, scores, wins)
  const RESULT_RE = /\b(votes?|voted|wins?|winner|won|quiplash!?|points?|pts|score|likes?|round over|results?)\b/i;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const clean = (s, n) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, n);

  // ===========================================================================
  // Game database: detection + expert playbook (also shown offline as 📖 Guide)
  // ===========================================================================
  const GAMES = [
    { id: 'quiplash', name: 'Quiplash', re: /quiplash|thriplash|last ?lash|word ?lash|comic ?lash/, guide: 'Write the funniest answer to a prompt; two players go head-to-head and the room votes. Short, specific, surprising - skip the obvious first idea everyone else writes. Thriplash: three short answers that escalate or share a running gag. Last Lash / Word Lash / Comic Lash: follow the special format on screen. Voting: pick the funnier answer.', tips: ['Under 8 words usually wins', 'Specific names/brands beat generic', 'Funniest word goes LAST', 'Unanimous vote = QUIPLASH bonus'] },
    { id: 'fibbage', name: 'Fibbage', re: /fibbage|fourbage|enough about you|deep dive/, guide: 'Write a LIE for a fill-in-the-blank fact so other players pick it as the truth. Match the length, style and specificity of a real answer; plausible beats funny (unless it is a likes/funny round). Never type the real answer - the game rejects it. Voting: pick the most likely TRUTH (real answers are oddly specific and weird). Enough About You: lies about a player\'s personal answer - match their voice. Like the funniest lies.', tips: ['Lies should sound boring-true', 'Guess the truth: weirdest specific option', 'Avoid answers that sound like jokes'] },
    { id: 'tmp', name: 'Trivia Murder Party', re: /trivia ?murder|triviadeath|killing ?floor|killing ?room/, guide: 'Trivia: pick the correct answer. Death minigames (Killing Floor): read the rules and survive - solve math, pick the right chalice by logic, choose the real dictionary definition, memory, etc. Reason carefully; accuracy over humor. Finale: race to escape - choose ALL options that fit the category. As a ghost, keep answering.', tips: ['Accuracy > speed', 'In minigames read every rule', 'Finale: pick all that fit'] },
    { id: 'drawful', name: 'Drawful', re: /drawful/, guide: 'Draw the given prompt so players can GUESS it (you score when they find the real title). Then write lies (fake titles) for others\' drawings that sound like real Drawful prompts. Then pick the real title. Animate: two-frame animation of the prompt. Dirty Drawful: adult prompts.', tips: ['Draw the KEY visual idea big', 'Lies: plausible weird titles', 'Real titles are oddly specific'] },
    { id: 'bidiots', name: 'Bidiots', re: /bidiots|auction|place bid/, guide: 'RULES: every artist draws 2 paintings - one HIGH value ($3,000-$5,000) and one LOW value ($500-$2,500); nobody knows which, not even the artist. Each player privately gets ~3 tips about what some paintings are worth (different tips for each player). Everyone starts with $3,000; the ARTIST receives HALF of the sale price. Loans: $1,000 each, max 3, each costs $500 interest at the end. Final score = cash + worth of paintings owned - loans and interest. STRATEGY: buy only below worth; a tipped exact value is truth; unknown paintings average about $2,750 but are risky; if one painting by an artist is known to be high, their other one is low (and vice versa); buying your OWN painting effectively costs half (you get the commission back); push opponents to overpay on paintings you know are low. Draw exactly the prompt when drawing.', tips: ['Tips on your phone are the only true prices - the helper logs them all', 'Each artist has 1 high ($3-5k) + 1 low ($0.5-2.5k) painting', 'You start with $3,000; artist gets half the sale', 'Loan = +$1,000 now, -$1,500 at the end'] },
    { id: 'earwax', name: 'Earwax', re: /earwax/, guide: 'Pick two sound effects from your hand that best answer the judge\'s prompt. Choose the most absurd but fitting combo.', tips: ['Weird combos win', 'Think like the judge'] },
    { id: 'bombcorp', name: 'Bomb Corp', re: /bomb ?corp|bombintern|defuse/, guide: 'Cooperative bomb defusal: follow the on-screen rules / manual exactly and give the precise step-by-step solution (which wires, buttons, order). Accuracy, not humor.', tips: ['Read rules top to bottom', 'Say steps in order'] },
    { id: 'wordspud', name: 'Word Spud', re: /word ?spud/, guide: 'Continue the previous word to form a funny compound word or phrase. Short and clever.', tips: ['One or two words', 'Aim for a funny phrase'] },
    { id: 'lieswatter', name: 'Lie Swatter', re: /lie ?swatter/, guide: 'True/false trivia; answer correctly and fast.', tips: ['Weird facts are often true'] },
    { id: 'ydkj', name: "You Don't Know Jack", re: /don'?t know jack|ydkj/, guide: 'Comedic trivia with wordplay questions. Decode the pun and pick the correct answer. Screws: use on the leading opponent.', tips: ['Questions hide a pun - decode it'] },
    { id: 'guesspionage', name: 'Guesspionage', re: /guesspionage|pollposition/, guide: 'Guess what % of people answered a survey question (set the slider). When judging someone else\'s guess, predict Higher/Lower or Much Higher/Much Lower. Final round: pick the top answers.', tips: ['Use real survey intuition', 'Much higher/lower = more points if right'] },
    { id: 'teeko', name: 'Tee K.O.', re: /tee ?k\.? ?o|awshirt/, guide: 'Draw pictures and write slogans; they get combined into shirts that battle. Drawings: bold, funny, versatile. Slogans: funny alone and with many images. Pick the shirt the room will vote for.', tips: ['Make slogans that work on any picture', 'Big bold drawings'] },
    { id: 'fakinit', name: "Fakin' It", re: /fakin'? ?it/, guide: 'Everyone gets a secret physical task except the faker. If you are the faker: blend in, copy the crowd with slight delay, look confident. Voting: pick who hesitated or copied others.', tips: ['Faker: copy others, don\'t freeze', 'Watch for the person who hesitates'] },
    { id: 'survive', name: 'Survive the Internet', re: /survive the internet|survivetheinternet/, guide: 'Answer a question; then twist another player\'s answer into a damning out-of-context caption for a fake social post/website/search result. Make the original author look as bad or absurd as possible.', tips: ['Context is everything', 'Make them look terrible'] },
    { id: 'monster', name: 'Monster Seeking Monster', re: /monster seeking|monstermingle/, guide: 'Text other players to win dates; short, flirty, funny messages; use your monster power wisely.', tips: ['Be charming and weird'] },
    { id: 'bracketeering', name: 'Bracketeering', re: /bracketeering/, guide: 'Answer prompts; answers battle in brackets; also predict winners. Write answers that can beat many opponents; for predictions pick the stronger answer.', tips: ['Broadly funny answers survive brackets'] },
    { id: 'civic', name: 'Civic Doodle', re: /civic ?doodle|overdrawn/, guide: 'Collaborative mural: add to the existing drawing to make it funnier or better; the room votes on each addition. Build on what is already there (see attached image).', tips: ['Add one strong funny detail'] },
    { id: 'splitroom', name: 'Split the Room', re: /split the room/, guide: 'Fill in the blank of a hypothetical so the room splits as close to 50/50 as possible: big upside plus a funny, painful catch. When others ask, answer honestly.', tips: ['Make it a genuinely hard choice'] },
    { id: 'madverse', name: 'Mad Verse City', re: /mad ?verse|rapbattle/, guide: 'Fill in rap lines that roast the opponent; end on a word that rhymes with the given line; punchy and savage.', tips: ['Land the rhyme on the last word', 'Roast their name'] },
    { id: 'patently', name: 'Patently Stupid', re: /patently ?stupid/, guide: 'Write problems; draw and name an invention that solves someone\'s problem; write a catchy tagline; pitch it. Labels in the drawing are OK here.', tips: ['Punny invention name', 'Clear diagram with labels'] },
    { id: 'rolemodels', name: 'Role Models', re: /role ?models/, guide: 'Assign roles from a category to each player based on how the room sees them; match consensus to score.', tips: ['Think how the GROUP sees each person'] },
    { id: 'jokeboat', name: 'Joke Boat', re: /joke ?boat/, guide: 'Write words/catchphrases, build joke setups from templates, write punchlines, then perform. Classic structure, tight punchline, twist at the end.', tips: ['Twist in the last 2 words'] },
    { id: 'dictionarium', name: 'Dictionarium', re: /dictionarium|ridictionary/, guide: 'Invent a definition for a made-up word, then a synonym for the winning definition, then use the synonym in a sentence. Funny and coherent.', tips: ['Definitions that sound real but absurd'] },
    { id: 'pushbutton', name: 'Push the Button', re: /push the button/, guide: 'Social deduction: humans vs hidden aliens. In tests aliens see a slightly different prompt. If you are an alien, write answers vague enough to fit the humans\' likely prompt. If human, look for answers that don\'t fit and accuse.', tips: ['Aliens: stay vague', 'Humans: spot the odd answer'] },
    { id: 'devils', name: 'The Devils and the Details', re: /devils and the details/, guide: 'Cooperative family chores; complete the on-screen tasks accurately and fast (word puzzles, search, communicate).', tips: ['Accuracy first'] },
    { id: 'champdup', name: "Champ'd Up", re: /champ'?d up|worldchampions|champion of/, guide: 'Draw a champion for a category ("Champion of ___") and give it a punny name; then challengers fight. Bold character + funny name.', tips: ['Character + funny name', 'Exaggerate the trait'] },
    { id: 'talkingpoints', name: 'Talking Points', re: /talking points|jackbox-talks/, guide: 'A presenter improvises a talk; an assistant picks slides. As assistant pick the most chaotic/funny slides. As presenter, give confident improv lines.', tips: ['Assist chaos, not clarity'] },
    { id: 'blather', name: "Blather 'Round", re: /blather|blanky/, guide: 'Describe a secret person/place/thing/story using sentence templates with limited word choices; others guess. Choose the most precise descriptive words. When guessing, type the most likely answer.', tips: ['Pick precise words', 'Guess common famous things first'] },
    { id: 'wheel', name: 'The Wheel of Enormous Proportions', re: /wheel of enormous|enormous proportions/, guide: 'Trivia in different formats (matching, typing, ranking); answer correctly; then ask the wheel a question.', tips: ['Answer fast and right'] },
    { id: 'jobjob', name: 'Job Job', re: /job ?job|jobgame|word bank/, guide: 'Answer icebreaker questions; then build job-interview answers using ONLY words from your word bank (tap words in order). Funny and coherent sentence using available words only.', tips: ['Only use bank words', 'Make a coherent sentence'] },
    { id: 'pollmine', name: 'The Poll Mine', re: /poll mine|survey-bomb/, guide: 'Team game: guess how the room ranked answers to a poll; pick the top (or bottom) ranked options.', tips: ['Think how the room voted'] },
    { id: 'weapons', name: 'Weapons Drawn', re: /weapons drawn|murder-detectives/, guide: 'Murder mystery: draw a weapon that subtly hides a letter from your name; detectives look for clues. Hide the letter in the weapon\'s shape. When investigating, look for letters hidden in weapons.', tips: ['Hide your letter in the shape', 'Look for letters in others'] },
    { id: 'roomerang', name: 'Roomerang', re: /roomerang|htmf/, guide: 'Reality TV show: answer prompts in character, vote others out, survive. Funny, in character, play alliances.', tips: ['Stay in character'] },
    { id: 'junktopia', name: 'Junktopia', re: /junktopia|antique-game/, guide: 'Name junk items and write absurd backstories; collect sets; the room votes. Punny names + absurd history.', tips: ['Punny name, wild backstory'] },
    { id: 'nonsensory', name: 'Nonsensory', re: /nonsensory|range-game/, guide: 'Draw or write something that sits at a given number on a scale (e.g. 7/10 scary); others guess the number. Calibrate your clue precisely. When guessing, set the slider precisely.', tips: ['Calibrate to the exact number'] },
    { id: 'quixort', name: 'Quixort', re: /quixort/, guide: 'Sort falling words into a line by a trait (e.g. oldest to newest); move left/right. Use knowledge to order correctly.', tips: ['Order carefully'] },
    { id: 'fixytext', name: 'FixyText', re: /fixy ?text/, guide: 'Players write a text message together at the same time; add funny words that steer it.', tips: ['Steer the story'] },
    { id: 'timejinx', name: 'Timejinx', re: /timejinx/, guide: 'Guess the YEAR something happened; closest wins. Use real knowledge.', tips: ['Anchor on known events'] },
    { id: 'hypnotorious', name: 'Hypnotorious', re: /hypnotorious/, guide: 'Social deduction: find who shares your secret identity group by asking/answering questions.', tips: ['Ask questions that split groups'] },
    { id: 'suspectives', name: 'Suspectives', re: /suspectives/, guide: 'Social deduction with interview questions; answer convincingly and spot the suspect.', tips: ['Stay consistent'] },
    { id: 'cookiehaus', name: 'Cookie Haus', re: /cookie ?haus/, guide: 'Decorate cookies (drawing) to match prompts; bold, readable, funny.', tips: ['Clear iconic shapes'] },
    { id: 'surveyscramble', name: 'Survey Scramble', re: /survey scramble/, guide: 'Guess the most popular survey answers; type common, obvious answers.', tips: ['Most common answer wins'] },
    { id: 'dodoremi', name: 'Dodo Re Mi', re: /dodo re mi/, guide: 'Rhythm music game - timing taps. The AI cannot help with rhythm; give encouragement only.', tips: ['Just vibe'] },
    { id: 'zeeple', name: 'Zeeple Dome', re: /zeeple/, guide: 'Physics flinging game; only quick aiming advice is possible.', tips: ['Aim for the bounce'] },
  ];

  // Exact game from the room's appTag (from the phone's connection)
  const APPTAGS = {
    quiplash: /quiplash/, fibbage: /fibbage|fourbage/, tmp: /triviadeath/, drawful: /drawful/, bidiots: /auction|bidiots/, earwax: /earwax/,
    bombcorp: /bombintern|bombcorp/, wordspud: /wordspud/, lieswatter: /lieswatter/, ydkj: /ydkj/, guesspionage: /pollposition/, teeko: /awshirt|tko|teeko/,
    fakinit: /fakin/, survive: /survivetheinternet/, monster: /monstermingle/, bracketeering: /bracketeering/, civic: /overdrawn/,
    splitroom: /split/, madverse: /rapbattle/, patently: /patently/, rolemodels: /rolemodels/, jokeboat: /jokeboat/, dictionarium: /ridictionary/,
    pushbutton: /pushthebutton/, devils: /everyday/, champdup: /worldchampions/, talkingpoints: /jackbox-talks/, blather: /blanky-blank/,
    wheel: /the-wheel|enormous/, jobjob: /jobgame/, pollmine: /survey-bomb/, weapons: /murder-?detectives/, roomerang: /htmf/, junktopia: /antique-game/,
    nonsensory: /range-game/, quixort: /lineup/, fixytext: /fixy/, timejinx: /timejinx/, hypnotorious: /hypnotorious/, suspectives: /suspectives/,
    cookiehaus: /cookie/, surveyscramble: /survey-?scramble/, dodoremi: /dodo/, zeeple: /slingshoot|zeeple/,
  };
  const ACCURACY_GAMES = new Set(['tmp', 'ydkj', 'lieswatter', 'wheel', 'timejinx', 'guesspionage', 'bombcorp', 'quixort', 'surveyscramble', 'pollmine', 'devils']);
  const DEDUCTION_GAMES = new Set(['pushbutton', 'fakinit', 'hypnotorious', 'suspectives', 'weapons']);
  const SEARCH_GAMES = new Set(['tmp', 'ydkj', 'lieswatter', 'wheel', 'timejinx', 'quixort', 'fibbage', 'guesspionage']);
  const DETECTIVE = 'DETECTIVE: Using the CASE FILE, GAME DATA and the screen, work out who the impostor(s) are. Compare every answer to what the real prompt/task was, look for vague, hedged, off-topic or copied answers, odd timing notes, suspicious votes and defending. In advice rank the suspects with a % each and the key evidence. Options = the vote/accuse buttons for your top suspects, best first, each with "why". If the screen says YOU are the impostor/alien/faker: instead give answers and moves that blend in and frame someone else.';
  const GAME_CHIPS = {
    fibbage: [['🧪 Probe the truth', 'Give as option 1 your single best guess of the REAL answer, written plainly like a real answer (it doubles as a believable lie): if it is the truth the game rejects it and the helper learns the real answer for voting. Options 2+ are normal believable lies.'], ['🕵️ Find the truth', 'Voting: identify which choice is the REAL answer. Verify with search if you can. Put the real answer and your confidence % in advice; option 1 = tap the truth.', true], ['🚫 What is the real answer?', 'Tell me the REAL answer to this question in advice (so I avoid typing it) and give lies that sound more true than the truth.', true], ['🤥 Sneakier lie', 'Lies that sound boringly, specifically TRUE - same style and length as a real answer, nothing jokey.']],
    drawful: [['📷 Snap the TV', 'TVCAM'], ['🧪 Probe the title', 'Give as option 1 your best guess of the REAL title of this drawing, worded like a real Drawful prompt (it doubles as a believable lie): if it is the real title the game rejects it and the helper learns it for voting. Options 2+ are normal believable lies.'], ['🕵️ Real title?', 'Voting: which title is the real prompt for this drawing? Confidence % in advice.'], ['🤥 Better lie', 'Lies that sound like real Drawful prompts for this drawing.']],
    tmp: [['🔎 Look it up', 'Verify the answer with search before answering. Put the correct answer and source in advice.', true], ['🧮 Solve carefully', 'This is a minigame/puzzle: reason step by step and double-check before answering. Explain the rule in advice.']],
    ydkj: [['🔎 Look it up', 'Decode the wordplay, verify with search, give the correct answer.', true]],
    lieswatter: [['🔎 Fact-check', 'Verify whether the statement is true with search. Answer correctly.', true]],
    wheel: [['🔎 Look it up', 'Verify with search and answer correctly.', true]],
    timejinx: [['🔎 Exact year', 'Look up the exact year with search and set it.', true]],
    guesspionage: [['📊 Best estimate', 'Estimate the real survey percentage as precisely as possible; explain in advice.', true]],
    pushbutton: [['🛸 Who is the alien?', DETECTIVE], ['👽 I am the alien', 'I am an alien: give answers that fit what the humans probably saw and point suspicion at someone else.']],
    fakinit: [['🔍 Who is faking?', DETECTIVE], ['🎭 I am the faker', 'I am the faker: guess the likely task from the category/screen and tell me exactly how to blend in (timing, what to copy).']],
    weapons: [['🔍 Who did it?', DETECTIVE], ['🔤 Hide my letter', 'Draw a weapon that hides a letter of my name (from the screen) as subtly as possible.']],
    hypnotorious: [['🔍 Who is who?', DETECTIVE]],
    suspectives: [['🔍 Who is lying?', DETECTIVE]],
    quiplash: [['🏆 Safe winner', 'Give answers that win with ANY crowd - broad, punchy, sure-fire.'], ['🎲 Wildcard', 'Give one-in-a-million wildcard answers that either bomb or get a QUIPLASH.']],
    bidiots: [['📷 Snap the TV', 'TVCAM'], ['💰 What is it worth?', 'Using the BIDIOTS LEDGER (my tips), the real value ranges and anything on screen or in the TV photo: name the painting up for auction, its worth, and my max bid. Put worth + max bid as badges on the bid controls.']],
    splitroom: [['⚖️ Perfect 50/50', 'Make the dilemma split the room as close to exactly 50/50 as possible.']],
    jobjob: [['🧩 Best sentence', 'Build the funniest coherent answer using ONLY my word bank words, tapped in order.']],
    teeko: [['📷 Snap the TV', 'TVCAM'], ['👕 Best shirt', 'Pick or make the shirt the room will vote for.']],
    blather: [['🎯 Best words', 'Pick the most precise words so others guess fastest; when guessing, name the most likely famous answer.']],
    madverse: [['🎤 Rhyme + roast', 'Bars that land the rhyme on the LAST word and brutally roast the opponent by name.']],
    survive: [['📷 Snap the TV', 'TVCAM'], ['🪤 Damning caption', 'Twist the quote into the most out-of-context, reputation-destroying caption possible.']],
    monster: [['😏 Smooth + weird', 'Short flirty, funny messages to win the date; use my monster power well.']],
    rolemodels: [['👥 Read the room', 'Assign each role to the player the GROUP would agree on, not just what I think.']],
    pollmine: [['📊 How the room voted', 'Predict how the room actually ranked these and pick the top (or bottom) as asked.']],
    surveyscramble: [['📊 Most common', 'Give the most popular, obvious survey answers people actually say.']],
    bracketeering: [['🏆 Bracket-proof', 'A broadly funny answer that can beat many different opponents in a bracket.']],
    earwax: [['🔊 Best combo', 'Pick the two sound effects that funniest/best answer the prompt.']],
    dictionarium: [['📖 Sounds real', 'Invent a definition that sounds plausibly real but is absurd and funny.']],
    nonsensory: [['🎯 Calibrate', 'Calibrate the clue to the EXACT number on the scale; when guessing, set it precisely.']],
    wordspud: [['🥔 Funny combo', 'Continue the word into the funniest compound word or phrase.']],
    jokeboat: [['😂 Twist ending', 'Classic setup, tight punchline, surprise twist in the last two words.']],
    joke: [['😂 Twist ending', 'Classic setup, tight punchline, surprise twist in the last two words.']],
    patently: [['💡 Pitch it', 'Punny invention name, clear labelled diagram, catchy tagline.']],
    champdup: [['📷 Snap the TV', 'TVCAM'], ['🏆 Punny champ', 'A bold character that fits the category with a punny name.']],
    civic: [['🖍️ One funny add', 'Add one strong funny detail that builds on what is already drawn.']],
    cookiehaus: [['🍪 Clear + funny', 'Decorate with bold, instantly readable, funny shapes.']],
    roomerang: [['🎭 In character', 'Answer in character and play the alliances to survive.']],
    junktopia: [['🗑️ Punny + wild', 'A punny item name with a wild absurd backstory.']],
    talkingpoints: [['📷 Snap the TV', 'TVCAM'], ['🎪 Max chaos', 'As assistant pick the most chaotic/funny slides; as presenter, confident improv lines.']],
  };
  const isAccuracy = (g) => !!g && ACCURACY_GAMES.has(g.id);
  const PICTURE_GAMES = new Set(['drawful', 'teeko', 'bidiots', 'champdup', 'civic', 'patently', 'weapons', 'cookiehaus', 'nonsensory', 'junktopia', 'talkingpoints']);
  const isDeduction = (g) => !!g && DEDUCTION_GAMES.has(g.id);

  function fingerprint() {
    const bits = [document.title];
    for (const el of document.querySelectorAll('[id], [class]')) {
      if (bits.length > 400) break;
      if (el.closest('#jbai-host')) continue;
      if (el.id) bits.push(el.id);
      if (typeof el.className === 'string' && el.className) bits.push(el.className);
    }
    for (const s of document.querySelectorAll('script[src], link[href]')) bits.push(s.src || s.href);
    return bits.join(' ').toLowerCase();
  }

  // Exact installment titles (checked against the room appTag; specific first)
  const EXACT = [
    [/quiplash3/, 'Quiplash 3'], [/quiplash2/, 'Quiplash 2: The Sequel'], [/quiplashxl/, 'Quiplash XL'],
    [/fibbage4|fourbage/, 'Fibbage 4'], [/fibbage3/, 'Fibbage 3'], [/fibbage2/, 'Fibbage 2'], [/enoughaboutyou|fibbageenough/, 'Fibbage: Enough About You'],
    [/triviadeath2/, 'Trivia Murder Party 2'],
    [/drawfulanimate|animate/, 'Drawful: Animate'], [/drawful2/, 'Drawful 2'],
    [/awshirt/, 'Tee K.O. 2'],
    [/quiplash/, 'Quiplash'],
  ];
  let lockedGame = null;
  function detectGame(text, fresh) {
    if (!fresh) return cached('game', domVersion + '|' + appTag, () => detectGameRaw(text));
    const r = detectGameRaw(text); memo.game = { v: domVersion + '|' + appTag, t: Date.now(), r }; return r;
  }
  function detectGameRaw(text) {
    if (appTag) {
      const t = appTag.toLowerCase();
      const g = GAMES.find((x) => APPTAGS[x.id] && APPTAGS[x.id].test(t));
      if (g) { const ex = EXACT.find((e) => e[0].test(t)); g._exact = ex ? ex[1] : null; lockedGame = g; g.via = 'connection'; return g; }
    }
    const hay = (fingerprint() + ' ' + (text || '')).toLowerCase();
    let best = null, bestScore = 0;
    for (const g of GAMES) {
      if (!g._rx) g._rx = new RegExp(g.re.source, 'gi');
      g._rx.lastIndex = 0;
      const m = hay.match(g._rx);
      if (!m) continue;
      const score = m.length + (hay.includes(g.name.toLowerCase()) ? 5 : 0);
      if (score > bestScore) { best = g; bestScore = score; }
    }
    if (best) { best._exact = null; best.via = 'screen'; lockedGame = best; }
    return best || lockedGame;
  }

  // ===========================================================================
  // Reading the screen
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
    const t = screenText();
    return /room\s*code/i.test(t) && /\b(play|join)\b/i.test(t) && !!document.querySelector('input');
  }

  function solidColor(el, cs) {
    const bg = (cs || getComputedStyle(el)).backgroundColor;
    if (bg && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)|transparent/.test(bg)) return bg;
    const dc = el.getAttribute('data-color') || el.getAttribute('data-value');
    if (dc && /^#|rgb/.test(dc)) return dc;
    return null;
  }

  const SUBMIT_RE = /^(submit|send|done|confirm|lock ?in|bid|place bid|ok|okay|enter|go|vote|finish|i'?m done|send it|that'?s it)\b/i;
  const canvasSpace = (r) => ({ W: 1000, H: Math.max(1, Math.round(1000 * r.height / r.width)) });

  // fresh=true when building a prompt (input values change without DOM mutations)
  function inventory(fresh) {
    if (!fresh) return cached('inv', domVersion, inventoryRaw);
    const r = inventoryRaw(); memo.inv = { v: domVersion, t: Date.now(), r }; return r;
  }
  function inventoryRaw() {
    const items = [];
    if (onJoinScreen()) return items;
    const seen = new Set();
    const add = (el, kind, desc, extra) => {
      if (seen.has(el) || items.length >= 100) return;
      seen.add(el);
      items.push({ el, kind, desc, ...extra });
    };
    const nodes = document.querySelectorAll('textarea, input, select, button, [role="button"], [role="radio"], [role="option"], [role="checkbox"], [contenteditable="true"], canvas, [data-color], [class*="color" i], [class*="swatch" i], [class*="choice" i], [class*="option" i], [class*="word" i]');
    for (const el of nodes) {
      if (items.length >= 100) break; // enough - don't keep measuring the rest of the page
      // one layout read + one style read per element, reused below
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0 || r.top > innerHeight * 3) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
      const tag = el.tagName;
      if (tag === 'TEXTAREA' || (tag === 'INPUT' && /^(text|search|email|)$/i.test(el.type || ''))) {
        if (el.disabled || el.readOnly) continue;
        add(el, 'text', `text box placeholder="${clean(el.placeholder, 80)}" maxlength=${el.maxLength > 0 ? el.maxLength : 'none'} current="${clean(el.value, 120)}"`);
      } else if (el.isContentEditable && tag !== 'BODY') {
        add(el, 'text', `editable text area current="${clean(el.innerText, 120)}"`, { editable: true });
      } else if (tag === 'INPUT' && /^(number|tel|range)$/i.test(el.type)) {
        if (el.disabled) continue;
        add(el, 'number', `${el.type === 'range' ? 'slider' : 'number box'} min=${el.min || '?'} max=${el.max || '?'} step=${el.step || 1} current=${el.value} ${clean(el.getAttribute('aria-label') || el.placeholder, 60)}`);
      } else if (tag === 'INPUT' && /^(radio|checkbox)$/i.test(el.type)) {
        const lbl = el.labels && el.labels[0] ? el.labels[0].innerText : el.value;
        add(el, 'click', `${el.type} "${clean(lbl, 120)}"${el.checked ? ' (checked)' : ''}`);
      } else if (tag === 'SELECT') {
        const o = [...el.options].slice(0, 40).map((x) => `${x.value}=${clean(x.text, 30)}`).join(', ');
        add(el, 'number', `dropdown current=${el.value} options: ${o}`);
      } else if (tag === 'CANVAS') {
        if (r.width < 120 || r.height < 120) continue;
        const { W, H } = canvasSpace(r);
        add(el, 'canvas', `canvas (drawing area) ${Math.round(r.width)}x${Math.round(r.height)}px - draw coords x 0-${W}, y 0-${H}`);
      } else if (tag !== 'INPUT') {
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
        const img = el.querySelector('img');
        // textContent needs no layout (innerText does); visible buttons rarely hide text
        const text = clean(el.textContent || el.getAttribute('aria-label') || el.title || (img && img.alt), 160);
        const color = solidColor(el, cs);
        const btnish = tag === 'BUTTON' || el.getAttribute('role') || el.onclick || cs.cursor === 'pointer';
        const cls = typeof el.className === 'string' ? el.className : '';
        const state = el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-checked') === 'true' || /\b(selected|active|chosen)\b/i.test(cls) ? ' (selected)' : '';
        if (!text && color && r.width <= 90 && r.height <= 90) {
          add(el, 'swatch', `color swatch ${color}${state}`, { color });
        } else if (text && btnish) {
          add(el, 'click', `button "${text}"${state}`);
        } else if (!text && btnish && r.width <= 120) {
          add(el, 'click', `icon button${el.querySelector('img, svg') ? ' (image)' : ''}${cls ? ' class=' + clean(cls, 40) : ''}${state}`);
        }
      }
    }
    // drop a clickable wrapper whose label equals a clickable child's - only compare items that share a label
    const byDesc = new Map();
    for (const it of items) if (it.kind === 'click') { const g = byDesc.get(it.desc); if (g) g.push(it); else byDesc.set(it.desc, [it]); }
    const drop = new Set();
    for (const g of byDesc.values()) if (g.length > 1) for (const a of g) for (const o of g) if (a !== o && a.el.contains(o.el)) drop.add(a);
    return drop.size ? items.filter((it) => !drop.has(it)) : items;
  }

  function guessSubmit(items) {
    const i = items.findIndex((it) => it.kind === 'click' && SUBMIT_RE.test(it.desc.replace(/^button "/, '')));
    return i === -1 ? null : i;
  }

  function toJpegB64(source, w, h, maxDim) {
    const s = Math.min(1, (maxDim || 512) / Math.max(w, h));
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

  function screenImages(withImgs) {
    const out = [];
    for (const el of document.querySelectorAll(withImgs ? 'canvas, img' : 'canvas')) {
      if (out.length >= 3) break;
      if (el.closest('#jbai-host') || !isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 80) continue;
      try {
        if (el.tagName === 'CANVAS') { if (canvasHasInk(el)) out.push(toJpegB64(el, el.width, el.height)); }
        else if (el.complete && el.naturalWidth) out.push(toJpegB64(el, el.naturalWidth, el.naturalHeight));
      } catch (_) { /* cross-origin - skip */ }
    }
    return out;
  }

  const screenTextRaw = () => (document.body.innerText || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
  const screenText = (fresh) => { if (!fresh) return cached('text', domVersion, screenTextRaw); const r = screenTextRaw(); memo.text = { v: domVersion, t: Date.now(), r }; return r; };

  function screenKind(items) {
    const drawCue = items.some((i) => i.kind === 'swatch') || /\b(draw|sketch|doodle|paint|design|decorate)/i.test(screenText());
    if (drawCue && items.some((i) => i.kind === 'canvas')) return 'draw';
    if (items.some((i) => i.kind === 'text' || i.kind === 'number')) return 'write';
    if (items.filter((i) => i.kind === 'click').length >= 2) return 'pick';
    return 'none';
  }

  function readContext(tweak) {
    const items = inventory(true);
    const text = screenText(true);
    const game = detectGame(text, true);
    const kind = screenKind(items);
    const pictureGame = kind === 'draw' || (!!game && PICTURE_GAMES.has(game.id));
    const images = screenImages(pictureGame);
    let tv = false;
    if (tvShot) { // a TV photo belongs to the screen it was taken on
      if (screenNorm().includes(tvShot.screen)) { images.unshift(tvShot.data); tv = true; } else tvShot = null;
    }
    return { screenText: text, items, submitGuess: guessSubmit(items), images: images.slice(0, 4), tv, tweak, game, kind, accuracy: isAccuracy(game), search: settings.webSearch && !!game && SEARCH_GAMES.has(game.id) };
  }

  // ===========================================================================
  // Prompt
  // ===========================================================================
  const SYSTEM_PROMPT = `You are the best Jackbox Party Pack player alive, controlling one player's phone (jackbox.tv). Goal: win - votes, points, money, survival.

You get the phone's visible text, a numbered list of interactive ELEMENTS, sometimes images, the detected game + expert playbook, and earlier rounds. Work out the phase, then return ranked OPTIONS; each option is a list of ACTIONS the phone performs.

ACTIONS (reference elements by [index]):
- {"do":"type","el":i,"text":"..."}       fill a text box (obey maxlength)
- {"do":"set","el":i,"value":42}          slider / number box / dropdown (within min-max; dropdown = option value)
- {"do":"click","el":i}                   tap a button / choice / word / swatch (several clicks in order are fine, e.g. tapping word-bank words)
- {"do":"draw","el":i,"shapes":[...]}     draw on a canvas
Never put the final Submit/Send/Done in actions - give its index as "submit".
If the screen has several text boxes (Thriplash, two-part answers, etc.), EVERY option must fill EVERY box - one "type" action per box.

GAME DATA (when present) is the raw state Jackbox sent to this phone - prompts, choices, player names, scores, sometimes details not drawn on screen. Trust it over guesses; never invent data. The CASE FILE is every screen this phone saw this game plus the player's own notes.
TRUTH: if you have a web search tool, use it to verify facts (trivia, Fibbage/Lie Swatter truths, years, percentages) and say the real answer in advice. Never claim to know a hidden server-side secret (who the faker/alien is) unless it is in the data.

AUDIENCE IS EVERYTHING: the goal is not "a funny joke", it is the answer THIS room will laugh hardest at and vote for. Before writing, read the room from: THE ROOM description, player names and how they talk, the ROOM READ SO FAR, and WHAT THIS ROOM REWARDED (results screens showing which answers got votes, likes or a QUIPLASH). Lean into the humor style that has been winning here and away from what flopped. If you know nothing about the room yet, aim for jokes that land with almost any group of friends: relatable, specific, surprising. Never write a joke only you would find funny, and never pick shock that this crowd won't enjoy.

COMEDY: silently brainstorm 15+ ideas, throw away the first 5 (everyone else writes those), return the best. Specific beats generic (real brands, celebrities, places, oddly precise numbers). Short. Funniest word LAST. Misdirection, escalation, brutal honesty, callbacks, roast players by name (names are on screen). Every option a different angle. COMMIT to the bit: no hedging, no disclaimers, no apologies, no softening. The humor level sets how FAR you may go, not how far you must go: pick the angle that will actually get the most laughs and votes for THIS prompt - sometimes that is filthy or dark, often it is clever, absurd or painfully relatable. If a clean answer is funnier, it wins - never choose the inappropriate one just because it is allowed. Across the options, mix angles (e.g. one dark, one clever, one absurd) and rank the funniest first. When dark is the right call at Edgy/Unhinged, go all the way within the one hard line (no slurs, and nothing whose punchline is that a race, religion, sexuality or disability is bad) - never water a good dark joke down. For trivia/estimates/logic: be CORRECT - think carefully, humor irrelevant.

Respond with ONLY a JSON object (no markdown, no comments):
{"game":"<game - phase>","advice":"<one short sentence, or empty>","submit":<submit button index or null>,"suspects":[{"name":"<player>","prob":<0-100>,"why":"<evidence>"}] (ONLY in social-deduction games; probabilities across players should sum to ~100; otherwise omit),
 "badges":[{"el":<element index>,"text":"<max 24 chars>"}] (short labels pinned ON the game screen over that element: "💰 worth ~$2,400" on items to bid on, "✅ correct" on the right trivia choice, "🎯 87% real" on each Fibbage/Drawful choice, "JO 70%" on player buttons, "set to 42" on a slider, "max bid $1,800" on a bid box - add them whenever per-element info helps the player decide at a glance),
 "options":[{"label":"<2-5 word title>","text":"<the answer as the player should see it>","score":<1-10 predicted crowd reaction or confidence>,"why":"<short reason, only if asked>","actions":[...]}]}
 Optional top-level "room": one short line updating your read of what this crowd finds funny (e.g. "loves absurd + roasting Mike, groans at gross-out"); include it whenever you learn something new.
Lobby/waiting screen: "options":[] and a short advice.`;

  // Only sent when the screen has a canvas - keeps every other request smaller and faster
  const DRAW_RULES = `DRAWING: canvas coords x 0-1000, y 0-H (H given per canvas). Shapes in order:
  {"line":[x1,y1,x2,y2,...]} (many points for curves) | {"poly":[x1,y1,...],"fill":true} | {"circle":[cx,cy,r],"fill":true} | {"ellipse":[cx,cy,rx,ry],"fill":true} | {"rect":[x,y,w,h],"fill":true}
Optional per shape: "color": <swatch element index> (stays selected until changed - set it whenever it changes), "brush": <brush-size element index>. "fill" scribble-fills.
Craft (this is what makes it look good) - build in layers:
  1) big FILLED main shapes in realistic colors (skin tone, sky blue, grass green, wood brown...),
  2) secondary filled shapes (clothes, hair, props, background hint),
  3) dark outlines traced over the main shapes,
  4) faces/features: eyes + an expressive mouth, readable at a glance,
  5) the ONE detail that makes the prompt obvious or sells the joke.
BIG and centered (~80% of the canvas). Nothing smaller than ~20 units (it vanishes on a phone). Use 3-5 colors from the swatches (tap a swatch with "color" when it changes); if there are no swatches, use outlines + a few fills. Curves need 8+ points. 15-60 shapes, at most ~12 filled ones (fills are slow). No written words unless the game wants labels. Only use a "brush" index if you are sure that element is a brush-size button.`;

  const DRAW_NOTES = {
    bidiots: 'BIDIOTS: your painting is valued by how well it matches the prompt - draw EXACTLY the prompt, clear and recognizable, no jokes that change its meaning.',
    drawful: 'DRAWFUL: make the prompt guessable - the key identifying element front and center, not too literal, not abstract.',
    teeko: 'TEE K.O.: a bold, iconic, funny centered image that works with many slogans (it goes on a T-shirt).',
    champdup: "CHAMP'D UP: a full character (head, body, pose, outfit) that embodies the category; exaggerate the trait.",
    civic: 'CIVIC DOODLE: ADD to the existing drawing (see attached image) - do not redraw it; put your addition where it is funniest.',
    patently: 'PATENTLY STUPID: an invention diagram - big clear device, short labels are fine.',
    weapons: 'WEAPONS DRAWN: a weapon whose shape secretly hides one letter of your name.',
    cookiehaus: 'COOKIE HAUS: decorate the cookie with bold, readable icing shapes.',
    nonsensory: 'NONSENSORY: calibrate the drawing to the exact number on the scale.',
  };

  function buildUserText(ctx) {
    const L = [];
    L.push('PHONE SCREEN TEXT:\n"""\n' + ctx.screenText + '\n"""');
    L.push('\nELEMENTS:');
    if (!ctx.items.length) L.push('  (none)');
    ctx.items.forEach((it, i) => L.push(`  [${i}] ${it.desc}`));
    if (ctx.images.length) L.push(`\n(${ctx.images.length} image(s) attached.)`);
    if (ctx.tv) L.push('The FIRST image is a PHOTO OF THE TV / BIG SCREEN taken by the player - it shows what is on the main screen (paintings to bid on, the drawing to caption or guess, shirts/champions in a battle, answers to vote on). Read it carefully and base your answer and badges on it.');
    if (ctx.game) L.push(`\nDETECTED GAME: ${ctx.game.name}${ctx.game.via === 'connection' ? ' (certain - from the room data)' : ''}\nPLAYBOOK: ${ctx.game.guide}`);
    else L.push(`\nGAME: ${appTag ? 'room app tag "' + appTag + '" - ' : ''}not in my list - infer it from the screen (any Jackbox Party Pack 1-11 game or standalone).`);
    const xr = settings.readConnection ? xrayScan() : { fields: [] };
    if (xr.fields.length) L.push('\nX-RAY (values the game sent to this phone, possibly not shown on screen - use them, e.g. prices/worth for bidding, correct flags for trivia):\n' + xr.fields.slice(0, 30).map((f) => `  ${clean(f.path, 90)} = ${JSON.stringify(f.value)}`).join('\n'));
    const gd = gameData();
    if (gd) L.push('\nGAME DATA (from this phone\'s connection):\n' + gd);
    const obs = loadObs();
    const wantCase = ctx.detective || isDeduction(ctx.game);
    if (obs.length) {
      L.push(`\nCASE FILE (${wantCase ? 'full' : 'recent'}):`);
      obs.slice(wantCase ? -25 : -3).forEach((o) => L.push(o.note ? `  NOTE from player: ${o.note}` : `  SCREEN: ${clean(o.text, wantCase ? 500 : 220)}`));
    }
    if (ctx.game && ctx.game.id === 'bidiots') L.push('\n' + bidLedgerText(ctx.items, ctx.screenText));
    const truths = truthGame(ctx.game) ? loadTruths() : [];
    if (truths.length) L.push('\nCONFIRMED REAL ANSWERS (the game itself rejected these as lies, so they ARE the truth for their question): ' + truths.slice(-5).map((x) => '"' + clean(x.truth, 80) + '"').join(', ') + '. When voting, a choice matching one of these is the truth - pick it with score 10. When writing lies, never use these.');
    if (ctx.accuracy) L.push('\nACCURACY MODE: correctness is everything here. Ignore humor level and voice. Reason carefully, double-check, and only then answer. Give your confidence % in advice.');
    if (isDeduction(ctx.game) && !ctx.tweak) L.push('\n' + DETECTIVE);
    if (wantCase) {
      const sus = loadSusList();
      if (sus.length) L.push('\nPRIOR SUSPICION (your running estimate so far - update it with the new evidence, do not just repeat it):\n' + sus.map((x) => `  ${x.name}: ${x.prob}%`).join('\n'));
      L.push('\nReturn a "suspects" array covering every remaining player: "name", "prob" (0-100, your UPDATED probability they are the impostor given all evidence), "why". Probabilities should sum to about 100. Build on the prior suspicion rather than resetting it.');
    }
    const mem = settings.memory ? loadMemory() : [];
    if (mem.length) {
      L.push('\nEARLIER THIS GAME (callbacks welcome, never repeat):');
      mem.slice(-10).forEach((m) => L.push(`  - ${clean(m.prompt, 140)} -> used: ${clean(m.answer, 100)}`));
    }
    L.push('\nHUMOR LEVEL: ' + SPICE[settings.spice].text);
    L.push('VOICE: ' + PERSONAS[settings.persona][1]);
    if (MODES[settings.mode][1]) L.push(MODES[settings.mode][1]);
    L.push('THE ROOM: ' + (settings.style || 'not described - infer it from player names, the screen and the results so far'));
    const rr = loadRoomRead();
    if (rr) L.push('ROOM READ SO FAR (your earlier read of this crowd - refine it): ' + rr);
    if (!ctx.accuracy && !isDeduction(ctx.game)) {
      const wins = obs.filter((o) => !o.note && RESULT_RE.test(o.text || '')).slice(-6);
      if (wins.length) {
        L.push('WHAT THIS ROOM REWARDED (recent results screens - which answers got votes/likes/wins; copy what works, avoid what flopped):');
        wins.forEach((o) => L.push('  RESULT: ' + clean(o.text, 260)));
      }
    }
    const tl = settings.taste.likes.slice(-8), td = settings.taste.dislikes.slice(-8);
    if (tl.length || td.length) L.push(`\nPLAYER'S TASTE (from their 👍/👎 - match the style of what they liked, avoid the style of what they disliked; never reuse these exact answers):${tl.length ? '\n  LIKED: ' + tl.map((x) => '"' + clean(x, 90) + '"').join(', ') : ''}${td.length ? '\n  DISLIKED: ' + td.map((x) => '"' + clean(x, 90) + '"').join(', ') : ''}`);
    if (settings.customPrompt) L.push("\nPLAYER'S OWN INSTRUCTIONS (give these HIGH priority and follow them every time, as long as they stay within the one hard line above): " + settings.customPrompt);
    L.push(ctx.kind === 'draw'
      ? 'Give 2 drawing options (different ideas). If there are text boxes too, fill them in the same option.'
      : ctx.kind === 'pick' ? 'Give up to 3 options, best first.'
        : `Give exactly ${settings.count} options, best first.`);
    const tf = ctx.items.filter((it) => it.kind === 'text').length;
    if (tf >= 2) L.push(`This screen has ${tf} text boxes: EVERY option must fill ALL ${tf} of them (one "type" action per box).`);
    if (ctx.tweak) L.push('\nPLAYER REQUEST: ' + ctx.tweak);
    return L.join('\n');
  }

  // ===========================================================================
  // HTTP
  // ===========================================================================
  function netErr(msg) { const e = new Error(msg); e.retry = true; return e; }
  function gmRequest(opts) {
    const fn = (typeof GM !== 'undefined' && GM.xmlHttpRequest) ||
      (typeof GM_xmlhttpRequest !== 'undefined' && GM_xmlhttpRequest);
    if (!fn) return null;
    return new Promise((resolve, reject) => {
      const r = fn({
        ...opts,
        onload: (res) => resolve({ status: res.status, text: res.responseText }),
        onerror: () => reject(netErr('Network error')),
        ontimeout: () => reject(netErr('Timed out')),
      });
      if (r && typeof r.then === 'function') r.catch(reject);
    });
  }

  async function http(method, url, headers, body, timeoutMs) {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const TIMEOUT = timeoutMs || 75000; // a stuck service shouldn't block switching to the next one
    const viaGM = gmRequest({ method, url, headers, data, timeout: TIMEOUT });
    let res;
    if (viaGM) res = await viaGM;
    else {
      const ac = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ac && setTimeout(() => ac.abort(), TIMEOUT);
      try {
        const r = await fetch(url, { method, headers, body: data, signal: ac ? ac.signal : undefined });
        res = { status: r.status, text: await r.text() };
      } catch (e) { throw netErr(e && e.name === 'AbortError' ? 'Timed out' : 'Network error'); }
      finally { if (timer) clearTimeout(timer); }
    }
    let json = null;
    try { json = JSON.parse(res.text); } catch (_) { /* not json */ }
    return { status: res.status, text: res.text, json };
  }

  function apiErr(provider, res) {
    const j = res.json || {};
    const raw = (j.error && (j.error.message || j.error)) || j.message || res.text || '';
    const e = new Error(`${provider}: ${res.status} ${clean(typeof raw === 'string' ? raw : JSON.stringify(raw), 160)}`);
    e.status = res.status;
    e.retry = res.status === 429 || res.status >= 500 || res.status === 408;
    e.auth = res.status === 401 || res.status === 403;
    return e;
  }

  // ===========================================================================
  // AI providers
  // ===========================================================================
  const PROVIDERS = {
    claude: { label: 'Claude', keyName: 'claudeKey' },
    gemini: { label: 'Gemini', keyName: 'geminiKey' },
    groq: { label: 'Groq', keyName: 'groqKey' },
    openrouter: { label: 'OpenRouter', keyName: 'openrouterKey' },
    pollinations: { label: 'Pollinations', keyName: null },
  };
  const AUTO_ORDER = ['claude', 'gemini', 'groq', 'openrouter', 'pollinations'];

  function availableProviders() {
    const has = (p) => !PROVIDERS[p].keyName || !!settings[PROVIDERS[p].keyName];
    const list = AUTO_ORDER.filter(has);
    if (settings.provider !== 'auto' && PROVIDERS[settings.provider] && has(settings.provider)) {
      return [settings.provider, ...list.filter((p) => p !== settings.provider)];
    }
    return list;
  }

  async function cachedModel(provider, pick) {
    const c = settings.modelCache[provider];
    if (c && Date.now() - c.t < 24 * 3600 * 1000) return c.m;
    let m = null;
    try { m = await pick(); } catch (_) { /* use fallback */ }
    if (m) { settings.modelCache[provider] = { m, t: Date.now() }; store.set('modelCache', settings.modelCache); }
    return m;
  }
  function forgetModel(provider) { delete settings.modelCache[provider]; store.set('modelCache', settings.modelCache); }

  async function callClaude(sys, user, images, primary, opt = {}) {
    const content = images.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }));
    content.push({ type: 'text', text: user });
    const model = (primary && settings.customModel) || settings.claudeModel;
    const headers = {
      'content-type': 'application/json',
      'x-api-key': settings.claudeKey,
      'anthropic-version': '2026-10-21',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    const effort = opt.accuracy && settings.effort === 'low' ? 'medium' : settings.effort;
    const body = { model, max_tokens: 16000, system: sys, output_config: { effort }, messages: [{ role: 'user', content }] };
    if (/opus|sonnet/.test(model)) { headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; body.fallbacks = 'default'; }
    if (opt.search) body.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }];
    let res = await http('POST', 'https://api.anthropic.com/v1/messages', headers, body, opt.timeout);
    if (opt.search && res.status === 400) { delete body.tools; res = await http('POST', 'https://api.anthropic.com/v1/messages', headers, body, opt.timeout); }
    if (res.status >= 400 || !res.json) throw apiErr('Claude', res);
    const d = res.json;
    if (d.stop_reason === 'refusal') { const e = new Error('Claude passed on this one'); e.retry = true; e.refusal = true; throw e; }
    return { text: (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'), model };
  }

  async function geminiModel(primary) {
    if (primary && settings.customModel) return settings.customModel;
    return (await cachedModel('gemini', async () => {
      const r = await http('GET', 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { 'x-goog-api-key': settings.geminiKey });
      if (!r.json || !r.json.models) return null;
      const ok = r.json.models
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => m.name.replace(/^models\//, ''))
        .filter((n) => /^gemini-\d+(\.\d+)?-flash(-lite)?$/.test(n));
      const ver = (n) => parseFloat(n.match(/gemini-(\d+(?:\.\d+)?)/)[1]) - (/lite/.test(n) ? 0.05 : 0);
      ok.sort((a, b) => ver(b) - ver(a));
      return ok[0] || null;
    })) || 'gemini-3.8-flash';
  }

  async function callGemini(sys, user, images, primary, opt = {}) {
    const model = await geminiModel(primary);
    const parts = images.map((data) => ({ inline_data: { mime_type: 'image/jpeg', data } }));
    parts.push({ text: user });
    const base = settings.spice >= 3 ? 'BLOCK_ONLY_HIGH' : 'BLOCK_MEDIUM_AND_ABOVE';
    const loose = settings.spice >= 4 ? 'BLOCK_NONE' : base;
    const thresholds = { HARM_CATEGORY_HARASSMENT: loose, HARM_CATEGORY_SEXUALLY_EXPLICIT: loose, HARM_CATEGORY_HATE_SPEECH: base, HARM_CATEGORY_DANGEROUS_CONTENT: base };
    const temperature = opt.accuracy ? 0.2 : settings.mode === 'chaos' ? 1.3 : settings.spice >= 4 ? 1.15 : 1.0;
    const body = {
      systemInstruction: { parts: [{ text: sys }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature, maxOutputTokens: 8192, responseMimeType: 'application/json' },
      safetySettings: Object.entries(thresholds).map(([category, threshold]) => ({ category, threshold })),
    };
    if (opt.search) { body.tools = [{ google_search: {} }]; delete body.generationConfig.responseMimeType; } // grounding can't combine with JSON mode
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const hdr = { 'content-type': 'application/json', 'x-goog-api-key': settings.geminiKey };
    const light = !opt.accuracy && !opt.search; // joke rounds: think less, answer faster
    if (light) body.generationConfig.thinkingConfig = { thinkingLevel: 'low' };
    let res = await http('POST', url, hdr, body, opt.timeout);
    if (light && res.status === 400) { delete body.generationConfig.thinkingConfig; res = await http('POST', url, hdr, body, opt.timeout); } // older model: no thinkingLevel
    if (opt.search && [400, 403, 429].includes(res.status)) { // search quota/unsupported: answer without it
      delete body.tools; body.generationConfig.responseMimeType = 'application/json';
      res = await http('POST', url, hdr, body, opt.timeout);
    }
    if (res.status === 404) forgetModel('gemini');
    if (res.status >= 400 || !res.json) { const e = apiErr('Gemini', res); if (res.status === 404) e.retry = true; throw e; }
    const d = res.json;
    const cand = (d.candidates || [])[0];
    if (!cand || !cand.content) {
      const e = new Error('Gemini blocked this one (' + ((d.promptFeedback && d.promptFeedback.blockReason) || (cand && cand.finishReason) || 'no answer') + ')');
      e.retry = true; e.refusal = true; throw e;
    }
    return { text: (cand.content.parts || []).map((p) => p.text || '').join(''), model };
  }

  const OAI = {
    groq: {
      url: 'https://api.groq.com/openai/v1/chat/completions',
      models: 'https://api.groq.com/openai/v1/models',
      prefer: [/gpt-oss-120b/, /qwen3\.\d+-\d+b/, /llama-4-maverick/, /kimi/, /llama-4-scout/, /llama-3\.3-70b/, /gpt-oss-20b/],
      vision: (m) => /qwen3\.8|llama-4|vision|vl\b/i.test(m),
      fallback: 'openai/gpt-oss-120b',
    },
    openrouter: {
      url: 'https://openrouter.ai/api/v1/chat/completions',
      models: 'https://openrouter.ai/api/v1/models',
      prefer: [/deepseek.*(v3|chat|r1)/, /qwen3/, /llama-4-maverick/, /gemini/, /llama-3\.3-70b/, /gpt-oss/, /gemma/, /mistral/],
      vision: (m) => /vl|vision|llama-4|gemini|gemma-3/i.test(m),
      fallback: 'openrouter/auto',
      freeOnly: true,
    },
    pollinations: {
      url: 'https://text.pollinations.ai/openai',
      vision: () => false,
      fallback: 'openai',
      noJsonMode: true,
    },
  };

  async function oaiModel(p, primary) {
    const cfg = OAI[p];
    if (primary && settings.customModel) return settings.customModel;
    if (!cfg.models) return cfg.fallback;
    return (await cachedModel(p, async () => {
      const r = await http('GET', cfg.models, { authorization: 'Bearer ' + settings[PROVIDERS[p].keyName] });
      const list = (r.json && r.json.data) || [];
      let ids = cfg.freeOnly
        ? list.filter((m) => /:free$/.test(m.id) || (m.pricing && +m.pricing.prompt === 0 && +m.pricing.completion === 0)).map((m) => m.id)
        : list.map((m) => m.id);
      ids = ids.filter((id) => !/whisper|tts|guard|embed|audio|moderation|image|orpheus|playai/i.test(id));
      for (const re of cfg.prefer) { const hit = ids.find((id) => re.test(id)); if (hit) return hit; }
      return ids[0] || null;
    })) || cfg.fallback;
  }

  async function callOAI(p, sys, user, images, primary, opt = {}) {
    const cfg = OAI[p];
    const model = await oaiModel(p, primary);
    const key = PROVIDERS[p].keyName ? settings[PROVIDERS[p].keyName] : '';
    const send = (withImages) => {
      const content = withImages && images.length
        ? [{ type: 'text', text: user }, ...images.map((d) => ({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + d } }))]
        : user;
      const body = {
        model,
        messages: [{ role: 'system', content: sys }, { role: 'user', content }],
        max_tokens: 6000,
        temperature: opt.accuracy ? 0.2 : settings.mode === 'chaos' ? 1.2 : settings.spice >= 4 ? 1.1 : 0.95,
      };
      if (!cfg.noJsonMode) body.response_format = { type: 'json_object' };
      const headers = { 'content-type': 'application/json' };
      if (key) headers.authorization = 'Bearer ' + key;
      if (p === 'openrouter') { headers['HTTP-Referer'] = 'https://jackbox.tv'; headers['X-Title'] = 'Jackbox AI Helper'; }
      return http('POST', cfg.url, headers, body, opt.timeout);
    };
    let res = await send(cfg.vision(model));
    if (res.status === 400 && images.length) res = await send(false); // model can't take images
    if (res.status === 404) forgetModel(p);
    if (res.status >= 400 || !res.json) { const e = apiErr(PROVIDERS[p].label, res); if (res.status === 404) e.retry = true; throw e; }
    const choice = (res.json.choices || [])[0];
    const text = choice && choice.message && (choice.message.content || '');
    if (!text) { const e = new Error(PROVIDERS[p].label + ' returned nothing'); e.retry = true; throw e; }
    return { text, model: res.json.model || model };
  }

  function callProvider(p, sys, user, images, primary, opt) {
    if (p === 'claude') return callClaude(sys, user, images, primary, opt);
    if (p === 'gemini') return callGemini(sys, user, images, primary, opt);
    return callOAI(p, sys, user, images, primary, opt);
  }

  // Robust JSON extraction for less disciplined models
  function extractJSON(text) {
    let t = String(text).replace(/```(?:json)?/gi, '').trim();
    const starts = [...t.matchAll(/\{\s*"(game|options|ok)"/g)];
    const s = starts.length ? starts[starts.length - 1].index : t.indexOf('{');
    if (s === -1) throw new Error('no JSON');
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = s; i < t.length; i++) {
      const c = t[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    t = t.slice(s, end === -1 ? t.lastIndexOf('}') + 1 : end + 1);
    try { return JSON.parse(t); } catch (_) {
      return JSON.parse(t.replace(/,\s*([}\]])/g, '$1'));
    }
  }

  function normalize(obj, ctx) {
    const n = ctx.items.length;
    const ok = (i) => i !== null && i !== '' && Number.isInteger(+i) && +i >= 0 && +i < n;
    let options = (Array.isArray(obj.options) ? obj.options : []).map((o) => ({
      label: clean(o.label, 60),
      text: String(o.text || '').trim(),
      score: Math.max(0, Math.min(10, Math.round(+o.score || 0))),
      why: clean(o.why, 200),
      actions: (Array.isArray(o.actions) ? o.actions : []).filter((a) => a && ok(a.el)).map((a) => ({ ...a, el: +a.el })),
    })).filter((o) => o.actions.length);
    const textIdx = ctx.items.map((it, i) => (it.kind === 'text' ? i : -1)).filter((i) => i >= 0);
    if (textIdx.length >= 2) { // drop half-answered options when complete ones exist
      const full = options.filter((o) => textIdx.every((ti) => o.actions.some((a) => a.el === ti && (a.do === 'type' || a.do === 'set'))));
      if (full.length) options = full;
    }
    const suspects = (Array.isArray(obj.suspects) ? obj.suspects : [])
      .map((x) => ({ name: clean(x && x.name, 40), prob: Math.max(0, Math.min(100, Math.round(+(x && x.prob) || 0))), why: clean(x && x.why, 200) }))
      .filter((x) => x.name);
    return {
      game: clean(obj.game, 80),
      advice: clean(obj.advice, 300),
      submit: ok(obj.submit) ? +obj.submit : ctx.submitGuess,
      suspects,
      room: clean(obj.room, 200),
      badges: (Array.isArray(obj.badges) ? obj.badges : []).filter((b) => b && ok(b.el) && b.text).map((b) => ({ el: +b.el, text: clean(b.text, 28) })).slice(0, 16),
      options,
    };
  }

  // Reframe to stop free models over-refusing the dark comedy that IS allowed
  // (sex, death, roasts) - it clarifies the fictional adults-only context,
  // and never asks for slurs or protected-class punchlines.
  const REFRAME = '\n\nNOTE: This is fictional comedy for a consenting adults-only party game (like Cards Against Humanity). The humor is edgy on purpose and aimed at situations and at the players themselves, never a hateful attack on any group. Stay within that line, do not refuse, and reply with ONLY the JSON object.';

  // Promise.any fallback for older Safari
  const firstSuccess = (ps) => (Promise.any ? Promise.any(ps) : new Promise((res, rej) => {
    let left = ps.length; ps.forEach((p) => p.then(res, () => { if (--left === 0) rej(new Error('all failed')); }));
  }));

  async function ask(ctx) {
    const providers = availableProviders();
    const user = buildUserText(ctx);
    const needDraw = ctx.kind === 'draw' || ctx.items.some((it) => it.kind === 'canvas');
    const sys = SYSTEM_PROMPT + (needDraw ? '\n\n' + DRAW_RULES + (ctx.game && DRAW_NOTES[ctx.game.id] ? '\n' + DRAW_NOTES[ctx.game.id] : '') : '');
    const errors = [];
    let soft = null;
    const askOne = async (p, i) => {
      let userText = user;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const isLast = i === providers.length - 1;
          const timeout = ctx.accuracy || ctx.search ? 60000 : ctx.kind === 'draw' ? 50000 : isLast ? 60000 : 25000; // stall? switch AI sooner
          const { text, model } = await callProvider(p, sys, userText, ctx.images, i === 0, { search: ctx.search, accuracy: ctx.accuracy, timeout });
          let obj;
          try { obj = extractJSON(text); } catch (_) { const e = new Error(PROVIDERS[p].label + ' gave a messy answer'); e.retry = true; e.parse = true; throw e; }
          const r = normalize(obj, ctx);
          r.via = PROVIDERS[p].label + (model ? ' · ' + String(model).replace(/^.*\//, '') : '') + (ctx.search && (p === 'gemini' || p === 'claude') ? ' · 🔎' : '');
          if (!r.options.length && !r.advice && ctx.items.length) { if (!soft) soft = r; const e = new Error(PROVIDERS[p].label + ' had no usable answer'); e.retry = true; throw e; }
          if (r.suspects.length) saveSus(r.suspects);
          if (r.room) saveRoomRead(r.room);
          return r;
        } catch (e) {
          errors.push(e);
          if (e.parse && attempt < 2) continue; // retry on messy JSON
          if (e.refusal && settings.spice >= 3 && userText === user) { userText = user + REFRAME; continue; } // one reframed retry for allowed dark humor
          throw e; // give up on this provider
        }
      }
      throw errors[errors.length - 1] || new Error('failed');
    };
    let start = 0;
    if (settings.race && providers.length >= 2 && !ctx.search) {
      setStatus(`Racing ${PROVIDERS[providers[0]].label} vs ${PROVIDERS[providers[1]].label}…`);
      const runs = [askOne(providers[0], 0), askOne(providers[1], 1)];
      runs.forEach((pr) => pr.catch(() => {}));
      try {
        const first = await firstSuccess(runs);
        runs.forEach((pr) => pr.then((r) => { if (r !== first && ctx.onExtra) ctx.onExtra(r); }, () => {}));
        return first;
      } catch (_) { start = 2; }
    }
    for (let i = start; i < providers.length; i++) {
      setStatus(`Asking ${PROVIDERS[providers[i]].label}…`);
      try { return await askOne(providers[i], i); } catch (_) { /* next provider */ }
    }
    if (soft) { soft.via += ' · best available'; return soft; }
    const last = errors[errors.length - 1];
    if (errors.some((e) => e.refusal)) throw new Error('The AI passed on this one. Tap 😇 Cleaner or lower the humor level.');
    if (errors.some((e) => e.status === 429)) throw new Error('Free AI is rate-limited right now. Wait ~30s, or add another free key in ⚙️ so it can switch.');
    if (errors.some((e) => e.auth)) throw new Error('A key was rejected - check ⚙️ AI keys. (' + clean(last.message, 120) + ')');
    throw new Error(last ? clean(last.message, 200) : 'No AI available - add a key in ⚙️');
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

  function typeInto(it, text) {
    const el = it.el;
    el.focus({ preventScroll: true });
    if (it.editable) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
      return;
    }
    if (el.maxLength > 0) text = text.slice(0, el.maxLength);
    setNative(el, text);
    if (el.value !== text) { // some inputs ignore programmatic values: type it like a keyboard would
      try { el.select(); document.execCommand('insertText', false, text); } catch (_) { /* ignore */ }
      if (el.value !== text) setNative(el, text);
    }
  }

  function setValue(el, value) {
    if (el.tagName === 'INPUT') {
      let v = Number(value);
      if (Number.isNaN(v)) v = parseFloat(String(value).replace(/[^\d.-]/g, '')) || 0;
      if (el.min !== '' && v < +el.min) v = +el.min;
      if (el.max !== '' && v > +el.max) v = +el.max;
      value = String(v);
    } else if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === String(value))) {
      const o = [...el.options].find((x) => x.text.trim().toLowerCase() === String(value).trim().toLowerCase());
      if (o) value = o.value;
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
  let drawMethod = null;

  function shapeToStrokes(shape, rect, space) {
    const sx = rect.width / space.W;
    const sy = rect.height / space.H;
    const P = (x, y) => [rect.left + x * sx, rect.top + y * sy];
    const ring = (cx, cy, rx, ry) => {
      const pts = [];
      const n = Math.max(24, Math.round((Math.abs(rx) * sx + Math.abs(ry) * sy) / 3));
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
    if (!pts || pts.length < 2) return [];
    if (pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return [];
    pts = pts.map(([x, y]) => [Math.min(rect.right - 1, Math.max(rect.left + 1, x)), Math.min(rect.bottom - 1, Math.max(rect.top + 1, y))]);
    const strokes = [];
    if (shape.fill && closed && pts.length > 2) strokes.push(...hatch(pts));
    strokes.push(pts);
    return strokes;
  }

  function hatch(poly) {
    const gap = 4.5;
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
    return strokes.filter((s) => s.length >= 2);
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

  // Ramer-Douglas-Peucker: drop points that don't change the shape (fewer events, smoother lines)
  function simplify(pts, tol) {
    if (pts.length < 3) return pts;
    const sq = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
    const segD = (p, a, b) => { const l = sq(a, b); if (!l) return sq(p, a); let t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / l; t = Math.max(0, Math.min(1, t)); return sq(p, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); };
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]]; const t2 = tol * tol;
    while (stack.length) {
      const [a, b] = stack.pop(); let md = 0, idx = -1;
      for (let i = a + 1; i < b; i++) { const d = segD(pts[i], pts[a], pts[b]); if (d > md) { md = d; idx = i; } }
      if (md > t2 && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }

  function fire(method, phase, target, x, y) {
    if (method === 'combo') { // canvas we can't verify: send every kind of input
      for (const m of ['pointer', 'touch', 'mouse']) { if (m === 'touch' && typeof Touch !== 'function') continue; try { fire(m, phase, target, x, y); } catch (_) { /* ignore */ } }
      return;
    }
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

  async function strokeWith(method, pts, fallbackTarget, step) {
    const natural = settings.drawSpeed === 'natural';
    const path = densify(pts, step || (natural ? 3 : 5));
    const target = targetAt(path[0][0], path[0][1], fallbackTarget);
    fire(method, 'down', target, path[0][0], path[0][1]);
    for (let k = 1; k < path.length; k++) {
      fire(method, 'move', target, path[k][0], path[k][1]);
      if (natural ? k % 2 === 0 : k % 8 === 0) await (natural ? sleep(8) : frame()); // let the game sample the curve
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
    canvas.scrollIntoView({ block: 'center' });
    await frame();
    const rect = canvas.getBoundingClientRect();
    const space = canvasSpace(rect);
    const all = [];
    for (const sh of shapes) {
      if (!sh || typeof sh !== 'object') continue;
      shapeToStrokes(sh, rect, space).forEach((s, k) => all.push({ s, color: k === 0 ? sh.color : undefined, brush: k === 0 ? sh.brush : undefined }));
    }
    if (!all.length) throw new Error('That drawing had no usable shapes - try 🔁');
    // fewer, cleaner points: games can drop or reject very dense drawings
    all.forEach((st) => { st.s = simplify(st.s, 1.2); });
    // pick a point spacing that keeps the whole drawing under ~3500 input events
    const estPts = (stp) => all.reduce((n, st) => { let c = 1; for (let k = 1; k < st.s.length; k++) c += Math.max(1, Math.ceil(Math.hypot(st.s[k][0] - st.s[k - 1][0], st.s[k][1] - st.s[k - 1][1]) / stp)); return n + c; }, 0);
    let step = settings.drawSpeed === 'natural' ? 3 : 5;
    while (estPts(step) > 3500 && step < 120) step *= 1.3; // straight segments don't need dense points
    const startSig = pixelSig();
    const readable = !/^x*$/.test(startSig);
    const methods = ['pointer', 'touch', 'mouse'].filter((m) => m !== 'touch' || typeof Touch === 'function');
    for (let i = 0; i < all.length; i++) {
      if (cancelDraw) return 'cancelled';
      const st = all[i];
      for (const key of ['brush', 'color']) {
        const idx = st[key];
        if (idx !== undefined && idx !== null && Number.isInteger(+idx) && items[+idx] && items[+idx].el.isConnected) { tap(items[+idx].el); await sleep(40); }
      }
      if (!drawMethod) {
        let found = null;
        for (const m of methods) {
          const before = pixelSig();
          try { await strokeWith(m, st.s, canvas, step); } catch (_) { continue; }
          await frame(); await frame(); await sleep(150);
          if (pixelSig() !== before) { found = m; break; }
        }
        drawMethod = found || 'combo'; // nothing confirmed: send every input type from now on
      } else {
        await strokeWith(drawMethod, st.s, canvas, step);
      }
      onProgress(i + 1, all.length);
    }
    await frame(); await sleep(150);
    if (readable && pixelSig() === startSig) { drawMethod = null; return 'unconfirmed'; } // nothing appeared on the canvas
    return 'done';
  }

  // --------------------------- run an option --------------------------------
  const promptSummary = (ctx) => ctx.screenText.split('\n').filter((l) => l.trim().length > 3).slice(0, 4).join(' / ');
  const typedOf = (o) => o.actions.filter((a) => a.do === 'type').map((a) => String(a.text || ''));

  async function execute(opt, ctx, submit) {
    let drew = false;
    let unconfirmed = false;
    // snapshot fields we're about to change, for ↩️ Undo
    const snap = [];
    opt.actions.forEach((a) => {
      const it = ctx.items[a.el];
      if (it && (a.do === 'type' || a.do === 'set') && (it.kind === 'text' || it.kind === 'number') && !snap.some((x) => x.it === it)) snap.push({ it, prev: it.editable ? it.el.innerText : it.el.value });
    });
    if (snap.length) lastUndo = snap;
    for (const a of opt.actions) {
      const it = ctx.items[a.el];
      if (!it || !it.el.isConnected) { const e = new Error('The screen changed'); e.changed = true; throw e; }
      if (a.do === 'type') {
        if (it.kind === 'number') setValue(it.el, a.text);
        else if (it.kind === 'text') typeInto(it, String(a.text || ''));
        else { tap(it.el); await sleep(120); }
      } else if (a.do === 'set') {
        if (it.kind === 'text') typeInto(it, String(a.value)); else setValue(it.el, a.value);
      } else if (a.do === 'click') { tap(it.el); await sleep(150); }
      else if (a.do === 'draw' && it.kind === 'canvas' && Array.isArray(a.shapes)) {
        drew = true;
        cancelDraw = false;
        setDrawing(true);
        try {
          const r = await draw(it.el, a.shapes, ctx.items, (k, n) => { fab.dataset.p = Math.round((k / n) * 100) + '%'; });
          if (r === 'cancelled') { toast('Drawing stopped'); return false; }
          if (r === 'unconfirmed') { unconfirmed = true; showTraceGuide(it.el, a.shapes, ctx, a.el); }
        } finally { setDrawing(false); }
      }
      await sleep(30);
    }
    try {
      const now = inventory();
      now.forEach((i) => { if (i.kind === 'text' && fieldVal(i)) rememberTyped(fieldVal(i)); });
      answeredPrompt = promptKey();
    } catch (_) { /* ignore */ }
    remember({ prompt: promptSummary(ctx), answer: typedOf(opt).join(' / ') || opt.text || opt.label || (drew ? 'a drawing' : ''), game: ctx.game && ctx.game.name });
    bumpStat(drew ? 'drawings' : ctx.kind === 'pick' ? 'picks' : 'answers');
    if (unconfirmed) { toast('✏️ This game didn\'t take the auto-drawing - trace the guide, then Submit'); return true; }
    if (submit && Number.isInteger(ctx.result.submit)) {
      const s = ctx.items[ctx.result.submit];
      if (s && s.el.isConnected) { await sleep(250); tap(s.el); toast('Submitted ✅'); return true; }
    }
    toast(drew ? 'Drawn ✅ check it, then Submit' : 'Done ✅ now hit Submit');
    return true;
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
  // UI
  // ===========================================================================
  const host = document.createElement('div');
  host.id = 'jbai-host';
  const root = host.attachShadow({ mode: 'open' });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const optionTags = (obj) => Object.entries(obj).map(([k, v]) => `<option value="${k}">${esc(v[0])}</option>`).join('');

  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: -apple-system, system-ui, sans-serif; -webkit-tap-highlight-color: transparent; }
      a { color: #a99bff; }
      .fab { position: fixed; z-index: 2147483647; width: 56px; height: 56px; border-radius: 50%; border: 2px solid rgba(255,255,255,.3);
             background: linear-gradient(135deg,#7b5cff,#ff4fa3); color: #fff; font-size: 25px; touch-action: none; right: 14px; bottom: 14px;
             box-shadow: 0 4px 18px rgba(123,92,255,.55); transition: transform .15s; }
      .fab:active { transform: scale(.92); }
      .fab.busy { animation: spin 1s linear infinite; }
      .fab.drawing { animation: none; background: #ff3b5c; font-size: 20px; }
      .fab.drawing::after { content: attr(data-p); position: absolute; bottom: -18px; left: 0; right: 0; text-align: center; font-size: 11px; font-weight: 700; color: #fff; text-shadow: 0 1px 2px #000; }
      .fab .dot { position: absolute; top: -2px; right: -2px; width: 15px; height: 15px; border-radius: 50%; background: #2ee66b; border: 2px solid #111; display: none; }
      .fab.ready .dot { display: block; }
      .fab .badge { position: absolute; bottom: -4px; left: -4px; font-size: 14px; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .panel { position: fixed; z-index: 2147483646; left: 8px; right: 8px; bottom: 80px; max-height: 74vh; overflow: auto; -webkit-overflow-scrolling: touch;
               background: rgba(18,18,26,.97); color: #f2f2f7; border-radius: 18px; padding: 12px; border: 1px solid #2c2c3a;
               box-shadow: 0 12px 44px rgba(0,0,0,.65); display: none; font-size: 15px; }
      .panel.open { display: block; animation: up .18s ease-out; }
      @keyframes up { from { transform: translateY(12px); opacity: 0; } }
      .row { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
      .title { font-weight: 800; flex: 1; font-size: 16px; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .muted { color: #9d9db0; font-size: 13px; }
      .err { color: #ff6b6b; }
      .chips { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 6px; margin-bottom: 4px; scrollbar-width: none; }
      .chip { flex: 0 0 auto; background: #262634; color: #fff; border: 1px solid #3a3a4c; border-radius: 999px; padding: 7px 11px; font-size: 13px; }
      .chip.on { background: #7b5cff; border-color: #7b5cff; }
      .chip.game { background: #3b2a66; border-color: #7b5cff; }
      .gamebar { margin-bottom: 8px; }
      .gameband { display: flex; align-items: center; gap: 8px; background: linear-gradient(135deg,#2a1f52,#3a1f44); border: 1px solid #7b5cff; border-radius: 12px; padding: 9px 11px; }
      .gameband .gn { font-weight: 800; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .gameband .gm { font-size: 12px; color: #cfc6ff; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .autobtn { flex: 0 0 auto; background: #3a3a4c; color: #fff; border: 1px solid #555; border-radius: 999px; padding: 7px 12px; font-size: 13px; font-weight: 700; }
      .autobtn.auto { background: linear-gradient(135deg,#2ee66b,#13b34f); color: #042; border-color: #2ee66b; }
      .autobtn.ready { background: linear-gradient(135deg,#ffd24a,#f0a500); color: #3a2600; border-color: #ffd24a; }
      .card { background: #20202c; border: 1px solid #353546; border-radius: 14px; margin: 8px 0; overflow: hidden; }
      .card.best { border-color: #7b5cff; box-shadow: 0 0 0 1px #7b5cff inset; }
      .card .use { display: block; width: 100%; text-align: left; background: none; color: #fff; border: none; padding: 11px 12px 6px; font-size: 16px; line-height: 1.3; }
      .card .use:active { background: #33305a; }
      .card .lbl { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #a99bff; margin-bottom: 3px; }
      .card .f { display: block; white-space: pre-wrap; }
      .card .f + .f { margin-top: 5px; padding-top: 5px; border-top: 1px dashed #444; }
      .card .why { display: block; font-size: 12px; color: #b8b0e8; margin-top: 5px; }
      .card svg { display: block; width: 100%; max-height: 220px; background: #fff; border-radius: 10px; margin-top: 4px; }
      .card .meta { display: flex; gap: 6px; padding: 2px 8px 9px 12px; align-items: center; flex-wrap: wrap; }
      .card .meta .n { flex: 1; color: #7d7d92; font-size: 12px; }
      .card .meta .n.over { color: #ff6b6b; }
      .mini { background: #30303f; color: #ddd; border: none; border-radius: 8px; padding: 6px 9px; font-size: 13px; }
      .mini.go { background: #2ee66b; color: #052; font-weight: 700; }
      .btn { background: #30303f; color: #fff; border: none; border-radius: 9px; padding: 8px 10px; font-size: 14px; flex: 0 0 auto; }
      .btn.primary { background: linear-gradient(135deg,#7b5cff,#ff4fa3); font-weight: 700; }
      input, select { background: #0c0c12; color: #fff; border: 1px solid #3a3a4c; border-radius: 9px; padding: 9px; font-size: 16px; }
      .row input[type=text] { flex: 1; min-width: 0; }
      label { display: block; margin: 12px 0 4px; font-size: 13px; color: #c0c0d2; }
      label.ck { display: flex; gap: 8px; align-items: center; font-size: 14px; color: #e0e0ee; }
      .settings input[type=text], .settings input[type=password], .settings select, .settings textarea { width: 100%; }
      textarea { background: #0c0c12; color: #fff; border: 1px solid #3a3a4c; border-radius: 9px; padding: 9px; font-size: 16px; font-family: inherit; resize: vertical; }
      .seg { display: flex; gap: 4px; flex-wrap: wrap; }
      .seg button { flex: 1 1 22%; padding: 8px 2px; font-size: 12px; }
      .advice { background: #2a2540; border-radius: 10px; padding: 8px 10px; margin: 6px 0; font-size: 14px; }
      .meter { background: #221c34; border: 1px solid #4a3a6e; border-radius: 10px; padding: 9px 10px; margin: 6px 0; }
      .susrow { display: flex; align-items: center; gap: 8px; margin: 4px 0 1px; font-size: 14px; }
      .susname { flex: 0 0 72px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .susbar { flex: 1; height: 10px; background: #15111f; border-radius: 6px; overflow: hidden; }
      .susbar > span { display: block; height: 100%; background: linear-gradient(90deg,#7b5cff,#ff4fa3); }
      .suspct { flex: 0 0 38px; text-align: right; font-variant-numeric: tabular-nums; color: #cfc6ff; }
      .suswhy { font-size: 12px; color: #9d9db0; margin: 0 0 5px 80px; }
      .section { font-weight: 800; font-size: 14px; margin: 16px 0 2px; color: #fff; border-top: 1px solid #2c2c3a; padding-top: 12px; }
      .free { background: #12351f; color: #6ff0a0; border-radius: 6px; padding: 1px 6px; font-size: 11px; margin-left: 4px; }
      .paid { background: #3a2a12; color: #f0c06f; border-radius: 6px; padding: 1px 6px; font-size: 11px; margin-left: 4px; }
      ul { margin: 6px 0; padding-left: 20px; }
      li { margin: 3px 0; }
      .hist { background: #20202c; border-radius: 10px; padding: 8px 10px; margin: 6px 0; font-size: 14px; }
      .hud { position: fixed; inset: 0; pointer-events: none; z-index: 2147483645; }
      .hb { position: fixed; transform: translate(-50%, -100%); background: rgba(24,18,44,.94); color: #fff; border: 1px solid #7b5cff;
            font-size: 12px; font-weight: 800; padding: 3px 9px; border-radius: 999px; white-space: nowrap; box-shadow: 0 3px 10px rgba(0,0,0,.45);
            animation: pop .22s ease-out; max-width: 70vw; overflow: hidden; text-overflow: ellipsis; }
      .hb.below { transform: translate(-50%, 0); }
      .hb.best { background: linear-gradient(135deg,#2ee66b,#13b34f); color: #042; border-color: #2ee66b; }
      .hb.data { background: linear-gradient(135deg,#21c7ff,#2a6dff); color: #fff; border-color: #6fd8ff; }
      .ring { position: fixed; border: 3px solid #2ee66b; border-radius: 12px; box-shadow: 0 0 14px rgba(46,230,107,.75); animation: glow 1.4s ease-in-out infinite; }
      @keyframes pop { from { opacity: 0; transform: translate(-50%, -80%) scale(.7); } }
      @keyframes glow { 50% { box-shadow: 0 0 3px rgba(46,230,107,.3); } }
      .hudpill { position: fixed; z-index: 2147483646; bottom: 24px; left: 10px; max-width: calc(100vw - 96px); background: rgba(20,16,36,.95);
                 color: #fff; border: 1px solid #7b5cff; border-radius: 14px; padding: 7px 12px; font-size: 13px; font-weight: 700; white-space: normal; text-align: left;
                 line-height: 1.35; max-height: 5.2em; overflow: hidden; box-shadow: 0 6px 20px rgba(0,0,0,.5); animation: pop .22s ease-out; }
      .card.best { animation: bestglow 2.2s ease-in-out infinite; }
      @keyframes bestglow { 50% { box-shadow: 0 0 0 1px #7b5cff inset, 0 0 16px rgba(123,92,255,.55); } }
      .trace { position: fixed; opacity: .5; pointer-events: none; outline: 2px dashed #ff4fa3; outline-offset: 2px; }
      .trace svg { width: 100%; height: 100%; display: block; }
      .traceclose { position: fixed; z-index: 2147483646; background: #ff4fa3; color: #fff; border: none; border-radius: 999px; padding: 6px 11px; font-size: 12px; font-weight: 800; box-shadow: 0 3px 10px rgba(0,0,0,.4); }
      .xr { font-family: ui-monospace, Menlo, monospace; font-size: 12px; white-space: pre-wrap; word-break: break-all; background: #0c0c12; border-radius: 10px; padding: 8px; max-height: 40vh; overflow: auto; }
      .toast { position: fixed; z-index: 2147483647; left: 50%; bottom: 150px; transform: translateX(-50%); background: rgba(0,0,0,.88); color: #fff;
               padding: 9px 15px; border-radius: 18px; font-size: 14px; display: none; max-width: 90vw; width: max-content; text-align: center; line-height: 1.3; }
    </style>
    <button class="fab" title="Jackbox AI Helper">✨<span class="dot"></span><span class="badge"></span></button>
    <div class="toast"></div>
    <div class="hud"></div>
    <input type="file" accept="image/*" capture="environment" class="tvcam" style="display:none">
    <button class="hudpill" style="display:none"></button>
    <div class="panel">
      <div class="row">
        <span class="title">✨ <span class="gname">Jackbox AI</span></span>
        <button class="btn" data-act="xray" title="X-ray: what the game sent your phone">🔬</button>
        <button class="btn" data-act="guide" title="Game guide">📖</button>
        <button class="btn" data-act="history" title="History">🕘</button>
        <button class="btn" data-act="settings" title="Settings">⚙️</button>
        <button class="btn" data-act="close">✕</button>
      </div>
      <div class="view main">
        <div class="gamebar"></div>
        <div class="chips">
          <button class="chip" data-act="tvcam">📷 Snap the TV</button>
          <button class="chip" data-tweak="Way darker and more shocking. Push it further.">🔥 Darker</button>
          <button class="chip" data-tweak="Cleaner - safe for anyone in the room, still funny.">😇 Cleaner</button>
          <button class="chip" data-tweak="Way more absurd and surreal. Weird wins.">🤪 Weirder</button>
          <button class="chip" data-tweak="Much shorter: 2-5 words if possible. For drawings: simpler, bolder, fewer shapes.">✂️ Shorter</button>
          <button class="chip" data-tweak="Smarter: clever wordplay, puns, double meanings, visual puns.">🧠 Clever</button>
          <button class="chip" data-tweak="Roast the other players in the room by name (use names from the screen).">🎯 Roast</button>
          <button class="chip" data-tweak="Pop culture: reference memes, movies, shows, celebrities, viral moments.">📺 Pop culture</button>
          <button class="chip" data-tweak="For drawings: much more detailed and colorful, 50-80 shapes, more color fills.">🎨 Fancier art</button>
          <button class="chip" data-act="punch">✍️ Punch up mine</button>
          <button class="chip" data-act="undo">↩️ Undo</button>
          <button class="chip" data-act="detective">🕵️ Find impostor</button>
          <button class="chip" data-act="lookup">🔎 Look it up</button>
          <button class="chip" data-act="win">🏆 Win this</button>
          <button class="chip" data-act="note">📝 Save note</button>
          <button class="chip" data-tweak="Explain what is happening on this screen and exactly what I should do to win. Put the explanation in advice; still give options if there is something to do.">❓ Explain</button>
        </div>
        <div class="row">
          <input type="text" class="extra" placeholder="Steer it or ask anything…">
          <button class="btn primary" data-act="go">Go</button>
        </div>
        <div class="chips modes"></div>
        <div class="out muted">Tap ✨ on any screen: writing, drawing, voting, bidding, trivia, minigames.</div>
      </div>
      <div class="view guide" style="display:none"></div>
      <div class="view history" style="display:none"></div>
      <div class="view xray" style="display:none"></div>
      <div class="view settings" style="display:none">
        <div class="section" style="border:0;margin-top:0;padding-top:0">🧠 AI (free options available)</div>
        <div class="muted">Works with <b>no setup</b> using free Pollinations AI. For smarter, faster answers add a <b>free</b> key (Gemini is the best free one). Add several and it auto-switches when one is busy.</div>
        <label>Use</label>
        <select data-k="provider">
          <option value="auto">Auto (best available)</option>
          <option value="gemini">Google Gemini (free key)</option>
          <option value="groq">Groq (free key, fastest)</option>
          <option value="openrouter">OpenRouter (free models)</option>
          <option value="pollinations">Pollinations (free, no key)</option>
          <option value="claude">Claude (paid, best)</option>
        </select>
        <label>Gemini key <span class="free">FREE</span> · <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">get one</a></label>
        <input type="password" data-k="geminiKey" placeholder="AIza..." autocomplete="off">
        <label>Groq key <span class="free">FREE</span> · <a href="https://console.groq.com/keys" target="_blank" rel="noopener">get one</a></label>
        <input type="password" data-k="groqKey" placeholder="gsk_..." autocomplete="off">
        <label>OpenRouter key <span class="free">FREE models</span> · <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">get one</a></label>
        <input type="password" data-k="openrouterKey" placeholder="sk-or-..." autocomplete="off">
        <label>Claude key <span class="paid">PAID</span> · <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">get one</a></label>
        <input type="password" data-k="claudeKey" placeholder="sk-ant-..." autocomplete="off">
        <label>Claude model</label>
        <select data-k="claudeModel">
          <option value="claude-opus-5-5">Opus 5.5 · funniest, best art</option>
          <option value="claude-sonnet-5-5">Sonnet 5.5 · faster, cheaper</option>
          <option value="claude-haiku-5-5">Haiku 5.5 · fastest, almost free</option>
        </select>
        <label>Claude thinking</label>
        <select data-k="effort">
          <option value="low">Fast (recommended)</option>
          <option value="medium">Balanced</option>
          <option value="high">Deep (slow)</option>
        </select>
        <label>Custom model name (optional, advanced)</label>
        <input type="text" data-k="customModel" placeholder="leave blank to auto-pick">
        <div class="row" style="margin-top:8px"><button class="btn" data-act="test">🔌 Test AI</button><span class="muted testout"></span></div>
        <label class="ck"><input type="checkbox" data-k="race"> 🏁 Race 2 AIs at once (faster + extra answers; uses 2× free quota)</label>

        <div class="section">😈 Style</div>
        <label>Humor level</label>
        <div class="seg" data-seg="spice">
          <button class="btn" data-v="1">😇 Family</button><button class="btn" data-v="2">🙂 Normal</button>
          <button class="btn" data-v="3">😈 Edgy</button><button class="btn" data-v="4">💀 Unhinged</button>
        </div>
        <label>Comedy voice</label>
        <select data-k="persona">${optionTags(PERSONAS)}</select>
        <label>Who's in the room / inside jokes</label>
        <div class="chips">${Object.keys(ROOM_PRESETS).map((k) => `<button class="chip" data-preset="${esc(k)}">${esc(k)}</button>`).join('')}</div>
        <input type="text" data-k="style" placeholder="e.g. college roommates; Jake is always late; we love Shrek">
        <label>✍️ Custom instructions for the AI (optional, applied every answer)</label>
        <div class="chips">${Object.keys(STYLE_PRESETS).map((k) => `<button class="chip" data-sp="${esc(k)}">${esc(k)}</button>`).join('')}</div>
        <textarea data-k="customPrompt" rows="3" placeholder="Tap a style above, or type your own. e.g. Keep answers under 5 words. Always sneak in a cat."></textarea>
        <div class="row" style="margin:4px 0 0"><span class="muted" style="flex:1">Added to the prompt every time. Tap presets to stack them.</span><button class="mini" data-act="clearcustom">Clear</button></div>

        <div class="section">🎮 Play mode</div>
        <div class="seg" data-seg="mode">${Object.entries(MODES).map(([k, v]) => `<button class="btn" data-v="${k}">${esc(v[0])}</button>`).join('')}</div>
        <div class="muted" style="margin-top:4px">Coach explains why answers work · Co-pilot suggests · Autopilot plays the top answer itself · Chaos = maximum mayhem</div>
        <label>Auto-run when a new screen appears</label>
        <div class="seg" data-seg="autoMode">
          <button class="btn" data-v="off">Off</button><button class="btn" data-v="prompts">Write + draw</button><button class="btn" data-v="all">Everything</button>
        </div>
        <label class="ck"><input type="checkbox" data-k="autoSubmit"> Autopilot also presses Submit</label>
        <label>Drawing speed</label>
        <select data-k="drawSpeed"><option value="fast">Fast</option><option value="natural">Natural (looks hand-drawn live)</option></select>
        <label>Answers per tap</label>
        <select data-k="count"><option value="3">3</option><option value="5">5</option><option value="8">8</option></select>
        <label class="ck"><input type="checkbox" data-k="memory"> Remember earlier rounds for callbacks</label>
        <label class="ck"><input type="checkbox" data-k="webSearch"> 🔎 Web search for trivia &amp; truths (Gemini / Claude)</label>
        <label class="ck"><input type="checkbox" data-k="readConnection"> 📡 Use game data from my phone's connection</label>
        <label class="ck"><input type="checkbox" data-k="hud"> 🎯 Show answers ON the game screen (overlay)</label>
        <div class="row" style="margin-top:14px">
          <button class="btn primary" data-act="save">Save</button>
          <button class="btn" data-act="forget">New game</button>
          <button class="btn" data-act="resettaste">Reset 👍/👎</button>
        </div>
        <div class="muted">Keys stay on this phone and only go to that AI's own server. Drag ✨ to move it. Tap ✨ while drawing to stop.</div>
      </div>
    </div>`;

  const $ = (sel) => root.querySelector(sel);
  const fab = $('.fab');
  const panel = $('.panel');
  const out = $('.out');
  const setOut = (html) => { out.innerHTML = html; };
  let busy = false;
  const needsWelcome = () => !settings.welcomed && !['claudeKey', 'geminiKey', 'groqKey', 'openrouterKey'].some((k) => settings[k]);
  const welcomeHTML = () => `<div class="advice"><b>👋 Welcome!</b> It already works <b>free with no key</b> - just tap ✨ on any prompt. For smarter, faster answers add a free key (2 min):</div>
        <div class="row"><button class="btn primary" data-act="addkey" data-key="groqKey">⚡ Free Groq key (fastest)</button></div>
        <div class="row"><button class="btn" data-act="addkey" data-key="geminiKey">✨ Free Gemini key</button><button class="btn" data-act="addkey" data-key="openrouterKey">OpenRouter</button><button class="btn" data-act="welcomed">Later</button></div>`;
  let runSeq = 0;
  let lastUndo = null;
  // never let Auto press game-menu buttons
  const MENU_RE = /button "(same players|new players|everybody'?s in|start( game)?|play again|back to (the )?lobby|exit|leave( game)?|change name|settings|menu|vip|start over|skip( tutorial)?|ready)"/i;
  const setStatus = (msg) => { if (busy) setOut(`<span class="muted">${esc(msg)}</span>`); };

  let toastTimer;
  function toast(msg) {
    const t = $('.toast');
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.display = 'none'; }, 2000);
  }

  let drawing = false;
  function setDrawing(on) {
    drawing = on;
    fab.classList.toggle('drawing', on);
    fab.firstChild.nodeValue = on ? '⏹' : '✨';
    fab.dataset.p = '';
    if (on) panel.classList.remove('open');
  }

  function showView(name) {
    root.querySelectorAll('.view').forEach((v) => { v.style.display = v.classList.contains(name) ? 'block' : 'none'; });
    if (name === 'settings') fillSettings();
    if (name === 'guide') renderGuide();
    if (name === 'history') renderHistory();
    if (name === 'xray') renderXray();
  }
  const viewIs = (name) => $('.view.' + name).style.display !== 'none';

  const pending = {};
  function refreshSeg(name) {
    root.querySelectorAll(`[data-seg="${name}"] [data-v]`).forEach((b) => b.classList.toggle('primary', String(b.dataset.v) === String(pending[name])));
  }
  function refreshBadges() {
    fab.querySelector('.badge').textContent = { autopilot: '🤖', chaos: '🌀', coach: '🎓' }[settings.mode] || '';
    $('.modes').innerHTML = Object.entries(MODES).map(([k, v]) => `<button class="chip${settings.mode === k ? ' on' : ''}" data-mode="${k}">${esc(v[0])}</button>`).join('') +
      `<button class="chip" data-act="settings">${esc(SPICE[settings.spice].label)}</button><button class="chip" data-act="settings">${esc(PERSONAS[settings.persona][0])}</button>`;
  }
  let shownGame = null;
  let shownSig = '';
  // OFF: tap ✨ yourself · READY: answers pre-load on every new prompt (instant when you tap ✨) · AUTO: also fills them in
  const autoState = () => (settings.autoMode === 'off' ? 'off' : settings.mode === 'autopilot' ? 'auto' : 'ready');
  const AUTO_LABEL = { off: '⚡ Auto OFF', ready: '⚡ Ready', auto: '⚡ Auto ON' };
  function refreshGameUI(g) {
    const name = g ? (g._exact || g.name) : '';
    $('.gname').textContent = name || 'Jackbox AI';
    const st = autoState();
    const sig = (g ? g.id + '|' + (g._exact || '') + '|' + g.via : 'none') + '|' + roomCode + '|' + st;
    if (sig === shownSig) return;
    shownSig = sig; shownGame = g;
    const bar = $('.gamebar');
    const auto = `<button class="autobtn ${st}" data-act="autoanswer">${AUTO_LABEL[st]}</button>`;
    if (!g) {
      bar.innerHTML = `<div class="gameband"><div style="flex:1;min-width:0"><div class="gn">🔎 Detecting game…</div><div class="gm">${roomCode ? 'room ' + esc(roomCode) : 'join a game, then tap ✨'}</div></div>${auto}</div>`;
      return;
    }
    const mode = isDeduction(g) ? '🕵️ Detective' : isAccuracy(g) ? '🎯 Accuracy' + (settings.webSearch ? ' + 🔎' : '') : SEARCH_GAMES.has(g.id) ? '🔎 Truth-finder' : '😂 Comedy';
    const chips = (GAME_CHIPS[g.id] || []).map((c, i) => `<button class="chip game" data-gchip="${i}">${esc(c[0])}</button>`).join('');
    bar.innerHTML = `<div class="gameband"><div style="flex:1;min-width:0"><div class="gn">🎮 ${esc(name)}</div><div class="gm">${g.via === 'connection' ? 'auto-detected ✓' : 'detected'} · ${mode}${roomCode ? ' · ' + esc(roomCode) : ''}</div></div>${auto}</div>${chips ? `<div class="chips" style="margin-top:7px">${chips}</div>` : ''}`;
  }

  function fillSettings() {
    root.querySelectorAll('.settings [data-k]').forEach((el) => {
      const v = settings[el.dataset.k];
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    });
    for (const n of ['spice', 'autoMode', 'mode']) { pending[n] = settings[n]; refreshSeg(n); }
  }

  async function saveSettings(quietly) {
    let keysChanged = false;
    for (const el of root.querySelectorAll('.settings [data-k]')) {
      const k = el.dataset.k;
      let v = el.type === 'checkbox' ? el.checked : el.value.trim();
      if (k === 'count') v = parseInt(v, 10) || 5;
      if ((/Key$/.test(k) || k === 'customModel') && v !== settings[k]) { settings.modelCache = {}; store.set('modelCache', {}); if (/Key$/.test(k)) keysChanged = true; }
      await save(k, v);
    }
    await save('spice', +pending.spice);
    await save('autoMode', pending.autoMode);
    await save('mode', pending.mode);
    refreshBadges();
    lastSig = '';
    if (keysChanged) await save('welcomed', true);
    if (quietly) return keysChanged;
    showView('main');
    setOut(`<span class="muted">Saved. AI order: ${availableProviders().map((p) => PROVIDERS[p].label).join(' → ')}</span>`);
    return keysChanged;
  }

  // Instant 'is my key working?' check: ping the first available AI
  async function verifyFirst() {
    const list = availableProviders();
    let last = null;
    for (let i = 0; i < list.length; i++) {
      const prov = list[i];
      try {
        const r = await callProvider(prov, 'Reply with only a JSON object.', 'Return {"ok":true}', [], i === 0);
        extractJSON(r.text);
        return '✅ ' + PROVIDERS[prov].label + ' is working';
      } catch (e) {
        if (e.auth && PROVIDERS[prov].keyName) return '❌ ' + PROVIDERS[prov].label + ' key was rejected - re-check it in ⚙️';
        last = e;
      }
    }
    return last ? '❌ ' + clean(last.message, 80) : '';
  }

  function renderGuide() {
    const g = detectGame(screenText());
    const v = $('.view.guide');
    const card = (gg) => `<div class="hist"><b>${esc(gg.name)}</b><div class="muted" style="margin-top:4px">${esc(gg.guide)}</div><ul>${gg.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
    v.innerHTML = `<div class="row"><b style="flex:1">📖 Game guide</b><button class="btn" data-act="back">← Back</button></div>
      <div class="muted">Free, works offline. ${g ? 'Detected: <b>' + esc(g.name) + '</b>' : 'Game not detected yet.'}</div>
      ${g ? card(g) : ''}
      <details ${g ? '' : 'open'}><summary class="muted" style="margin:8px 0">All ${GAMES.length} games</summary>${GAMES.filter((x) => x !== g).map(card).join('')}</details>`;
  }

  function renderHistory() {
    const m = loadMemory().slice().reverse();
    const s = getStats();
    const v = $('.view.history');
    v.innerHTML = `<div class="row"><b style="flex:1">🕘 This game</b><button class="btn" data-act="back">← Back</button></div>
      <div class="muted">✍️ ${s.answers || 0} answers · 🎨 ${s.drawings || 0} drawings · 🗳️ ${s.picks || 0} picks</div>
      ${loadRoomRead() ? `<div class="advice">👥 Room read: ${esc(loadRoomRead())}</div>` : ''}
      ${suspectMeterHTML(loadSusList())}
      ${m.length ? m.map((e, i) => `<div class="hist"><div class="muted">${esc(clean(e.prompt, 120))}</div><div style="margin-top:4px">${esc(e.answer)}</div><button class="mini" data-hcopy="${i}" style="margin-top:6px">📋 Copy</button></div>`).join('') : '<div class="muted" style="margin-top:8px">Nothing yet.</div>'}`;
    v.querySelectorAll('[data-hcopy]').forEach((b) => b.addEventListener('click', async () => toast((await copyText(m[+b.dataset.hcopy].answer)) ? 'Copied 📋' : 'Copy failed')));
  }

  // ---------------------------------------------------------------------------
  // Running a request
  // ---------------------------------------------------------------------------
  async function run(tweak, quiet, flags = {}) {
    if (busy || drawing) return;
    if (!quiet) { panel.classList.add('open'); showView('main'); }
    const extra = $('.extra').value.trim();
    const ctx = readContext([extra, tweak].filter(Boolean).join(' '));
    ctx.retried = !!flags.retried;
    if (flags.search && settings.webSearch) ctx.search = true;
    if (flags.detective) ctx.detective = true;
    if (flags.accuracy) ctx.accuracy = true;
    refreshGameUI(ctx.game);
    if (!ctx.items.length && !extra && !tweak) {
      if (!quiet && needsWelcome()) { setOut(welcomeHTML()); return; }
      if (!quiet) setOut(`<span class="muted">Nothing to tap on this screen yet. Tap ✨ when a prompt, drawing pad or choices show up.${ctx.game ? ' Meanwhile 📖 has tips for ' + esc(ctx.game.name) + '.' : ''}</span>`);
      return;
    }
    busy = true;
    fab.classList.add('busy');
    fab.classList.remove('ready');
    setOut(`<span class="muted">${ctx.kind === 'draw' ? 'Sketching… 🎨' : 'Cooking… 🍳'}</span>`);
    clearHud(true);
    const t0 = Date.now();
    const runId = ++runSeq;
    // Race mode: the slower AI's answers get added as extra cards when they arrive
    ctx.onExtra = (r2) => {
      if (runId !== runSeq || !ctx.result) return;
      const key = (o) => (typedOf(o).join('|') || o.text || o.label).toLowerCase().trim();
      const seen = new Set(ctx.result.options.map(key));
      const add = r2.options.filter((o) => !seen.has(key(o)));
      if (!add.length) return;
      ctx.result.options = ctx.result.options.concat(add);
      ctx.result.via += ' + ' + r2.via;
      render(ctx.result, ctx, ctx.secs);
    };
    let pilot = null;
    try {
      const result = await ask(ctx);
      ctx.result = result;
      ctx.secs = ((Date.now() - t0) / 1000).toFixed(1);
      render(result, ctx, ctx.secs);
      hudFromResult(result, ctx);
      if ((settings.mode === 'autopilot' || ctx.retried) && (!tweak || ctx.retried) && result.options.length) pilot = result.options[0];
      // safety: Auto never presses menu buttons and never auto-accuses in impostor games
      if (pilot && pilot.actions.some((a) => a.do === 'click' && ctx.items[a.el] && MENU_RE.test(ctx.items[a.el].desc))) pilot = null;
      if (pilot && isDeduction(ctx.game) && ctx.kind === 'pick' && !ctx.retried) pilot = null;
      if (!pilot && quiet && !panel.classList.contains('open')) fab.classList.add('ready'); // answers waiting: green dot
    } catch (e) {
      setOut('<span class="err">' + esc(e.message || e) + '</span>' + (ctx.game ? `<div class="advice" style="margin-top:8px">📖 Offline tip for ${esc(ctx.game.name)}: ${esc(ctx.game.tips.join(' · '))}</div>` : ''));
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
    const colorOf = (i) => { if (i !== undefined && i !== null && Number.isInteger(+i) && ctx.items[+i] && ctx.items[+i].color) cur = ctx.items[+i].color; return cur; };
    const num = (v) => (Number.isFinite(+v) ? +v : 0);
    const parts = shapes.filter((s) => s && typeof s === 'object').map((s) => {
      const c = esc(colorOf(s.color));
      const st = `stroke="${c}" stroke-width="${space.W / 120}" stroke-linecap="round" stroke-linejoin="round"`;
      const fill = s.fill ? c : 'none';
      if (Array.isArray(s.circle)) return `<circle cx="${num(s.circle[0])}" cy="${num(s.circle[1])}" r="${Math.abs(num(s.circle[2]))}" ${st} fill="${fill}"/>`;
      if (Array.isArray(s.ellipse)) return `<ellipse cx="${num(s.ellipse[0])}" cy="${num(s.ellipse[1])}" rx="${Math.abs(num(s.ellipse[2]))}" ry="${Math.abs(num(s.ellipse[3]))}" ${st} fill="${fill}"/>`;
      if (Array.isArray(s.rect)) return `<rect x="${num(s.rect[0])}" y="${num(s.rect[1])}" width="${Math.abs(num(s.rect[2]))}" height="${Math.abs(num(s.rect[3]))}" ${st} fill="${fill}"/>`;
      const arr = s.poly || s.line;
      if (!Array.isArray(arr)) return '';
      const pts = [];
      for (let k = 0; k + 1 < arr.length; k += 2) pts.push(num(arr[k]) + ',' + num(arr[k + 1]));
      return s.poly ? `<polygon points="${pts.join(' ')}" ${st} fill="${fill}"/>` : `<polyline points="${pts.join(' ')}" ${st} fill="none"/>`;
    }).join('');
    return `<svg viewBox="0 0 ${space.W} ${space.H}" preserveAspectRatio="xMidYMid meet">${parts}</svg>`;
  }

  function suspectMeterHTML(list) {
    if (!list || !list.length) return '';
    const top = list.slice().sort((a, b) => b.prob - a.prob);
    const rows = top.map((sp, i) => `<div class="susrow"><span class="susname">${i === 0 ? '🎯 ' : ''}${esc(sp.name)}</span><span class="susbar"><span style="width:${sp.prob}%"></span></span><span class="suspct">${sp.prob}%</span></div>${sp.why ? `<div class="suswhy">${esc(sp.why)}</div>` : ''}`).join('');
    return `<div class="meter"><div class="muted" style="margin-bottom:6px">🕵️ Suspect-o-meter <span style="float:right">builds up each round</span></div>${rows}</div>`;
  }

  // ---------------------------------------------------------------------------
  // HUD: labels pinned on top of the real game screen (never blocks your taps)
  // ---------------------------------------------------------------------------
  let hudItems = []; // { el, text, cls, ring, node, ringNode }
  let hudPill = '';
  let hudScreen = '';
  const dropHudNode = (h) => { if (h.node) h.node.remove(); if (h.ringNode) h.ringNode.remove(); };
  function renderHud() {
    const box = $('.hud'); const pillEl = $('.hudpill');
    if (!box) return;
    const show = !!settings.hud;
    hudItems = hudItems.filter((h) => { if (show && h.el.isConnected) return true; dropHudNode(h); return false; });
    const stack = new Map();
    for (const h of hudItems) {
      if (!h.node) {
        h.node = document.createElement('div'); h.node.className = 'hb ' + (h.cls || ''); h.node.textContent = h.text; box.appendChild(h.node);
        if (h.ring) { h.ringNode = document.createElement('div'); h.ringNode.className = 'ring'; box.appendChild(h.ringNode); }
      }
      const r = h.el.getBoundingClientRect();
      const vis = r.width >= 2 && r.height >= 2 && r.bottom > 0 && r.top < innerHeight;
      h.node.style.display = vis ? '' : 'none';
      if (h.ringNode) h.ringNode.style.display = vis ? '' : 'none';
      if (!vis) continue;
      const n = stack.get(h.el) || 0; stack.set(h.el, n + 1);
      const w = h.node.offsetWidth || 80;
      const x = Math.min(innerWidth - w / 2 - 4, Math.max(w / 2 + 4, r.left + r.width / 2));
      let y = r.top - 4 - n * 22; const below = y < 26;
      if (below) y = r.bottom + 4 + n * 22;
      h.node.classList.toggle('below', below);
      h.node.style.left = x + 'px'; h.node.style.top = y + 'px';
      if (h.ringNode) Object.assign(h.ringNode.style, { left: (r.left - 4) + 'px', top: (r.top - 4) + 'px', width: (r.width + 8) + 'px', height: (r.height + 8) + 'px' });
    }
    if (show && hudPill && !panel.classList.contains('open')) { pillEl.textContent = hudPill; pillEl.style.display = 'block'; } else pillEl.style.display = 'none';
  }
  function clearHud(keepData) {
    hudItems = hudItems.filter((h) => { const keep = keepData && h.cls === 'data'; if (!keep) dropHudNode(h); return keep; });
    hudPill = '';
    renderHud();
  }
  function addHud(items, pill) {
    for (const it of items) if (!hudItems.some((h) => h.el === it.el && h.text === it.text)) hudItems.push(it);
    if (pill !== undefined) hudPill = pill;
    hudScreen = screenNorm().slice(0, 100);
    renderHud();
  }
  function hudFromResult(result, ctx) {
    if (!settings.hud) return;
    const items = []; const seen = new Set();
    (result.badges || []).forEach((b) => { const it = ctx.items[b.el]; if (it) { items.push({ el: it.el, text: b.text }); seen.add(b.el); } });
    const best = result.options[0];
    if (best) {
      best.actions.forEach((a) => {
        const it = ctx.items[a.el]; if (!it) return;
        if (a.do === 'click' && it.kind !== 'swatch') {
          const had = items.find((x) => x.el === it.el);
          if (had) { had.cls = 'best'; had.ring = true; } else if (!seen.has(a.el)) { items.push({ el: it.el, text: '✅ best pick' + (best.score ? ' · ' + best.score + '/10' : ''), cls: 'best', ring: true }); seen.add(a.el); }
        }
        if (a.do === 'set' && !seen.has(a.el)) { items.push({ el: it.el, text: '🎯 set to ' + a.value, cls: 'best', ring: true }); seen.add(a.el); }
      });
      const second = result.options[1];
      if (second && ctx.kind === 'pick') second.actions.forEach((a) => { const it = ctx.items[a.el]; if (it && a.do === 'click' && !seen.has(a.el)) { items.push({ el: it.el, text: '2nd' + (second.score ? ' · ' + second.score + '/10' : '') }); seen.add(a.el); } });
    }
    const bestTxt = best ? (typedOf(best).join(' / ') || best.text || '') : '';
    const lbl = best ? best.label || '' : '';
    const pill = result.advice ? '💡 ' + result.advice : best ? '💡 ' + (bestTxt && lbl && bestTxt.toLowerCase() !== lbl.toLowerCase() ? lbl + ': ' + bestTxt : bestTxt || lbl || 'Best') : '';
    addHud(items, clean(pill, 160));
  }
  // No-AI overlay: values found by X-ray, matched to the on-screen item they belong to
  function dataHud() {
    if (!settings.hud || !settings.readConnection || !entities.size) return;
    const { pairs } = xrayScan();
    if (!pairs.length) return;
    const items = inventory(); const out = [];
    for (const pr of pairs) {
      const lab = String(pr.label).toLowerCase().trim();
      const it = items.find((i) => i.kind === 'click' && i.desc.toLowerCase().includes(lab));
      if (!it) continue;
      if (typeof pr.value === 'boolean' && !pr.value) continue;
      const txt = typeof pr.value === 'boolean' ? '🔬 ' + pr.key : '🔬 ' + pr.key + ': ' + (typeof pr.value === 'number' ? pr.value.toLocaleString() : pr.value);
      out.push({ el: it.el, text: clean(txt, 28), cls: 'data' });
    }
    if (out.length) addHud(out);
  }
  let traceGuide = null; // { el, node, close }
  function showTraceGuide(canvasEl, shapes, ctx, canvasIdx) {
    hideTraceGuide();
    const node = document.createElement('div'); node.className = 'trace';
    node.innerHTML = previewSVG(shapes, ctx, canvasIdx);
    $('.hud').appendChild(node);
    const close = document.createElement('button'); close.className = 'traceclose'; close.textContent = '✕ hide guide';
    close.addEventListener('click', hideTraceGuide);
    root.appendChild(close);
    traceGuide = { el: canvasEl, node, close };
    placeTrace();
  }
  function placeTrace() {
    if (!traceGuide) return;
    if (!traceGuide.el.isConnected) { hideTraceGuide(); return; }
    const r = traceGuide.el.getBoundingClientRect();
    Object.assign(traceGuide.node.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    Object.assign(traceGuide.close.style, { left: Math.max(4, r.right - 110) + 'px', top: Math.max(4, r.top - 34) + 'px' });
  }
  function hideTraceGuide() { if (!traceGuide) return; traceGuide.node.remove(); traceGuide.close.remove(); traceGuide = null; }

  let tvShot = null; // { data, screen }
  function openTvCam() { const inp = $('.tvcam'); inp.value = ''; inp.click(); } // must run inside the tap
  async function onTvPhoto() {
    const f = $('.tvcam').files && $('.tvcam').files[0];
    if (!f) return;
    try {
      const url = URL.createObjectURL(f);
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const data = toJpegB64(img, img.naturalWidth, img.naturalHeight, 1024);
      URL.revokeObjectURL(url);
      tvShot = { data, screen: promptKey() };
      if (!availableProviders().some((p) => p !== 'pollinations')) toast('📷 Heads up: the free no-key AI can\'t see photos - add a free Gemini key');
      else toast('📷 Got it - reading the TV…');
      run('A photo of the TV / big screen is attached. Use what it shows.', false);
    } catch (_) { toast('Could not read that photo - try again'); }
  }

  function hudTick() {
    if (document.hidden) return;
    try { placeTrace(); } catch (_) { /* ignore */ }
    try {
      if (!hudItems.length && !hudPill) return;
      if (hudScreen && !screenNorm().includes(hudScreen)) { clearHud(false); return; } // new screen: old labels would mislead
      renderHud();
    } catch (_) { /* ignore */ }
  }

  function renderXray() {
    const v = $('.view.xray');
    const { fields } = xrayScan();
    const raw = [...entities.entries()].sort((a, b) => b[1].t - a[1].t).slice(0, 8).map(([k, e]) => k + ' = ' + JSON.stringify(e.val, null, 1)).join('\n\n');
    v.innerHTML = `<div class="row"><b style="flex:1">🔬 X-ray</b><button class="btn" data-act="back">← Back</button></div>
      <div class="muted">Everything the game sent to <b>your phone</b>. ${wsSeen ? '📡 Connected' + (roomCode ? ' · room ' + esc(roomCode) : '') + (appTag ? ' · ' + esc(appTag) : '') : '📡 No game data yet - join a game (reload jackbox.tv once after installing).'}</div>
      <div class="section">💎 Notable values (${fields.length})</div>
      ${fields.length ? '<div class="xr">' + fields.map((f) => esc(f.path) + ' = <b>' + esc(JSON.stringify(f.value)) + '</b>').join('\n') + '</div>' : '<div class="muted">None on this screen. Secret answers and prices usually stay on the host (TV/PC) and never reach phones - then the AI estimates instead.</div>'}
      ${(() => { const tips = loadBidTips(); if (!tips.length) return ''; const facts = Object.values(parseBidTips());
        return '<div class="section">💰 Bidiots tips logged (' + tips.length + ')</div>' + (facts.length ? '<div class="xr">' + facts.map((f) => { const pr = priceFact(f, null); return esc(f.title) + ' → <b>' + (pr.lo === pr.hi ? money(pr.ev) : money(pr.lo) + '–' + money(pr.hi)) + '</b> · max bid ' + money(pr.maxBid); }).join('\n') + '</div>' : '') + '<div class="xr">' + tips.map((t) => esc(t.text)).join('\n') + '</div>'; })()}
      <div class="section">🧾 Raw game data</div>
      <div class="xr">${raw ? esc(raw.slice(0, 12000)) : 'Nothing yet.'}</div>
      <div class="row" style="margin-top:8px"><button class="btn" data-act="xrayrefresh">↻ Refresh</button></div>`;
  }

  function render(result, ctx, secs) {
    let html = `<div class="muted">🎮 ${esc(result.game || (ctx.game && ctx.game.name) || 'Jackbox')} · ${secs}s · ${esc(result.via || '')}${ctx.tv ? ' · 📷 TV' : ''}</div>`;
    if (result.advice) html += `<div class="advice">💡 ${esc(result.advice)}</div>`;
    html += suspectMeterHTML(result.suspects);
    const hasSubmit = Number.isInteger(result.submit);
    result.options.forEach((o, i) => {
      const drawAct = o.actions.find((a) => a.do === 'draw' && Array.isArray(a.shapes) && ctx.items[a.el].kind === 'canvas');
      const typed = o.actions.filter((a) => a.do === 'type' && ctx.items[a.el].kind === 'text').map((a) => ({ t: String(a.text || ''), max: ctx.items[a.el].el.maxLength }));
      let body = `<span class="lbl"><span>${esc(o.label || 'Option ' + (i + 1))}</span><span>${o.score ? '🔥'.repeat(Math.max(1, Math.round(o.score / 3.4))) + ' ' + o.score : ''}</span></span>`;
      if (typed.length) body += typed.map((x) => `<span class="f">${esc(x.t)}</span>`).join('');
      else if (o.text) body += `<span class="f">${esc(o.text)}</span>`;
      if (drawAct) body += previewSVG(drawAct.shapes, ctx, drawAct.el);
      if (o.why && (settings.mode === 'coach' || /explain/i.test(ctx.tweak || ''))) body += `<span class="why">🎓 ${esc(o.why)}</span>`;
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
          ${drawAct ? `<button class="mini" data-trace="${i}" title="Show it as a guide to trace with your finger">✏️ Trace</button>` : ''}
          <button class="mini" data-more="${i}">🔁</button>
          <button class="mini" data-like="${i}" title="More like this">👍</button>
          <button class="mini" data-dislike="${i}" title="Less like this">👎</button>
        </div></div>`;
    });
    if (!result.options.length && !result.advice) html += '<div class="muted">Nothing to do here. Tap ✨ on the next screen.</div>';
    else if (result.options.length) html += '<div class="muted">Tap a card to use it (drawings draw themselves). 🔁 = more like this · 👍/👎 teaches it your taste.</div>';
    if (needsWelcome()) html += '<div class="advice" style="margin-top:8px">💡 That was the free no-key AI. <button class="mini go" data-act="addkey" data-key="groqKey">Add a free key</button> for faster, smarter answers.</div>';
    setOut(html);

    const go = async (i, submit) => {
      panel.classList.remove('open');
      const o = result.options[i];
      try { await execute(o, ctx, submit); } catch (e) {
        if (e.changed && !ctx.retried) { toast('Screen changed - re-reading it…'); setTimeout(() => run(ctx.tweak, false, { retried: true }), 300); return; }
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
    out.querySelectorAll('[data-trace]').forEach((b) => b.addEventListener('click', () => {
      const o = result.options[+b.dataset.trace];
      const d = o.actions.find((a) => a.do === 'draw' && Array.isArray(a.shapes) && ctx.items[a.el] && ctx.items[a.el].kind === 'canvas');
      if (!d || !ctx.items[d.el].el.isConnected) { toast('Drawing pad is gone - tap ✨ again'); return; }
      panel.classList.remove('open');
      showTraceGuide(ctx.items[d.el].el, d.shapes, ctx, d.el);
      toast('✏️ Trace the guide with your finger, then Submit');
    }));
    const rate = (i, good) => {
      const o = result.options[i];
      const txt = clean(typedOf(o).join(' / ') || o.text || o.label, 120);
      if (!txt) return;
      const t = settings.taste;
      t.likes = t.likes.filter((x) => x !== txt); t.dislikes = t.dislikes.filter((x) => x !== txt);
      (good ? t.likes : t.dislikes).push(txt);
      t.likes = t.likes.slice(-12); t.dislikes = t.dislikes.slice(-12);
      save('taste', t);
      toast(good ? '👍 Noted - more like this' : '👎 Noted - less like this');
    };
    out.querySelectorAll('[data-like]').forEach((b) => b.addEventListener('click', () => { rate(+b.dataset.like, true); b.classList.add('go'); }));
    out.querySelectorAll('[data-dislike]').forEach((b) => b.addEventListener('click', () => { rate(+b.dataset.dislike, false); b.style.opacity = '.5'; }));
  }

  async function testAI() {
    const el = $('.testout');
    el.textContent = 'Testing…';
    const errs = [];
    const list = availableProviders();
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      try {
        const r = await callProvider(p, 'Reply with only a JSON object.', 'Return {"ok":true,"joke":"<a 6-word joke>"}', [], i === 0);
        const j = extractJSON(r.text);
        el.textContent = `✅ ${PROVIDERS[p].label} works (${String(r.model).replace(/^.*\//, '')}): ${clean(j.joke, 60)}`;
        return;
      } catch (e) { errs.push(clean(e.message, 70)); }
    }
    el.textContent = '❌ ' + errs.join(' | ');
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  root.addEventListener('click', async (e) => {
    const t = e.target.closest ? e.target.closest('[data-act],[data-tweak],[data-v],[data-mode],[data-preset],[data-gchip],[data-sp]') : null;
    if (!t) return;
    if (t.dataset.sp !== undefined) {
      const ta = $('.settings textarea[data-k="customPrompt"]');
      const add = STYLE_PRESETS[t.dataset.sp];
      const cur = ta.value.trim();
      if (add && !cur.includes(add)) ta.value = cur ? cur + ' ' + add : add;
      t.classList.add('on');
      return;
    }
    if (t.dataset.gchip !== undefined) {
      const c = shownGame && (GAME_CHIPS[shownGame.id] || [])[+t.dataset.gchip];
      if (c && c[1] === 'TVCAM') { openTvCam(); return; }
      if (c) run(c[1], false, { search: !!c[2], detective: c[1] === DETECTIVE, accuracy: !!c[2] || isAccuracy(shownGame) });
      return;
    }
    if (t.dataset.tweak) { run(t.dataset.tweak); return; }
    if (t.dataset.mode) { await save('mode', t.dataset.mode); refreshBadges(); toast(MODES[t.dataset.mode][0]); return; }
    if (t.dataset.preset) { $('.settings [data-k="style"]').value = ROOM_PRESETS[t.dataset.preset]; return; }
    if (t.dataset.v !== undefined) {
      const seg = t.closest('[data-seg]').dataset.seg;
      pending[seg] = t.dataset.v;
      refreshSeg(seg);
      return;
    }
    const a = t.dataset.act;
    if (a === 'close') panel.classList.remove('open');
    else if (a === 'settings') showView(viewIs('settings') ? 'main' : 'settings');
    else if (a === 'guide') showView('guide');
    else if (a === 'history') showView('history');
    else if (a === 'xray') showView('xray');
    else if (a === 'xrayrefresh') renderXray();
    else if (a === 'tvcam') openTvCam();
    else if (a === 'back') showView('main');
    else if (a === 'autoanswer') {
      const st = autoState();
      if (st === 'off') { await save('autoMode', 'prompts'); if (settings.mode === 'autopilot') await save('mode', 'copilot'); toast('⚡ READY - answers load in the background; tap ✨ to see them instantly'); }
      else if (st === 'ready') { await save('mode', 'autopilot'); toast('⚡ AUTO ON - it reads each prompt, asks the AI, and fills it in'); }
      else { await save('autoMode', 'off'); await save('mode', 'copilot'); toast('Auto OFF - tap ✨ when you want help'); }
      lastSig = '';
      refreshBadges(); refreshGameUI(shownGame);
      return;
    }
    else if (a === 'undo') {
      if (!lastUndo) { toast('Nothing to undo'); return; }
      lastUndo.forEach(({ it, prev }) => { if (!it.el.isConnected) return; if (it.editable) { it.el.textContent = prev; it.el.dispatchEvent(new InputEvent('input', { bubbles: true })); } else setNative(it.el, prev); });
      lastUndo = null; toast('↩️ Undone');
    }
    else if (a === 'resettaste') { await save('taste', { likes: [], dislikes: [] }); toast('Taste reset'); }
    else if (a === 'addkey') {
      showView('settings');
      const f = $(`.settings [data-k="${t.dataset.key}"]`);
      if (f) { f.scrollIntoView({ block: 'center' }); setTimeout(() => f.focus(), 200); }
      toast('Tap "get one" above the box, make a free key, then paste it here and Save');
    }
    else if (a === 'welcomed') { await save('welcomed', true); setOut('<span class="muted">Tap ✨ on any screen: writing, drawing, voting, bidding, trivia, minigames.</span>'); }
    else if (a === 'clearcustom') { $('.settings textarea[data-k="customPrompt"]').value = ''; root.querySelectorAll('[data-sp]').forEach((c) => c.classList.remove('on')); }
    else if (a === 'save') { const changed = await saveSettings(); if (changed) { toast('Checking your AI key…'); verifyFirst().then((msg) => msg && toast(msg)); } }
    else if (a === 'test') { await saveSettings(true); testAI(); }
    else if (a === 'go') run();
    else if (a === 'forget') { clearMemory(); clearObs(); clearSus(); lockedGame = null; shownGame = undefined; shownSig = ''; lastSig = ''; answeredPrompt = ''; typedVals.clear(); toast('New game - memory & case file cleared'); }
    else if (a === 'detective') run(DETECTIVE, false, { detective: true });
    else if (a === 'lookup') run('Verify the facts with search and give the correct / true answer. Put the real answer and confidence % in advice.', false, { search: true, accuracy: true });
    else if (a === 'win') run('Give the single highest-value move to WIN this exact screen for this game - the optimal play, using this game\'s real scoring, not just a funny one. Explain the edge in advice.', false, { accuracy: isAccuracy(shownGame), search: settings.webSearch && !!shownGame && SEARCH_GAMES.has(shownGame.id) });
    else if (a === 'note') {
      const n = $('.extra').value.trim();
      if (!n) { toast('Type a note in the box first (e.g. "Mike hesitated")'); return; }
      addObs({ note: n }); $('.extra').value = ''; toast('📝 Saved to case file');
    }
    else if (a === 'punch') {
      const mine = inventory().filter((i) => i.kind === 'text').map((i) => i.el.value || i.el.innerText).filter(Boolean).join(' / ');
      if (!mine) { toast('Type your answer in the game first'); return; }
      run(`The player wrote: "${mine}". Punch it up: keep their core idea but make it funnier, tighter, and land harder. Include their version tightened as one option.`);
    }
  });
  $('.extra').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });

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
      if (fresh || busy) { panel.classList.add('open'); showView('main'); return; }
      run();
    });
    fab.addEventListener('pointercancel', () => { down = false; });
  })();

  // ---------------------------------------------------------------------------
  // Auto mode
  // ---------------------------------------------------------------------------
  let lastSig = '';
  let debounce = null;
  let pendingSince = 0;
  let answeredPrompt = ''; // the prompt we last filled in (top of the screen, where Jackbox shows it)
  const screenNorm = () => screenText().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  const promptKey = () => screenNorm().slice(0, 100);
  const typedVals = new Set(); // values we typed (to spot a stale answer left over from the last prompt)
  function rememberTyped(v) { typedVals.add(v); while (typedVals.size > 60) typedVals.delete(typedVals.values().next().value); }
  const fieldVal = (i) => String(i.editable ? i.el.innerText : i.el.value).trim();
  function screenBase(items, kind) {
    const shape = items.map((i) => i.kind + ':' + i.desc.replace(/current=("[^"]*"|\S+)/g, '').replace(/\(selected\)/g, '')).join('|');
    return kind + '|' + screenText().replace(/\d+/g, '#').slice(0, 300) + '|' + shape;
  }
  function signature() {
    const items = inventory();
    const kind = screenKind(items);
    if (kind === 'none') return '';
    if (kind === 'pick') {
      if (items.some((i) => i.kind === 'click' && MENU_RE.test(i.desc))) return ''; // lobby / menu screen: hands off
      if (settings.autoMode === 'prompts') { // answer screens worth auto-answering: trivia + "find the truth" votes
        const g = detectGame(screenText());
        if (!(g && (isAccuracy(g) || ['fibbage', 'drawful', 'lieswatter'].includes(g.id)))) return '';
      }
    }
    const base = screenBase(items, kind);
    const filled = items.filter((i) => i.kind === 'text' && fieldVal(i));
    if (filled.length) {
      // the PROMPT changed but the box still holds OUR previous answer -> stale, answer it; anything else = leave it alone
      const stale = !!answeredPrompt && !screenNorm().includes(answeredPrompt) && filled.every((i) => typedVals.has(fieldVal(i)));
      if (!stale) return 'answered';
    }
    if (kind === 'draw' && items.some((i) => i.kind === 'canvas' && canvasHasInk(i.el))) return 'answered';
    return base;
  }
  function autoCheck() {
    if (document.hidden) return; // Safari in the background: do nothing
    try {
      if (settings.autoMode === 'off' || busy || drawing) return;
      const sig = signature();
      if (!sig) { lastSig = ''; return; }
      if (sig === 'answered' || sig === lastSig) return;
      lastSig = sig;
      $('.extra').value = '';
      run('', !panel.classList.contains('open'));
    } catch (_) { /* ignore */ }
  }
  let obsTimer = null;
  let obsSince = 0;
  const observer = new MutationObserver(() => {
    domVersion++;
    if (document.hidden) return; // catch up on visibilitychange instead
    clearTimeout(obsTimer);
    const nowT = Date.now();
    if (!obsSince) obsSince = nowT;
    obsTimer = setTimeout(() => { obsSince = 0; screenTick(); }, Math.max(0, Math.min(1200, obsSince + 2500 - nowT)));
    if (settings.autoMode === 'off' || busy || drawing) return;
    const now = Date.now();
    if (!pendingSince) pendingSince = now;
    clearTimeout(debounce);
    debounce = setTimeout(() => { pendingSince = 0; autoCheck(); }, Math.max(0, Math.min(900, pendingSince + 2000 - now)));
  });
  function screenTick() {
    if (document.hidden) return;
      try {
        const txt = screenText();
        if (txt.length > 20) addObs({ text: txt.slice(0, 700) });
        refreshGameUI(detectGame(txt)); // sig guard inside prevents redundant redraws
        dataHud();
        const gNow = detectGame(txt);
        if (gNow && gNow.id === 'bidiots') { captureBidTips(txt); bidHud(); }
        if (truthGame(gNow)) { truthCatch(txt); truthHud(); }
      } catch (_) { /* ignore */ }
  }

  // ===========================================================================
  // Boot
  // ===========================================================================
  const domReady = () => new Promise((r) => (document.body ? r() : document.addEventListener('DOMContentLoaded', () => r(), { once: true })));
  Promise.all([loadSettings(), domReady()]).then(() => {
    refreshBadges();
    if (settings.fabX !== null && settings.fabY !== null) {
      const x = Math.min(innerWidth - 60, Math.max(4, settings.fabX));
      const y = Math.min(innerHeight - 60, Math.max(4, settings.fabY));
      Object.assign(fab.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
    }
    document.documentElement.appendChild(host);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    try { refreshGameUI(detectGame(screenText())); } catch (_) { /* ignore */ }
    if (needsWelcome()) setOut(welcomeHTML());
    setInterval(() => { if (!pendingSince) autoCheck(); }, 1500);
    setInterval(hudTick, 400);
    document.addEventListener('click', noteSubmit, true); // see what gets submitted (for the truth catcher)
    document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) { const v = String(e.target.value || '').trim(); if (v) lastSubmitted = { vals: [v], t: Date.now() }; } }, true);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { domVersion++; try { observer.takeRecords(); } catch (_) { /* ignore */ } screenTick(); autoCheck(); } });
    addEventListener('scroll', () => renderHud(), { passive: true, capture: true });
    addEventListener('resize', () => renderHud());
    $('.hudpill').addEventListener('click', () => { panel.classList.add('open'); showView('main'); renderHud(); });
    $('.tvcam').addEventListener('change', onTvPhoto);
  });
})();
