# Jackbox AI Helper (iPhone userscript)

Adds a ✨ button to **jackbox.tv** in Safari. Tap it when a prompt is on screen and Claude reads your phone screen, figures out which game you're in, and suggests answers to win the vote. Tap a suggestion to drop it into the text box, then hit the game's own Submit button.

Works across the Party Packs because it reads whatever is on screen rather than hard-coding each game:

| Game type | What it does |
|---|---|
| Quiplash / Thriplash | Short, surprising punchlines (fills all 3 boxes for Thriplash) |
| Fibbage / Enough About You | Believable **lies** that fool people, not the real answer |
| Job Job | Builds answers using only the words in your word bank |
| Tee K.O., Champ'd Up, Survive the Internet, Joke Boat, etc. | Slogans, names, and twisted captions |
| Trivia (Trivia Murder Party, etc.) | Picks the correct answer |
| Voting / multiple-choice screens | Suggests which button to tap and can tap it for you |
| Drawing games | If a drawing is on your phone's canvas, it's sent as an image for context |

## Install on iPhone

1. Install the free **Userscripts** app (by Justin Wasack) from the App Store.
2. Open the app and pick a folder for your scripts (e.g. in iCloud Drive or On My iPhone).
3. Go to **Settings → Apps → Safari → Extensions → Userscripts**, turn it on, and set **All Websites** (or just jackbox.tv) to **Allow**.
4. Save `jackbox-ai-helper.user.js` into the folder from step 2. (Or open the raw file in Safari, tap the Userscripts **aA** / puzzle icon, and choose to install it.)
5. Open **https://jackbox.tv** in Safari and join a game. You should see the purple ✨ button in the bottom-right.
6. Tap ✨, then ⚙️, paste your Anthropic API key (get one at console.anthropic.com), and tap **Save**.

## Using it

- Tap ✨ when a prompt appears. Suggestions show up in a few seconds; tap one to fill it in.
- Type something in the box (like "more savage", "about Sarah", "keep it clean") and tap **Go** to steer the next batch.
- In ⚙️ settings:
  - **Model**: Opus 5.5 is the best. Sonnet 5.5 and Haiku 5.5 are faster and cheaper.
  - **Effort**: keep it on *Low* so answers arrive before the timer runs out.
  - **Audience / humor style**: describe your group once (e.g. "college friends, dark humor OK") and every suggestion follows it.
  - **Auto-suggest**: fetches suggestions automatically each time a new prompt appears. This makes more API calls.

## Notes

- Your API key is stored only in the Userscripts app's storage on your phone, and it is sent only to `api.anthropic.com`.
- Each tap is one API call. On Haiku that's a fraction of a cent; on Opus it's still only a few cents.
- Jackbox sometimes changes its web page. If a field doesn't fill in, you can still read the suggestion and type it yourself.
- It's a party game, so maybe tell your friends you have an AI sidekick 😉
