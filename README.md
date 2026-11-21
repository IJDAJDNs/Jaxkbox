# ✨ Jackbox AI Helper (iPhone, free)

An AI sidekick for **jackbox.tv** in Safari. On any screen, tap ✨ and it reads your phone, works out which game you're in, and plays like an expert. It **writes answers, draws pictures, bids, votes, answers trivia, sets sliders and handles minigames.**

**Free:** it works with no setup using free AI. Add a free Google Gemini key (2 minutes, no credit card) for smarter answers.

## Every game, every screen

It recognises **43 Jackbox games** from Party Packs 1–11 and the standalones, and loads an expert playbook for each one. On a screen it doesn't recognise, the AI reads the instructions and works it out.

| Screen type | Examples | What ✨ does |
|---|---|---|
| ✍️ Writing | Quiplash, Fibbage lies, Joke Boat, Survive the Internet, Mad Verse City, Split the Room | Answers built to win the vote. Tap one and it's typed in |
| 🎨 Drawing | Drawful, Tee K.O., Bidiots, Champ'd Up, Civic Doodle, Patently Stupid, Weapons Drawn | Shows a preview, then **draws it on the canvas** with the game's colors |
| 💰 Bidding / sliders / numbers | Bidiots, Guesspionage, Timejinx, Nonsensory | Sets a smart value and can press Bid |
| 🔪 Trivia & minigames | Trivia Murder Party 1 & 2, YDKJ, Lie Swatter, Wheel, Bomb Corp | Correct answers, survives the death games, solves the bomb rules |
| 🧩 Word banks / word pickers | Job Job, Blather 'Round | Taps the right words in order |
| 🗳️ Voting | Every game | Picks what the room will vote for, or the **real answer** in Fibbage and Drawful |
| 🕵️ Social deduction | Push the Button, Fakin' It, Hypnotorious | Strategy for blending in or catching the impostor |

## 🆕 v8.0: answers ON the game screen + 🔬 X-ray

- **🎯 On-screen overlay.** Answers now appear as labels pinned right on top of the game's own buttons, so you don't have to open the panel:
  - **Bidiots:** "💰 worth ~$2,400" over each painting, and "🎯 set to 1800" with a glowing ring on the bid slider.
  - **Trivia:** a green "✅ best pick" ring on the right answer, plus "2nd" on the runner-up.
  - **Fibbage/Drawful voting:** truth % on each choice. **Impostor games:** suspect % on each player.
  - A tip bar beside ✨ shows the top answer; tap it to open the panel.
  - Labels never block your taps, follow the screen when it scrolls, and disappear when the screen changes. Turn it off in ⚙️ if you want.
- **🔬 X-ray, no AI needed.** It reads everything the game sends your phone and pulls out anything that looks like a hidden value (price, worth, correct, role, score…). When those values belong to something on screen, they're pinned on it in blue instantly, with no AI call. The 🔬 button shows the full list and the raw data, and the AI gets the values too.
  - **Honest limit:** most secret answers (trivia answers, painting worth, who the faker is) stay on the host TV/PC and are never sent to phones. X-ray shows them whenever a game does send them; otherwise the AI estimates.
- **Cooler UI:** labels pop in, the best answer gets a glowing ring, and the top card pulses.

## 🆕 v7.0: instant answers, learns your taste, safer Auto

- **⚡ button now has 3 modes:** tap to cycle **OFF → READY → AUTO**.
  - **READY** loads answers in the background the moment a prompt appears. Tap ✨ and they're already there, nothing gets filled in for you.
  - **AUTO** also fills them in.
- **Auto now handles trivia and truth votes too.** It picks the right answer in Trivia Murder Party, YDKJ, Lie Swatter and other trivia, and the real answer in Fibbage/Drawful voting.
- **Auto is safer:**
  - It never presses menu buttons ("Same players", "Everybody's in", etc.).
  - It never accuses someone automatically in impostor games. It shows the suggestion and you decide.
- **👍/👎 on every answer.** It remembers what you like (even between games) and writes more like it. Reset it in ⚙️.
- **🏁 Race mode (optional, ⚙️):** asks your top two AIs at once, shows whichever answers first, and adds the other one's answers when they arrive. It uses double the free quota, so it's off by default.
- **↩️ Undo** puts back whatever was in the box before the last fill.
- **First-run setup card:** a fresh install shows one-tap buttons to add a free Groq or Gemini key.

## 🆕 v6.0: answers every prompt, faster, funnier-first

- **Fixed: Auto mode skipping the 2nd prompt.** In Quiplash-style rounds, the next prompt sometimes appeared while the box still held your last answer, so Auto thought it was done. It now spots that and answers every prompt. If you type your own answer, it still leaves you alone.
- **Fixed: only filling one of two boxes.** On Thriplash and other multi-box screens, every answer now fills every box, and half-filled answers are thrown out.
- **Funnier beats inappropriate.** If a clean answer is funnier for your room, it picks that over a dirty one.
- **Faster:**
  - Smaller prompts: drawing instructions are only sent on drawing screens.
  - No photos sent unless the game needs them.
  - Lighter thinking on Gemini for joke rounds.
  - If an AI stalls, it switches to the next one after ~25s instead of 75s.

## 🆕 v5.9: built for YOUR audience

Funny *to this room* is now the AI's #1 goal:
- **Reads the room first.** Before writing, it looks at your room description, the players' names, and how the game is going, then picks the humor this crowd will actually vote for. With no description it aims for jokes that land with almost any group of friends.
- **Learns from the votes.** When a results screen shows which answers won (votes, likes, QUIPLASH), it sees that and leans into what's working and away from what flopped.
- **Room read.** It keeps a running one-line read of your crowd (e.g. *"loves absurd animal bits, roasts of Mike land"*) that improves every round. Check it in 🕘 history. **New game** resets it.

## 🆕 v5.8: smarter dark humor

Edgy and Unhinged now set how far the AI is **allowed** to go, not how far it **has** to go. It goes dark or filthy when the prompt sets it up and that's genuinely the funniest answer, and uses clever, absurd or brutally honest answers when those would get more votes. Each batch mixes angles (e.g. one dark, one clever, one absurd), with the funniest ranked first. When it does go dark, it still commits fully. Want it darker on a specific prompt? Tap **🔥 Darker**.

## 🆕 v5.7: big game banner, exact names, one-tap auto-answer

- **⚡ Auto-answer toggle** right at the top: turn it on and it **reads each prompt, sends it to the AI, and fills in the answer by itself** — hands-free, every round. Turn it off to go back to tapping ✨.
- **Big, obvious game banner** at the top of the panel showing the detected game and mode in a highlighted bar, updated live as the game changes.
- **Exact real game names** — it shows the specific title it detects from your phone's connection (e.g. *Fibbage 4*, *Quiplash 3*, *Trivia Murder Party 2*, *Drawful: Animate*), marked **auto-detected ✓**, not just the series name.

## 🆕 v5.6: instant key check on Save

When you paste a key and tap **Save**, it now pings the AI right away and tells you **✅ Gemini is working** or **❌ key was rejected** — so you know it's set up before the game starts, no guessing.

## 🆕 v5.5: one-tap style presets

The Custom Instructions box now has **tap-to-add style chips** — no typing needed. Tap one or stack several:
🤯 Pun machine · 🔪 Short & savage · 🎬 Movie buff · 📱 Chronically online · 🧠 Big brain · 🌀 Max absurd · 🥂 Roast the room · 💀 As dark as allowed · 🎯 Just win · 🍆 Filthy. Tap **Clear** to reset. You can still type your own on top.

## 🆕 v5.4: Custom Instructions — tell the AI exactly how to answer

Settings now has a **✍️ Custom instructions** box. Anything you type there is added to the prompt on **every** answer — the strongest way to make it play your way. Examples:
- `Keep every answer under 5 words.`
- `Always work in a reference to The Office.`
- `Be way meaner and roast people harder.`
- `Prefer absurd/surreal over gross-out.`
- `Our group loves puns — always try a pun first.`

### Set your Gemini key (2 min, free, big upgrade)
1. Open **aistudio.google.com/apikey** in Safari, sign in with any Google account.
2. Tap **Create API key**, copy it (starts with `AIza`).
3. In a game, tap **✨ → ⚙️**, paste it into **Gemini key**, tap **🔌 Test AI**, then **Save**.

### How to tune it to win
- **Humor level** 😈/💀 for bold answers; **Comedy voice** to match your group (Savage, Gen Z, Pun master…).
- **Room box / presets** so it knows the crowd; **Custom instructions** for your exact style.
- **🏆 Win this** on any screen for the optimal play; **🔎 Look it up** / **🕵️ Find the truth** for trivia and Fibbage.
- Short timers? Settings → **Model: Groq** or **Haiku**, **Thinking: Fast**.
- Advanced: the **Custom model name** box takes any model your key can reach. Power users can also edit the `SYSTEM_PROMPT` text near the top of `jackbox-ai-helper.user.js` directly.

## 🆕 v5.3: hardened — tested across every mode, no crashes

- **Smarter AI fallback.** If an AI returns an empty or useless answer (not just an error), it automatically moves to the next AI that *can* answer, instead of showing nothing. Verified: a blank Gemini reply fell through to Groq and still filled the box.
- **Crash-proof.** The connection reader, screen watcher and auto-run are each wrapped so a weird game message or odd screen can never break the helper. Tested by flooding it with garbage connection data — it kept working with zero errors.
- **Verified on 10 games at once** spanning writing, drawing, voting, trivia, sliders, word banks, deduction and an unknown game — all rendered, zero console errors.
- Note: the app already routes across **five external AIs** (Gemini, Groq, OpenRouter, Pollinations, Claude) and falls back automatically, and the **custom-model box** lets you point it at any model your key can reach.

## 🆕 v5.2: an edge for every game + committed (not soft) humor

- **Every game mode has a one-tap edge.** On top of auto-detection, 38 games now have a tailored button, and there's a universal **🏆 Win this** that gives the single best move on any screen using that game's real scoring. Examples: Mad Verse City → *🎤 Rhyme + roast*, Survive the Internet → *🪤 Damning caption*, Guesspionage → *📊 Best estimate*, Role Models / Poll Mine / Survey Scramble → *📊 Read the room*, Bracketeering → *🏆 Bracket-proof*, plus the deduction and trivia tools from before. The only three games with no special help are Dodo Re Mi (rhythm) and Zeeple Dome (physics), which can't be solved by an assistant, and plain collaborative texting.
- **Humor commits to the bit.** At Edgy/Unhinged it's told not to hedge, disclaim, apologize or soften — go genuinely dark and filthy and mean, within the one hard line (no slurs, nothing whose punchline is that a race/religion/sexuality/disability is bad). Slightly higher randomness at Unhinged for more surprising answers. If a model refuses an *allowed* dark joke, it re-asks once with the adults-only context before switching AIs.

## 🆕 v5: auto game detection, impostor hunting, truth finder

- **Knows exactly which game you're in.** It reads the game info Jackbox already sends to your phone (room code → game ID), so it knows the game even when the name isn't on screen. Then it **switches to that game automatically**:
  - 😂 **Comedy mode** for Quiplash, Joke Boat and the like.
  - 🎯 **Accuracy mode** for trivia, minigames and estimates: careful reasoning, low randomness, web search, confidence %.
  - 🕵️ **Detective mode** for Push the Button, Fakin' It, Weapons Drawn, Hypnotorious and Suspectives.
  - Game-specific buttons appear at the top: Fibbage gets *🕵️ Find the truth / 🚫 What's the real answer?*, Push the Button gets *🛸 Who is the alien? / 👽 I am the alien*, Fakin' It gets *🔍 Who is faking? / 🎭 I am the faker*, TMP gets *🔎 Look it up / 🧮 Solve carefully*, and more.
- **🎯 Suspect-o-meter.** In social-deduction games it shows a live probability bar for each player — who's most likely the impostor — and it **builds up every round**: each new read updates the odds instead of starting over. Works from the evidence your phone actually sees (everyone's answers, votes, prompts) plus your own 📝 notes. It's the real, honest version of "who is it": inference from observable play, the same way a sharp human reads the table. (The server never tells your phone the true answer, so no app can do better than read the tells — this reads them well.)
- **🕵️ Impostor case file.** It quietly saves every screen your phone sees during the game (everyone's answers, votes, prompts). Add your own observations with **📝 Save note** ("Mike hesitated", "Jo copied Sarah"). **Find impostor** ranks the suspects with % and evidence, and puts the accuse buttons in order.
- **🔎 Truth finder.** Live web search (free with Gemini, or with Claude) checks trivia, Fibbage truths, Lie Swatter facts, Timejinx years and Guesspionage percentages. It tells you the real answer so you can vote for it, or avoid typing it as your lie.
- **Fixes itself.** If the game ignores typed text, it types it another way. If the screen changes before you tap, it re-reads the screen and answers the new one.
- **Darker Unhinged mode, fewer refusals:** explicit sex jokes, death, drugs and brutal personal roasts are all fair game. If a free model balks at an *allowed* dark joke, it automatically re-asks once with the adults-only party-game context spelled out before trying another AI — so edgy jokes get through instead of getting a polite "no". The one hard line it keeps: no slurs and no jokes where a race, religion, sexuality or disability is the punchline.

**Honest limits:** the hidden answers (who the faker or alien is, the real Fibbage answer, the other team's secrets) live on Jackbox's server and are **never sent to your phone**, so no script can read them. The helper gets as close as possible: case-file analysis for impostors and web search plus AI knowledge for truths. Rhythm (Dodo Re Mi) and physics flicking (Zeeple Dome) only get tips.

## Features
- **Free AI with automatic fallback:** Gemini, Groq, OpenRouter and Pollinations are free; Claude is paid. If one is busy, rate-limited or refuses a joke, it switches to the next.
- **Game detection + expert playbooks** for each game, plus a free 📖 **offline guide**.
- **Play modes:** 🎓 Coach (explains *why* each answer works) · 🤝 Co-pilot · 🤖 Autopilot (plays for you, can press Submit) · 🌀 Chaos.
- **Humor dial:** 😇 Family → 🙂 Normal → 😈 Edgy → 💀 Unhinged.
- **11 comedy voices:** Deadpan, Absurdist, Pun master, Dad jokes, Gen Z, Savage, Shakespeare, Corporate, Conspiracy, Wholesome chaos, Crowd-pleaser.
- **Room presets** (College, Family, Coworkers, Gamers, Adults, Boomers) plus your own inside jokes.
- **Remix chips:** 🔥 Darker · 😇 Cleaner · 🤪 Weirder · ✂️ Shorter · 🧠 Clever · 🎯 Roast · 📺 Pop culture · 🎨 Fancier art · ✍️ Punch up mine · ❓ Explain.
- **🔥 Score** on every answer (predicted crowd reaction), **Use + Submit**, 🔁 more-like-this, 📋 copy.
- **Ask anything:** type a question in the box ("what do I do here?", "who's the alien?").
- **Game memory** for callbacks, plus a 🕘 **history** with stats (answers, drawings, picks).
- **Auto-run:** answers are ready the moment a screen appears. Green dot = ready.
- Draggable ✨ button. While drawing it becomes ⏹ with a progress % (tap to stop).

## Install on iPhone (about 5 minutes)

### 1. Install the Userscripts app
1. Install **Userscripts** (by Justin Wasack, free) from the App Store.
2. Open it once and tap **Set Userscripts Directory**. Pick or create a folder (e.g. *On My iPhone → Userscripts*).
3. **Settings → Apps → Safari → Extensions → Userscripts**: turn it **on**, and set **jackbox.tv** (or All Websites) to **Allow**.

### 2. Install the script
1. In **Safari**, open:
   **https://raw.githubusercontent.com/IJDAJDNs/Jaxkbox/claude/keen-dirac-mt2d7f/jackbox-ai-helper.user.js**
2. Tap the **puzzle piece / aA** button in the address bar → **Userscripts** → **Install**.
   (No Install button? Share → **Save to Files** → save it into your Userscripts folder.)

### 3. Play
Open **jackbox.tv**, join a game, and tap the pink **✨**. That's it. It already works for free.

### 4. (Recommended) Add a free Gemini key for much better answers
1. Go to **aistudio.google.com/apikey** and sign in with any Google account.
2. Tap **Create API key** and copy it.
3. In the game, tap ✨ → ⚙️ → paste it into **Gemini key** → **🔌 Test AI** → **Save**.

Optional extra free keys, so it can switch when one is busy:
- **Groq** (console.groq.com/keys): the fastest, great for short timers.
- **OpenRouter** (openrouter.ai/keys): free models.

**Claude** (console.anthropic.com) is paid (a few cents per tap) but gives the funniest answers and the best drawings.

## How to use it in a game
1. On any screen where you have to do something, tap **✨**.
2. The purple-outlined card is the top pick, and 🔥 shows how hard it should hit.
3. **Tap a card** to use it, or **Use + Submit / Draw + Submit** to send it too.
4. Not feeling it? Tap a chip (🔥 Darker, 🎯 Roast…), 🔁 on an answer you like, or type a direction and tap **Go**.

**Hands-free:** tap **🤖 Autopilot** under the Go box, then ⚙️ → Auto-run **Everything** + **Autopilot also presses Submit**.

## Which AI should I use?

| AI | Cost | Setup | Notes |
|---|---|---|---|
| Pollinations | Free | None | Works out of the box. Slower, rate-limited, text-only (can't see drawings) |
| **Gemini** | **Free** | Free Google key | **Best free option.** Smart, sees images, good drawings |
| Groq | Free | Free key | Fastest. Great for short timers. (This is Groq — not xAI's "Grok".) |
| OpenRouter | Free models | Free key | Extra backup |
| Claude | Paid (cents) | Paid key | Funniest answers, best art |

Leave **Use = Auto** and add every key you have: it uses the best one and falls back automatically.

## Troubleshooting

| Problem | Fix |
|---|---|
| No ✨ button | Puzzle piece → Userscripts → allow on jackbox.tv, then reload. Check the extension is on in Safari settings. |
| "Rate-limited" | Free tiers have per-minute limits. Wait 30s, or add another free key so it can switch. |
| "Key was rejected" | Re-copy the key into ⚙️ and tap 🔌 Test AI. |
| "The AI passed on this one" | Tap 😇 Cleaner or lower the humor level a notch (free AIs are stricter than Claude). |
| Answers are meh | Add a free Gemini key. Try a different comedy voice. Set the room description. |
| Drawing doesn't appear | It tries touch, pointer and mouse input automatically. If nothing shows, tell me which game. |
| Answer doesn't fill the box | Use 📋 and paste it in. |

## Privacy
Keys stay on your phone and are only sent to that AI's own server. What's on your Jackbox screen is sent to the AI you pick. Free tiers (like Gemini's) may use prompts to improve their products.
