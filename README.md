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

## 🆕 v5: auto game detection, impostor hunting, truth finder

- **Knows exactly which game you're in.** It reads the game info Jackbox already sends to your phone (room code → game ID), so it knows the game even when the name isn't on screen. Then it **switches to that game automatically**:
  - 😂 **Comedy mode** for Quiplash, Joke Boat and the like.
  - 🎯 **Accuracy mode** for trivia, minigames and estimates: careful reasoning, low randomness, web search, confidence %.
  - 🕵️ **Detective mode** for Push the Button, Fakin' It, Weapons Drawn, Hypnotorious and Suspectives.
  - Game-specific buttons appear at the top: Fibbage gets *🕵️ Find the truth / 🚫 What's the real answer?*, Push the Button gets *🛸 Who is the alien? / 👽 I am the alien*, Fakin' It gets *🔍 Who is faking? / 🎭 I am the faker*, TMP gets *🔎 Look it up / 🧮 Solve carefully*, and more.
- **🕵️ Impostor case file.** It quietly saves every screen your phone sees during the game (everyone's answers, votes, prompts). Add your own observations with **📝 Save note** ("Mike hesitated", "Jo copied Sarah"). **Find impostor** ranks the suspects with % and evidence, and puts the accuse buttons in order.
- **🔎 Truth finder.** Live web search (free with Gemini, or with Claude) checks trivia, Fibbage truths, Lie Swatter facts, Timejinx years and Guesspionage percentages. It tells you the real answer so you can vote for it, or avoid typing it as your lie.
- **Fixes itself.** If the game ignores typed text, it types it another way. If the screen changes before you tap, it re-reads the screen and answers the new one.
- **Darker Unhinged mode:** explicit sex jokes, death, drugs and brutal roasts are all fair game. The one thing it won't do is slurs or jokes where a race, religion, sexuality or disability is the punchline (those lose votes anyway).

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
| Groq | Free | Free key | Fastest. Great for short timers |
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
