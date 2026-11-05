# EClone

**Demo version.** EClone is a talking 3D twin of a person that runs in your browser. You talk or type, and GPT or Claude answers as that person using notes about them. The reply is spoken in their voice (or the Mac's), and a 3D avatar standing in a house lip-syncs to it. The twin has memory, moods, and a sense of time.

This guide takes you from nothing to a running twin in about 10 minutes. [INTRODUCTION.md](INTRODUCTION.md) explains how it works inside.

## What you need

- **A Mac.** Windows or Linux works too, but then the voice needs ElevenLabs (see [Voice](#make-it-look-and-sound-like-them)).
- **Chrome or Safari.** Talking into the mic uses the browser's speech recognition. Typing works anywhere.
- **An API key**, either:
  - OpenAI (GPT), from https://platform.openai.com/api-keys
  - Anthropic (Claude), from https://platform.claude.com, under Settings, API keys

  Both are pay-as-you-go and billed separately from ChatGPT or Claude subscriptions; add a few dollars of credit. The **Tokens** chip on the page shows how much the twin uses.

## Set it up

### 1. Install Node.js

Download the **LTS** version from https://nodejs.org and install it. To check it worked, open **Terminal** and run:

```bash
node --version
```

It should say `v20.12` or higher.

### 2. Run the setup

**The easy way (Mac):** double-click **Start EClone.command** in this folder. The first time, macOS may say it can't be opened: right-click it, choose **Open**, then **Open** again.

**Or in Terminal:**

```bash
cd path/to/EClone
npm run setup
```

Replace `path/to/EClone` with this folder's location. Typing `cd ` and dragging the folder into Terminal fills it in.

Setup:
- installs what's needed
- asks for the twin's name and which brain to use
- asks you to paste your API key (it's hidden while you type)
- tests the key
- asks whether to set up a cloned voice
- starts the persona notes from a template

Everything is saved in `.env`, which only you can read. Run `npm run setup` again any time to change these answers.

### 3. Start the twin

The **Start EClone.command** file starts it and opens the browser. In Terminal:

```bash
npm start
```

Then open **http://localhost:4747**. To stop it, press **Ctrl+C** in the Terminal window (or close the window).

### 4. Tell it who it is

Click **Mind** at the top of the page, then **Persona notes**, and fill in the four notes. Replace every "(replace this)", and use the interview questions in the README note. Changes apply on the next message.

### 5. If something's wrong

```bash
npm run check
```

It checks Node, the packages, your key (with a free test request), the voice, the persona notes and the memory, and says how to fix anything missing. It never prints keys or what the notes and memories say. See also [Troubleshooting](#troubleshooting).

## Using it

- **Talk:** click the mic and speak, or type and press Enter. Talking or sending while it speaks interrupts it.
- **Chips at the top:**

  | Chip | What it does |
  |---|---|
  | Brain | Which model is answering. Hover to see the backup model. |
  | Voice | Which voice it uses. |
  | Mood | How it feels right now. Hover to see why. |
  | Tokens | What the last reply and today cost in tokens. |
  | Mind | Opens the editor for who it is and what it remembers. |
  | House | Changes the room. |
  | New chat | Starts over. It remembers what mattered first, which takes a few seconds. |

- **It speaks first sometimes:** if you come back after 3 hours or more, it may say something first, like asking how a test went.

## Change the API key or brain

The easy way is to run `npm run setup` again. Or open `.env` in a text editor, change a line, save, and restart the twin (Ctrl+C, then `npm start`).

| Setting in `.env` | What it does |
|---|---|
| `BRAIN` | `openai` or `claude` |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | GPT key and model (default `gpt-5.4`; `gpt-5.4-mini` is faster and cheaper). The OpenAI key also powers recall by meaning and the backup model. |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` | Claude key and model (default `claude-opus-5-5`) |
| `FALLBACK_MODEL`, `FALLBACK_AFTER_SECONDS` | Backup model if the main one fails or is silent (default `gpt-5.4-mini` after 20 seconds; `none` turns it off) |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | Cloned voice (blank uses the Mac's voice) |
| `TWIN_NAME` | Name shown on the page |
| `PORT` | The address, `http://localhost:PORT` (default 4747) |

`.env.example` lists every setting with an explanation. Never share `.env` or paste your key into a chat: anyone with it can spend your credit.

## Edit who the twin is

Use the **Mind** page (the Mind button, or http://localhost:4747/mind):

- **Persona notes:** who they are, how they talk, opinions, people, stories. Edit, add or delete notes. `README.md` there is the writing guide and isn't sent to the twin.
- **Rules:** how any twin behaves (short spoken replies, honesty, feelings, memory). You rarely need to change these.

The notes are plain text files in `persona/`, and `rules.md` is in the main folder, so any text editor works too. Changes apply on the next message without a restart.

## Edit what it remembers

On the **Mind** page:

- **Memories:**
  - Search, edit the wording, or change importance. Importance 9–10 means always on its mind, like a name.
  - Add a memory, or forget one.
  - **Forget everything** wipes all memories.
  - "Impressions" are hunches it formed by itself.
- **Mood & chat:** reset the mood to calm, or clear the current chat without remembering it.

Memories form by themselves:
- after 10 quiet minutes
- every 16 messages
- when you click **New chat**

They're files in `memory/`:

| File | What's in it |
|---|---|
| `conversation.json` | The current chat, word for word (last 100 messages) |
| `memories.json` | Long-term memories and impressions |
| `vectors.json` | What each memory is about, as numbers, for recall by meaning |
| `mood.json` | How it feels right now |
| `usage.json` | Token counts |
| `house-seen.json` | The room as it last saw it, so it notices changes |

Use the Mind page while the twin is running. If you edit the files by hand, stop the twin first. Deleting the `memory/` folder wipes all of it.

## Make it look and sound like them

| Piece | How |
|---|---|
| **Voice** | The person records 1–5 minutes of clean speech and creates a voice at https://elevenlabs.io (they should do the consent step themselves). Run `npm run setup` and paste the ElevenLabs key and voice ID. |
| **Avatar** | Make one in [VRoid Studio](https://vroid.com/en/studio) (free), export it as `.vrm`, and put it in the `avatar/` folder. The first `.vrm` there replaces the sample. |
| **House** | Click **House** for the time of day (or follow the clock), lamps, the view outside, colors, floor, and which furniture appears. The twin knows the room and notices when you change it. Saved in `house.json`. To move furniture, edit `public/house.js`. |

## Share it with someone else

```bash
npm run share
```

This makes `<folder name>-share.zip` next to this folder. It contains only the app, with no keys, persona notes, memories, avatar or house settings. The other person unzips it and follows this guide from step 1. `.gitignore` leaves out the same personal files if you use git.

## Troubleshooting

| Problem | Fix |
|---|---|
| `command not found: npm` or `node` | Install Node.js (step 1), then open a new Terminal window. |
| "Port 4747 is already in use" | The twin is probably already running: open http://localhost:4747. Or set `PORT=4848` in `.env`. |
| Brain chip says "demo mode" | No API key for the chosen brain. Run `npm run setup`. |
| "rejected the API key" | The key was copied wrong or deleted. Run `npm run setup` and paste it again. |
| "rate-limiting" or "out of credit" | Add credit on the provider's website, or wait a minute. |
| No sound | Click anywhere on the page once (browsers block sound until you do). Check the volume. Off a Mac, set up ElevenLabs. |
| Mic button missing or blocked | Use Chrome or Safari, and allow the microphone when asked. |
| Stuck on "Loading avatar" | The 3D library and sample avatar load from the internet, so check the connection, then refresh. |
| Replies feel slow | Set `OPENAI_MODEL=gpt-5.4-mini` in `.env` and restart. |
| Something else | Run `npm run check`, and read the Terminal window running the twin for errors. |

## Where data goes

- The twin runs only on this computer (http://localhost), and only pages on this computer can use it. Keys stay in `.env`.
- **Each message:** the rules, persona notes, recalled memories, the room description, the mood and the recent conversation go to OpenAI or Anthropic, whichever brain is set.
- **Recall by meaning:** with an OpenAI key, the last few messages and each new memory also go to OpenAI's embedding model.
- **Voice:** each reply sentence goes to ElevenLabs when that voice is on. The Mac voice stays on the Mac.
- **Mic:** Chrome sends voice input to Google's speech service; Safari uses Apple's.
- **Everything else stays here:** memories, mood, settings and token counts are files on this computer.

Agree with the person on who gets to talk to their twin, whether it's ever shown publicly, and that they can have it changed or deleted.

## Files

| Path | What it does |
|---|---|
| `Start EClone.command` | Double-click to set up (first time) and start (Mac) |
| `scripts/` | `setup.mjs`, `check.mjs` and `share.mjs`, for `npm run setup`, `check` and `share` |
| `server.js` | Serves the page, builds what the brain sees, streams replies, makes speech |
| `memory.js`, `mood.js`, `surroundings.js` | Memory, mood, and the room in words |
| `rules.md` | How any twin behaves |
| `persona/` | Who this twin is (private). `persona-template/` is the starting point. |
| `public/` | The page: chat (`app.js`), 3D stage and avatar (`scene.js`), house (`house*.js`), Mind page (`mind.*`) |
| `memory/`, `house.json`, `.env` | Created as you use it. `memory/` and `.env` are private. |

For developers: open the page with `?debug` to try moods and body language from the browser console, like `twinDebug.mood('happy', 8)` or `twinDebug.activity('thinking')`. INTRODUCTION.md covers the design, what was tested, and ideas for next steps.
