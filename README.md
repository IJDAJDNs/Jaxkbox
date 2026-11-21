# ✨ Jackbox AI Helper (iPhone)

An AI sidekick for **jackbox.tv** in Safari. When a prompt shows up, tap ✨ and Claude reads your phone screen, figures out the game, and gives you answers built to win the vote. Tap one and it's typed in for you. Hit Submit. Collect the votes.

## What it does

- **Works across the Party Packs**: Quiplash (incl. Thriplash), Fibbage (lies that fool people, and **spotting the truth when voting**), Trivia Murder Party, Job Job (uses only your word bank), Tee K.O., Champ'd Up, Survive the Internet, Mad Verse City, Joke Boat, Drawful (sees your phone's drawing) and more.
- **Humor dial**: 😇 Family · 🙂 Normal · 😈 Edgy · 💀 Unhinged (dark, crude, no-filter adult humor).
- **One-tap remixes**: 🔥 Darker, 😇 Cleaner, 🤪 Weirder, ✂️ Shorter, 🧠 Clever, 🎯 Roast (roasts other players by name).
- **✍️ Punch up mine**: type your own idea in the game box, tap this, and it makes your joke land harder.
- **🔁 More like this** on any answer you like, and **📋 copy** if the game box moved.
- **Voting help**: tells you which answer to vote for (or which Fibbage answer is the real one) and can tap it for you, with a backup pick.
- **Game memory**: remembers earlier prompts and your answers so it can make callbacks and running jokes.
- **Auto-suggest** (optional): answers are ready before you even tap. A green dot on ✨ means they're waiting.
- **Room notes**: tell it about your group once ("Jake is always late, we love Shrek") and it uses that.
- Drag the ✨ button anywhere so it doesn't cover the game.

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

1. A prompt appears → tap **✨**.
2. A few seconds later you get answers. **Tap one** and it fills the game's box.
3. Tap the game's **Submit**.

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
| Too slow | Model → Sonnet 5.5 or Haiku 5.5, Speed → Fast. |

## Updating

The script checks this GitHub link for new versions. To update by hand, open the install link again and tap Install.

Your API key stays on your phone and is only ever sent to `api.anthropic.com`.
