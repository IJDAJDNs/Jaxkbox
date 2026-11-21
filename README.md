# ✨ Jackbox AI Helper (iPhone)

An AI sidekick for **jackbox.tv** in Safari. When a prompt shows up, tap ✨ and Claude reads your phone screen, figures out the game, and gives you answers built to win the vote. Tap one and it's typed in for you. Hit Submit. Collect the votes.

## What it does

**It plays every kind of Jackbox screen**, not just writing prompts:

| Screen | What ✨ does |
|---|---|
| ✍️ Writing (Quiplash, Fibbage lies, Job Job, Joke Boat, Survive the Internet…) | Answers built to win the vote. Tap one and it's typed in |
| 🎨 **Drawing** (Drawful, Tee K.O., Bidiots, Champ'd Up, Civic Doodle, Patently Stupid…) | Designs a picture, shows you a **preview**, then **draws it on the canvas for you** stroke by stroke, picking colors from the game's palette and filling shapes in |
| 💰 Bidding / sliders / numbers (Bidiots, Guesspionage, Timejinx…) | Sets the slider or number to a smart value and can hit Bid |
| 🔪 Trivia & death games (Trivia Murder Party 1 & 2) | Picks the right answer and works through the minigame rules |
| 🗳️ Voting (any game) | Picks what the room will vote for, or in Fibbage, the **real** answer |
| 😴 Lobby / waiting | Tells you there's nothing to do (or answers what you typed in the box) |

**Extras**
- **Humor dial**: 😇 Family · 🙂 Normal · 😈 Edgy · 💀 Unhinged.
- **Remix chips**: 🔥 Darker, 😇 Cleaner, 🤪 Weirder, ✂️ Simpler, 🧠 Clever, 🎯 Roast, 🎨 Fancier art, ✍️ Punch up mine.
- **Use + Submit** on every card: one tap does the answer *and* presses Submit.
- **🤖 Autopilot**: plays the best answer automatically, and can press Submit for you too. Combine with **Auto-run** to play hands-free.
- **Game memory** for callbacks, **room notes** for inside jokes, 🔁 more-like-this, 📋 copy.
- Drag ✨ anywhere. While drawing it turns into ⏹ with a progress %, so tap it to stop.

## Install on iPhone (about 5 minutes)

### 1. Get an API key (one time)
1. Go to **console.anthropic.com** and sign up.
2. Under **Billing**, add a few dollars of credit. $5 lasts many game nights.
3. Under **API Keys**, tap **Create Key** and copy it (starts with `sk-ant-`). Paste it into Notes for now.

### 2. Install the Userscripts app
1. Install **Userscripts** (by Justin Wasack, free) from the App Store.
2. Open it once. If it asks for a folder, tap **Set Userscripts Directory** and pick or create a folder (e.g. *On My iPhone → Userscripts*).
3. Go to **Settings → Apps → Safari → Extensions → Userscripts**:
   - Turn it **on**.
   - Under **Permissions**, set **jackbox.tv** (or All Websites) to **Allow**.

### 3. Install the script
1. In **Safari** on your iPhone, open:
   **https://raw.githubusercontent.com/IJDAJDNs/Jaxkbox/claude/keen-dirac-mt2d7f/jackbox-ai-helper.user.js**
2. Tap the **puzzle piece / aA** button in the address bar, then **Userscripts**.
3. It shows **"Userscript Detected"**. Tap **Install**.

*If that doesn't show up:* on the page above, tap Share → **Save to Files** and save it into the Userscripts folder from step 2.

### 4. First run
1. Open **jackbox.tv** in Safari and join a game. The pink ✨ button appears bottom-right.
   (No button? Tap the puzzle piece → Userscripts and make sure it's allowed on this site, then reload.)
2. Tap ✨. Settings open the first time. Paste your API key.
3. Pick your humor level, add notes about your group, and tap **Save**.

## Playing with it

1. Any screen where you have to do something → tap **✨**.
2. Answers show up in a few seconds (drawings take a bit longer). The purple-outlined card is the AI's top pick.
3. **Tap a card** to use it, or **Use + Submit / Draw + Submit** to also send it.
   For drawings, watch it draw itself. Tap ⏹ to stop if you don't like it (then use the game's Undo/Clear).

**Hands-free mode:** ⚙️ → Auto-run **Everything** + 🤖 **Autopilot** + **press Submit for me**. A 🤖 badge shows on the button when autopilot is on.

Tips:
- Want something different? Tap a chip (🔥 Darker, 🎯 Roast…) or type a direction in the box ("about Sarah's cat") and tap **Go**.
- Jackbox timers are short. Keep **Speed = Fast**. If it's still slow, switch the model to **Sonnet 5.5** or **Haiku 5.5**.
- Turn on **Auto-suggest** in ⚙️ so answers are ready the moment a prompt appears. It costs a bit more since it runs on every prompt.
- Starting a new game with different people? ⚙️ → **Forget this game** clears the callback memory.

## Cost

You pay Anthropic per tap. Roughly: **Haiku** is a fraction of a cent, **Sonnet** about a cent, **Opus** a few cents. A full night of Quiplash on Opus is usually well under a dollar.

## Troubleshooting

| Problem | Fix |
|---|---|
| No ✨ button | Puzzle piece → Userscripts → allow on jackbox.tv, then reload. Check the extension is on in Safari settings. |
| "API key rejected" | Re-copy the key into ⚙️. Make sure there are no extra spaces. |
| "Rate limited / out of credit" | Add credit at console.anthropic.com → Billing. |
| "The AI passed on this one" | Rare on very extreme prompts. Tap 😇 Cleaner or drop the humor level one notch. |
| Answer doesn't fill the box | Use 📋 and paste it in. Jackbox may have changed their page. |
| Too slow | Model → Sonnet 5.5 or Haiku 5.5, Thinking → Fast. |
| Drawing doesn't appear | It tries touch, pointer and mouse input automatically. If nothing shows, that game's canvas isn't accepting it. Tell me which game. |
| Drawing looks off / ugly | Tap 🎨 Fancier art, or set Thinking → Deep for drawing rounds (you usually have ~90 seconds). |

## Updating

The script checks this GitHub link for new versions. To update by hand, open the install link again and tap Install.

Your API key stays on your phone and is only ever sent to `api.anthropic.com`.
