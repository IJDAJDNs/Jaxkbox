// ==UserScript==
// @name         Jackbox AI Helper
// @namespace    jaxkbox
// @version      5.3.0
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
    mode: 'copilot', // coach | copilot | autopilot | chaos
    autoMode: 'off', // off | prompts | all
    autoSubmit: false,
    memory: true,
    drawSpeed: 'fast',
    webSearch: true, // live search for trivia / truths (Gemini + Claude)
    readConnection: true, // use the data Jackbox sends to this phone
    fabX: null,
    fabY: null,
    modelCache: {},
  };

  const SPICE = {
    1: { label: '😇 Family', text: 'FAMILY FRIENDLY. No swearing, no innuendo, nothing gross. Clever, silly, wholesome - kids could be playing.' },
    2: { label: '🙂 Normal', text: 'PG-13. Mild swearing and light innuendo are fine. Cheeky, not crude.' },
    3: { label: '😈 Edgy', text: 'R-RATED. Swearing, sex jokes, gross-out, dark and morbid jokes are all fine. Go for the joke that makes the room gasp then laugh - do not play it safe or pick the obvious tame option.' },
    4: { label: '💀 Unhinged', text: 'UNHINGED / NO FILTER. Adults-only room that explicitly wants the darkest, filthiest, most shocking jokes possible: explicit sex jokes and innuendo, death, murder, drugs, bodily fluids, diseases, existential dread, crime, disasters, tragedies, terrible life choices, brutal personal roasts of the players by name. Make people gasp, then laugh. Do NOT soften, hedge, sanitize or add disclaimers. Only line: no slurs and no jokes where a race, religion, sexuality or disability is the punchline - those get groans and lose votes; aim the darkness at situations, the players and yourself instead.' },
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
  const clearMemory = () => { try { sessionStorage.removeItem(MEM_KEY); sessionStorage.removeItem(STATS_KEY); sessionStorage.removeItem('jbai_obs'); sessionStorage.removeItem('jbai_suspects'); } catch (_) { /* ignore */ } };
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
    { id: 'bidiots', name: 'Bidiots', re: /bidiots|auction|place bid/, guide: 'Draw prompts quickly (your art is auctioned). Auction: you get secret info about which paintings are worth more - bid high on ones you know are valuable, let others overpay for junk, protect your cash. Net worth wins.', tips: ['Bid on paintings your secret info says are valuable', 'Never blow all your cash early'] },
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
    fibbage: [['🕵️ Find the truth', 'Voting: identify which choice is the REAL answer. Verify with search if you can. Put the real answer and your confidence % in advice; option 1 = tap the truth.', true], ['🚫 What is the real answer?', 'Tell me the REAL answer to this question in advice (so I avoid typing it) and give lies that sound more true than the truth.', true], ['🤥 Sneakier lie', 'Lies that sound boringly, specifically TRUE - same style and length as a real answer, nothing jokey.']],
    drawful: [['🕵️ Real title?', 'Voting: which title is the real prompt for this drawing? Confidence % in advice.'], ['🤥 Better lie', 'Lies that sound like real Drawful prompts for this drawing.']],
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
    bidiots: [['💰 What is it worth?', 'Using any secret info on screen, estimate each painting\'s value and tell me what to bid.']],
    splitroom: [['⚖️ Perfect 50/50', 'Make the dilemma split the room as close to exactly 50/50 as possible.']],
    jobjob: [['🧩 Best sentence', 'Build the funniest coherent answer using ONLY my word bank words, tapped in order.']],
    teeko: [['👕 Best shirt', 'Pick or make the shirt the room will vote for.']],
    blather: [['🎯 Best words', 'Pick the most precise words so others guess fastest; when guessing, name the most likely famous answer.']],
    madverse: [['🎤 Rhyme + roast', 'Bars that land the rhyme on the LAST word and brutally roast the opponent by name.']],
    survive: [['🪤 Damning caption', 'Twist the quote into the most out-of-context, reputation-destroying caption possible.']],
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
    champdup: [['🏆 Punny champ', 'A bold character that fits the category with a punny name.']],
    civic: [['🖍️ One funny add', 'Add one strong funny detail that builds on what is already drawn.']],
    cookiehaus: [['🍪 Clear + funny', 'Decorate with bold, instantly readable, funny shapes.']],
    roomerang: [['🎭 In character', 'Answer in character and play the alliances to survive.']],
    junktopia: [['🗑️ Punny + wild', 'A punny item name with a wild absurd backstory.']],
    talkingpoints: [['🎪 Max chaos', 'As assistant pick the most chaotic/funny slides; as presenter, confident improv lines.']],
  };
  const isAccuracy = (g) => !!g && ACCURACY_GAMES.has(g.id);
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

  let lockedGame = null;
  function detectGame(text) {
    if (appTag) {
      const t = appTag.toLowerCase();
      const g = GAMES.find((x) => APPTAGS[x.id] && APPTAGS[x.id].test(t));
      if (g) { lockedGame = g; g.via = 'connection'; return g; }
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
    if (best) lockedGame = best;
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

  const SUBMIT_RE = /^(submit|send|done|confirm|lock ?in|bid|place bid|ok|okay|enter|go|vote|finish|i'?m done|send it|that'?s it)\b/i;
  const canvasSpace = (r) => ({ W: 1000, H: Math.max(1, Math.round(1000 * r.height / r.width)) });

  function inventory() {
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
      if (el.closest('#jbai-host') || !isVisible(el)) continue;
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
        const r = el.getBoundingClientRect();
        if (r.width < 120 || r.height < 120) continue;
        const { W, H } = canvasSpace(r);
        add(el, 'canvas', `canvas (drawing area) ${Math.round(r.width)}x${Math.round(r.height)}px - draw coords x 0-${W}, y 0-${H}`);
      } else if (tag !== 'INPUT') {
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
        const img = el.querySelector('img');
        const text = clean(el.innerText || el.getAttribute('aria-label') || el.title || (img && img.alt), 160);
        const r = el.getBoundingClientRect();
        const color = solidColor(el);
        const cs = getComputedStyle(el);
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
    return items.filter((it) => !(it.kind === 'click' && items.some((o) => o !== it && o.kind === 'click' && it.el.contains(o.el) && o.desc === it.desc)));
  }

  function guessSubmit(items) {
    const i = items.findIndex((it) => it.kind === 'click' && SUBMIT_RE.test(it.desc.replace(/^button "/, '')));
    return i === -1 ? null : i;
  }

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
        if (el.tagName === 'CANVAS') { if (canvasHasInk(el)) out.push(toJpegB64(el, el.width, el.height)); }
        else if (el.complete && el.naturalWidth) out.push(toJpegB64(el, el.naturalWidth, el.naturalHeight));
      } catch (_) { /* cross-origin - skip */ }
    }
    return out;
  }

  const screenText = () => (document.body.innerText || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);

  function screenKind(items) {
    const drawCue = items.some((i) => i.kind === 'swatch') || /\b(draw|sketch|doodle|paint|design|decorate)/i.test(document.body.innerText || '');
    if (drawCue && items.some((i) => i.kind === 'canvas')) return 'draw';
    if (items.some((i) => i.kind === 'text' || i.kind === 'number')) return 'write';
    if (items.filter((i) => i.kind === 'click').length >= 2) return 'pick';
    return 'none';
  }

  function readContext(tweak) {
    const items = inventory();
    const text = screenText();
    const game = detectGame(text);
    return { screenText: text, items, submitGuess: guessSubmit(items), images: screenImages(), tweak, game, kind: screenKind(items), accuracy: isAccuracy(game), search: settings.webSearch && !!game && SEARCH_GAMES.has(game.id) };
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

DRAWING: canvas coords x 0-1000, y 0-H (H given per canvas). Shapes in order:
  {"line":[x1,y1,x2,y2,...]} (many points for curves) | {"poly":[x1,y1,...],"fill":true} | {"circle":[cx,cy,r],"fill":true} | {"ellipse":[cx,cy,rx,ry],"fill":true} | {"rect":[x,y,w,h],"fill":true}
Optional per shape: "color": <swatch element index> (stays selected until changed - set it whenever it changes), "brush": <brush-size element index>. "fill" scribble-fills.
Craft: BIG, centered, ~80% of canvas. Bold, simple, instantly recognizable. Fills first, outlines and details on top, then the one funny detail that sells it. 15-60 shapes. Faces = eyes + expressive mouth. No written words unless the game wants labels.

GAME DATA (when present) is the raw state Jackbox sent to this phone - prompts, choices, player names, scores, sometimes details not drawn on screen. Trust it over guesses; never invent data. The CASE FILE is every screen this phone saw this game plus the player's own notes.
TRUTH: if you have a web search tool, use it to verify facts (trivia, Fibbage/Lie Swatter truths, years, percentages) and say the real answer in advice. Never claim to know a hidden server-side secret (who the faker/alien is) unless it is in the data.

COMEDY: silently brainstorm 15+ ideas, throw away the first 5 (everyone else writes those), return the best. Specific beats generic (real brands, celebrities, places, oddly precise numbers). Short. Funniest word LAST. Misdirection, escalation, brutal honesty, callbacks, roast players by name (names are on screen). Every option a different angle. COMMIT to the bit: no hedging, no disclaimers, no apologies, no softening. Match the humor level fully - at Edgy/Unhinged be genuinely dark, filthy and mean within the one hard line (no slurs, and nothing whose punchline is that a race, religion, sexuality or disability is bad); if an idea would need that, aim the same darkness at the situation, the players or yourself instead - never water it down to a safe joke. For trivia/estimates/logic: be CORRECT - think carefully, humor irrelevant.

Respond with ONLY a JSON object (no markdown, no comments):
{"game":"<game - phase>","advice":"<one short sentence, or empty>","submit":<submit button index or null>,"suspects":[{"name":"<player>","prob":<0-100>,"why":"<evidence>"}] (ONLY in social-deduction games; probabilities across players should sum to ~100; otherwise omit),
 "options":[{"label":"<2-5 word title>","text":"<the answer as the player should see it>","score":<1-10 predicted crowd reaction or confidence>,"why":"<short reason, only if asked>","actions":[...]}]}
Lobby/waiting screen: "options":[] and a short advice.`;

  function buildUserText(ctx) {
    const L = [];
    L.push('PHONE SCREEN TEXT:\n"""\n' + ctx.screenText + '\n"""');
    L.push('\nELEMENTS:');
    if (!ctx.items.length) L.push('  (none)');
    ctx.items.forEach((it, i) => L.push(`  [${i}] ${it.desc}`));
    if (ctx.images.length) L.push(`\n(${ctx.images.length} image(s) of the screen attached.)`);
    if (ctx.game) L.push(`\nDETECTED GAME: ${ctx.game.name}${ctx.game.via === 'connection' ? ' (certain - from the room data)' : ''}\nPLAYBOOK: ${ctx.game.guide}`);
    else L.push(`\nGAME: ${appTag ? 'room app tag "' + appTag + '" - ' : ''}not in my list - infer it from the screen (any Jackbox Party Pack 1-11 game or standalone).`);
    const gd = gameData();
    if (gd) L.push('\nGAME DATA (from this phone\'s connection):\n' + gd);
    const obs = loadObs();
    const wantCase = ctx.detective || isDeduction(ctx.game);
    if (obs.length) {
      L.push(`\nCASE FILE (${wantCase ? 'full' : 'recent'}):`);
      obs.slice(wantCase ? -25 : -3).forEach((o) => L.push(o.note ? `  NOTE from player: ${o.note}` : `  SCREEN: ${clean(o.text, wantCase ? 500 : 220)}`));
    }
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
    if (settings.style) L.push('THE ROOM: ' + settings.style);
    L.push(ctx.kind === 'draw'
      ? 'Give 2 drawing options (different ideas). If there are text boxes too, fill them in the same option.'
      : ctx.kind === 'pick' ? 'Give up to 3 options, best first.'
        : `Give ${settings.count} options, best first.`);
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

  async function http(method, url, headers, body) {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const TIMEOUT = 75000; // a stuck service shouldn't block switching to the next one
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
    let res = await http('POST', 'https://api.anthropic.com/v1/messages', headers, body);
    if (opt.search && res.status === 400) { delete body.tools; res = await http('POST', 'https://api.anthropic.com/v1/messages', headers, body); }
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
    let res = await http('POST', url, hdr, body);
    if (opt.search && [400, 403, 429].includes(res.status)) { // search quota/unsupported: answer without it
      delete body.tools; body.generationConfig.responseMimeType = 'application/json';
      res = await http('POST', url, hdr, body);
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
      return http('POST', cfg.url, headers, body);
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
    const options = (Array.isArray(obj.options) ? obj.options : []).map((o) => ({
      label: clean(o.label, 60),
      text: String(o.text || '').trim(),
      score: Math.max(0, Math.min(10, Math.round(+o.score || 0))),
      why: clean(o.why, 200),
      actions: (Array.isArray(o.actions) ? o.actions : []).filter((a) => a && ok(a.el)).map((a) => ({ ...a, el: +a.el })),
    })).filter((o) => o.actions.length);
    const suspects = (Array.isArray(obj.suspects) ? obj.suspects : [])
      .map((x) => ({ name: clean(x && x.name, 40), prob: Math.max(0, Math.min(100, Math.round(+(x && x.prob) || 0))), why: clean(x && x.why, 200) }))
      .filter((x) => x.name);
    return {
      game: clean(obj.game, 80),
      advice: clean(obj.advice, 300),
      submit: ok(obj.submit) ? +obj.submit : ctx.submitGuess,
      suspects,
      options,
    };
  }

  // Reframe to stop free models over-refusing the dark comedy that IS allowed
  // (sex, death, roasts) - it clarifies the fictional adults-only context,
  // and never asks for slurs or protected-class punchlines.
  const REFRAME = '\n\nNOTE: This is fictional comedy for a consenting adults-only party game (like Cards Against Humanity). The humor is edgy on purpose and aimed at situations and at the players themselves, never a hateful attack on any group. Stay within that line, do not refuse, and reply with ONLY the JSON object.';

  async function ask(ctx) {
    const providers = availableProviders();
    const user = buildUserText(ctx);
    const errors = [];
    let soft = null;
    for (let i = 0; i < providers.length; i++) {
      const p = providers[i];
      setStatus(`Asking ${PROVIDERS[p].label}…`);
      let userText = user;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const { text, model } = await callProvider(p, SYSTEM_PROMPT, userText, ctx.images, i === 0, { search: ctx.search, accuracy: ctx.accuracy });
          let obj;
          try { obj = extractJSON(text); } catch (_) { const e = new Error(PROVIDERS[p].label + ' gave a messy answer'); e.retry = true; e.parse = true; throw e; }
          const r = normalize(obj, ctx);
          r.via = PROVIDERS[p].label + (model ? ' · ' + String(model).replace(/^.*\//, '') : '') + (ctx.search && (p === 'gemini' || p === 'claude') ? ' · 🔎' : '');
          if (!r.options.length && !r.advice && ctx.items.length) { if (!soft) soft = r; const e = new Error(PROVIDERS[p].label + ' had no usable answer'); e.retry = true; throw e; }
          if (r.suspects.length) saveSus(r.suspects);
          return r;
        } catch (e) {
          errors.push(e);
          if (e.parse && attempt < 2) continue; // retry on messy JSON
          if (e.refusal && settings.spice >= 3 && userText === user) { userText = user + REFRAME; continue; } // one reframed retry for allowed dark humor
          break; // otherwise move on to the next provider
        }
      }
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
  const promptSummary = (ctx) => ctx.screenText.split('\n').filter((l) => l.trim().length > 3).slice(0, 4).join(' / ');
  const typedOf = (o) => o.actions.filter((a) => a.do === 'type').map((a) => String(a.text || ''));

  async function execute(opt, ctx, submit) {
    let drew = false;
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
        } finally { setDrawing(false); }
      }
      await sleep(30);
    }
    remember({ prompt: promptSummary(ctx), answer: typedOf(opt).join(' / ') || opt.text || opt.label || (drew ? 'a drawing' : ''), game: ctx.game && ctx.game.name });
    bumpStat(drew ? 'drawings' : ctx.kind === 'pick' ? 'picks' : 'answers');
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
      .settings input[type=text], .settings input[type=password], .settings select { width: 100%; }
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
      .toast { position: fixed; z-index: 2147483647; left: 50%; bottom: 150px; transform: translateX(-50%); background: rgba(0,0,0,.88); color: #fff;
               padding: 9px 15px; border-radius: 999px; font-size: 14px; display: none; max-width: 90vw; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    </style>
    <button class="fab" title="Jackbox AI Helper">✨<span class="dot"></span><span class="badge"></span></button>
    <div class="toast"></div>
    <div class="panel">
      <div class="row">
        <span class="title">✨ <span class="gname">Jackbox AI</span></span>
        <button class="btn" data-act="guide" title="Game guide">📖</button>
        <button class="btn" data-act="history" title="History">🕘</button>
        <button class="btn" data-act="settings" title="Settings">⚙️</button>
        <button class="btn" data-act="close">✕</button>
      </div>
      <div class="view main">
        <div class="gamebar"></div>
        <div class="chips">
          <button class="chip" data-tweak="Way darker and more shocking. Push it further.">🔥 Darker</button>
          <button class="chip" data-tweak="Cleaner - safe for anyone in the room, still funny.">😇 Cleaner</button>
          <button class="chip" data-tweak="Way more absurd and surreal. Weird wins.">🤪 Weirder</button>
          <button class="chip" data-tweak="Much shorter: 2-5 words if possible. For drawings: simpler, bolder, fewer shapes.">✂️ Shorter</button>
          <button class="chip" data-tweak="Smarter: clever wordplay, puns, double meanings, visual puns.">🧠 Clever</button>
          <button class="chip" data-tweak="Roast the other players in the room by name (use names from the screen).">🎯 Roast</button>
          <button class="chip" data-tweak="Pop culture: reference memes, movies, shows, celebrities, viral moments.">📺 Pop culture</button>
          <button class="chip" data-tweak="For drawings: much more detailed and colorful, 50-80 shapes, more color fills.">🎨 Fancier art</button>
          <button class="chip" data-act="punch">✍️ Punch up mine</button>
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
        <div class="row" style="margin-top:14px">
          <button class="btn primary" data-act="save">Save</button>
          <button class="btn" data-act="forget">New game</button>
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
  function refreshGameUI(g) {
    $('.gname').textContent = g ? g.name : 'Jackbox AI';
    if (g === shownGame && $('.gamebar').dataset.ready) return;
    shownGame = g;
    const bar = $('.gamebar');
    bar.dataset.ready = '1';
    if (!g) { bar.innerHTML = roomCode ? `<span class="muted">📡 Room ${esc(roomCode)}${appTag ? ' · ' + esc(appTag) : ''}</span>` : ''; return; }
    const modeTxt = isDeduction(g) ? '🕵️ Detective mode' : isAccuracy(g) ? '🎯 Accuracy mode' + (settings.webSearch ? ' + 🔎 search' : '') : SEARCH_GAMES.has(g.id) ? '🔎 Truth-finder ready' : '😂 Comedy mode';
    const chips = (GAME_CHIPS[g.id] || []).map((c, i) => `<button class="chip game" data-gchip="${i}">${esc(c[0])}</button>`).join('');
    bar.innerHTML = `<div class="muted">🎮 <b>${esc(g.name)}</b> ${g.via === 'connection' ? '(confirmed)' : '(detected)'} → ${modeTxt}${roomCode ? ' · room ' + esc(roomCode) : ''}</div>${chips ? `<div class="chips" style="margin-top:6px">${chips}</div>` : ''}`;
  }

  function fillSettings() {
    root.querySelectorAll('.settings [data-k]').forEach((el) => {
      const v = settings[el.dataset.k];
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    });
    for (const n of ['spice', 'autoMode', 'mode']) { pending[n] = settings[n]; refreshSeg(n); }
  }

  async function saveSettings(quietly) {
    for (const el of root.querySelectorAll('.settings [data-k]')) {
      const k = el.dataset.k;
      let v = el.type === 'checkbox' ? el.checked : el.value.trim();
      if (k === 'count') v = parseInt(v, 10) || 5;
      if ((/Key$/.test(k) || k === 'customModel') && v !== settings[k]) { settings.modelCache = {}; store.set('modelCache', {}); }
      await save(k, v);
    }
    await save('spice', +pending.spice);
    await save('autoMode', pending.autoMode);
    await save('mode', pending.mode);
    refreshBadges();
    lastSig = '';
    if (quietly) return;
    showView('main');
    setOut(`<span class="muted">Saved. AI order: ${availableProviders().map((p) => PROVIDERS[p].label).join(' → ')}</span>`);
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
      if (!quiet) setOut(`<span class="muted">Nothing to tap on this screen yet. Tap ✨ when a prompt, drawing pad or choices show up.${ctx.game ? ' Meanwhile 📖 has tips for ' + esc(ctx.game.name) + '.' : ''}</span>`);
      return;
    }
    busy = true;
    fab.classList.add('busy');
    fab.classList.remove('ready');
    setOut(`<span class="muted">${ctx.kind === 'draw' ? 'Sketching… 🎨' : 'Cooking… 🍳'}</span>`);
    const t0 = Date.now();
    let pilot = null;
    try {
      const result = await ask(ctx);
      ctx.result = result;
      render(result, ctx, ((Date.now() - t0) / 1000).toFixed(1));
      if ((settings.mode === 'autopilot' || ctx.retried) && (!tweak || ctx.retried) && result.options.length) pilot = result.options[0];
      else if (quiet && !panel.classList.contains('open')) fab.classList.add('ready');
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

  function render(result, ctx, secs) {
    let html = `<div class="muted">🎮 ${esc(result.game || (ctx.game && ctx.game.name) || 'Jackbox')} · ${secs}s · ${esc(result.via || '')}</div>`;
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
    const t = e.target.closest ? e.target.closest('[data-act],[data-tweak],[data-v],[data-mode],[data-preset],[data-gchip]') : null;
    if (!t) return;
    if (t.dataset.gchip !== undefined) {
      const c = shownGame && (GAME_CHIPS[shownGame.id] || [])[+t.dataset.gchip];
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
    else if (a === 'back') showView('main');
    else if (a === 'save') saveSettings();
    else if (a === 'test') { await saveSettings(true); testAI(); }
    else if (a === 'go') run();
    else if (a === 'forget') { clearMemory(); clearObs(); clearSus(); lockedGame = null; shownGame = undefined; toast('New game - memory & case file cleared'); }
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
  function signature() {
    const items = inventory();
    const kind = screenKind(items);
    if (kind === 'none') return '';
    if (settings.autoMode === 'prompts' && kind === 'pick') return '';
    if (items.some((i) => i.kind === 'text' && String(i.editable ? i.el.innerText : i.el.value).trim())) return 'answered';
    if (kind === 'draw' && items.some((i) => i.kind === 'canvas' && canvasHasInk(i.el))) return 'answered';
    const shape = items.map((i) => i.kind + ':' + i.desc.replace(/current=("[^"]*"|\S+)/g, '').replace(/\(selected\)/g, '')).join('|');
    return kind + '|' + screenText().replace(/\d+/g, '#').slice(0, 300) + '|' + shape;
  }
  let obsTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(obsTimer);
    obsTimer = setTimeout(() => {
      try {
        const txt = screenText();
        if (txt.length > 20) addObs({ text: txt.slice(0, 700) });
        const g = detectGame(txt);
        if (g !== shownGame) refreshGameUI(g);
      } catch (_) { /* ignore */ }
    }, 1200);
    if (settings.autoMode === 'off' || busy || drawing) return;
    const now = Date.now();
    if (!pendingSince) pendingSince = now;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      try {
        pendingSince = 0;
        if (busy || drawing) return;
        const sig = signature();
        if (!sig) { lastSig = ''; return; }
        if (sig === 'answered' || sig === lastSig) return;
        lastSig = sig;
        $('.extra').value = '';
        run('', !panel.classList.contains('open'));
      } catch (_) { /* ignore */ }
    }, Math.max(0, Math.min(900, pendingSince + 2000 - now)));
  });

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
  });
})();
