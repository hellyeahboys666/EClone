# EClone

**Demo version. Free and open source (MIT).** EClone is a talking 3D clone of a person that runs in your browser. You talk or type, and GPT or Claude answers as that person using notes about them. The reply is spoken in their voice (or the Mac's), and a 3D avatar standing in a house lip-syncs to it. The clone has memory, moods, and a sense of time.

This guide takes you from nothing to a running clone in about 10 minutes. [INTRODUCTION.md](INTRODUCTION.md) explains how it works inside.

## Why EClone

Most AI companions are made-up characters. Most "digital clone" services live on someone else's servers. EClone is a clone of one real person that lives on your own computer, and it behaves like someone with a life:

- **A clone of a real person, with consent built in.** It speaks as them from notes in their own words and only states facts it was given. It says plainly that it's an AI when sincerely asked, and never makes promises for them. The setup guide is written around the person agreeing to it (see [Responsible use](#responsible-use)).
- **Memory that works like a person's.**
  - Conversations turn into dated memories on their own, while it's idle.
  - It recalls memories by meaning, so "my nan" finds the memory about a grandma.
  - Old small details fade and go fuzzy ("I think it was Lisbon?").
  - It forms impressions over time ("I get the sense you've been worn down lately").
- **Feelings that linger.** A mood comes from what you say and fades over hours, not instantly. It shows on the avatar's face and in how it talks, and emotional moments are remembered more strongly.
- **A mind of its own.** It keeps replies short and spoken, pushes back on things that don't add up, and only knows what someone like the person would actually know. No encyclopedia answers.
- **A sense of time.** It knows the date and time, notices when you've been away, asks why you're saying hello twice, and sometimes speaks first after a break ("How'd the test go?").
- **A life with a schedule.** Give it a week of work, school or sleep. When busy it replies like a busy person ("at the bike shop, kinda busy"). When out, it isn't in the house. It tells you when it's leaving, and knows when it just got back. Every clone sleeps 11 PM–7 AM by default: it says goodnight, the room is empty while it's in bed, and a message gets a groggy half-asleep answer, or none, unless it's urgent.
- **A home it knows about.** A 3D house with sunlight through the window, a kitchen and furniture. You can change the time of day, the view and the colors, and the clone notices ("did the walls change?").
- **Private by design.** Memories, mood, schedule and settings stay as files on your computer, and only pages on your computer can use it. The only thing that leaves is what the AI model needs to answer.
- **Easy to set up and edit.**
  - A setup wizard and a health check.
  - A double-click launcher on a Mac.
  - A Mind page to edit who the clone is, what it remembers and its schedule, without touching files.
  - `npm run share`, which gives someone a clean copy with nothing personal in it.

### Free

EClone itself is free: no subscription, no account, no paid tier, and the code is MIT licensed. You bring your own AI key, and the only cost is what the AI provider charges for the messages (the **Tokens** chip shows it). The Mac's built-in voice is free too; a cloned ElevenLabs voice is optional.

## What you need

- **A Mac.** Windows or Linux works too, but then the voice needs ElevenLabs (see [Voice](#make-it-look-and-sound-like-them)).
- **Chrome or Safari.** Talking into the mic uses the browser's speech recognition. Typing works anywhere.
- **A brain**, one of:
  - an **OpenAI API key** (GPT), from https://platform.openai.com/api-keys
  - an **Anthropic API key** (Claude), from https://platform.claude.com, under Settings, API keys
  - your **ChatGPT account** (no API credits), through OpenAI's Codex tool. See [Use your ChatGPT plan instead of API credits](#use-your-chatgpt-plan-instead-of-api-credits).

  API keys are pay-as-you-go and billed separately from ChatGPT or Claude subscriptions; add a few dollars of credit. The **Tokens** chip on the page shows how much the clone uses.

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
- asks for the clone's name and which brain to use
- asks you to paste your API key (it's hidden while you type)
- tests the key
- asks whether to set up a cloned voice
- starts the persona notes from a template (then you build them from real material on the Mind page)

Everything is saved in `.env`, which only you can read. Run `npm run setup` again any time to change these answers.

### 3. Start the clone

The **Start EClone.command** file starts it and opens the browser. In Terminal:

```bash
npm start
```

Then open **http://localhost:4747**. To stop it, press **Ctrl+C** in the Terminal window (or close the window).

### 4. Build it from everything you have

This is the main step: the clone is only as accurate as what you give it. Click **Mind** at the top of the page. It opens on **Build from everything**:

1. **Consent.** Confirm the person agreed to have a clone made from this material.
2. **Add everything you have.** Drop in files or paste text:
   - **Chats with them in it** (the most valuable: it learns how they really text). WhatsApp exports (.txt), Discord (DiscordChatExporter .json), Instagram or Messenger (.json from "Download your information"), Telegram (result.json), CSV exports, or plain "Name: message" transcripts. For each chat, pick which speaker is them.
   - **Their own writing:** essays, posts, notes, captions.
   - **Their answers to questions:** the interview questions in `persona-template/README.md` are a good start.
   - **Written about them by someone else:** what friends and family say about them (used as weaker, second-hand evidence).
3. **Analyze.** The clone's brain reads everything piece by piece and pulls out facts, routines, goals, how they talk, temper, opinions, likes, people and stories, each backed by a quote. How they text (message length, capitals, punctuation, emoji, favourite phrases) is counted exactly from their real messages, not guessed. It then writes the persona notes, plus a note of real example exchanges, plus questions to ask them where it's missing information.
4. **Review and use.** Edit the drafted notes if you like, then **Use these notes**. Old notes are backed up in `persona-backups/` first.
5. **Test accuracy.** Some real exchanges are kept out of the notes on purpose. The clone answers them blind, and each answer is scored against what the person really said: how much it sounds like them, and whether it says what they would. Answer the suggested questions, add more material, analyze again, and watch the score go up.

Everything you add stays in `sources/` on your computer (private, left out of git and `npm run share`). Analyzing sends it to your AI provider in pieces, like any message. You can still edit the notes by hand under **Persona notes**.

### 5. If something's wrong

```bash
npm run check
```

It checks Node, the packages, your key (with a free test request), the voice, the persona notes and the memory, and says how to fix anything missing. It never prints keys or what the notes and memories say. See also [Troubleshooting](#troubleshooting).

## Using it

- **Talk:** click the mic and speak, or type and press Enter.
- **Interrupting, both ways:** talk or send while it's still speaking and it stops mid-sentence. It only remembers the words it got out (the bubble ends in a dash), and it reacts to being talked over the way that person would: a polite "sorry, can I jump in" and a yelled "STOP" land differently. It can also cut *you* off: while you type or talk, it hears what you've said so far, and if something really gets to it, it jumps in before you finish, politely or yelling in capitals, depending on who it is. Most of the time it lets you finish. Set `CLONE_INTERRUPTS=no` in `.env` to turn its cutting in off.
- **It gets mad like a person:** insult it, mock it or tell it to "relax" and it snaps back, short and sharp (in capitals if it's really yelling), by its own temper from the persona notes. A quick "sorry" or "anyway..." doesn't fix it: it stays cold, and even a real apology only softens it a little at a time. Friendly teasing stays friendly.
- **It doesn't always answer:** like a person, it can choose to say nothing, for example after you've insulted it ("(no reply)" in the chat). It's rare, and its mood still shows how it feels.
- **Subtitles:** its words appear in the chat bubble as it says them, in time with the voice, not all at once. Without sound, they appear at a speaking pace.
- **Chips at the top:**

  | Chip | What it does |
  |---|---|
  | Brain | Which model is answering. Hover to see the backup model. |
  | Voice | Which voice it uses. |
  | Status | What it's doing on its schedule ("Out: Work · until 5:00 PM", "Asleep · until 7:00 AM"). |
  | Mood | How it feels right now. Hover to see why. |
  | Tokens | What the last reply and today cost in tokens. |
  | Mind | Opens the editor for who it is and what it remembers. |
  | House | Changes the room. |
  | New chat | Starts over. It remembers what mattered first, which takes a few seconds. |

- **It speaks first sometimes:** if you come back after 3 hours or more, it may say something first, like asking how a test went.

## Change the API key or brain

The easy way is to run `npm run setup` again. Or open `.env` in a text editor, change a line, save, and restart the clone (Ctrl+C, then `npm start`).

| Setting in `.env` | What it does |
|---|---|
| `BRAIN` | `openai`, `claude`, or `chatgpt` (your ChatGPT plan through Codex) |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | GPT key and model (default `gpt-5.4`; `gpt-5.4-mini` is faster and cheaper). The OpenAI key also powers recall by meaning and the backup model. |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` | Claude key and model (default `claude-sonnet-5-5`) |
| `FALLBACK_MODEL`, `FALLBACK_AFTER_SECONDS` | Backup model if the main one fails or is silent (default `gpt-5.4-mini` after 20 seconds; `none` turns it off) |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | Cloned voice (blank uses the Mac's voice). Easiest to set from the **Voice** chip on the page. |
| `CLONE_NAME` | Name shown on the page |
| `PORT` | The address, `http://localhost:PORT` (default 4747) |

### Use your ChatGPT plan instead of API credits

With `BRAIN=chatgpt`, replies and memory forming go through **Codex**, OpenAI's own command-line tool, signed in with your ChatGPT account. They count against your ChatGPT plan's usage limits instead of costing API credits.

1. Install Codex and sign in, choosing **Sign in with ChatGPT**:

   ```bash
   npm install -g @openai/codex
   ```

   ```bash
   codex login
   ```

2. Run `npm run setup` and choose `chatgpt`, or set `BRAIN=chatgpt` in `.env` and restart.

Trade-offs:
- **Slower:** about 5 seconds a reply (around 10 s for the first), and the reply arrives all at once.
- **Usage limits:** Codex adds its own instructions to every call (about 15,000–20,000 tokens). That doesn't cost money, but it uses your plan's limit faster. The **Tokens** chip shows these as "ChatGPT plan" and leaves them out of the billed count.
- **Models:** with a ChatGPT sign-in, only Codex's own models work (`CODEX_MODEL`, default `gpt-6-sol`).
- **Keep an OpenAI API key if you can:** it's the backup when ChatGPT is slow, fails or hits its limit, and it powers recall by meaning (a few cents a month). Without it, recall matches words.
- **Keep it personal:** it's for your own use on your own computer, with your own account.

Codex runs in an empty folder with a read-only sandbox and never sees this project's files. Only the prompt is sent, the same as with an API key.

`.env.example` lists every setting with an explanation. Never share `.env` or paste your key into a chat: anyone with it can spend your credit.

## Edit who the clone is

Use the **Mind** page (the Mind button, or http://localhost:4747/mind):

- **Persona notes:** who they are, how they talk, opinions, people, stories. Edit, add or delete notes. `README.md` there is the writing guide and isn't sent to the clone.
- **Rules:** how any clone behaves (short spoken replies, honesty, feelings, memory). You rarely need to change these.

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
| `house-seen.json` | The room as it last saw it, so it notices and reacts to changes |
| `schedule-state.json` | Which departures it already announced |

Use the Mind page while the clone is running. If you edit the files by hand, stop the clone first. Deleting the `memory/` folder wipes all of it.

## Give it a schedule

On the **Mind** page, open **Schedule** to set what the clone does during the week, using this computer's clock. Quick-add buttons cover Work, School, Sleep, Gym and Homework. Every clone starts with **Sleep, 11 PM–7 AM every day** (an existing schedule gets it added once); change its times, or delete it and it stays deleted.

For each activity, set:
- the days, and the times it starts and ends (an end before the start runs past midnight, like Sleep 11 PM–7 AM)
- whether it's **at home** or **out**
- whether it's **busy**
- whether to **say it's leaving** 5–30 minutes before

Then:
- **When it's busy,** it answers the way that person would when busy ("at the bike shop right now, kinda busy", "doing homework, maybe later").
- **When it's out,** the avatar isn't in the house and the status chip shows where it is. You can still message it.
- **Before going out,** while the page is open, it tells you it's leaving ("I've gotta head out, work starts at 9").
- **Afterwards,** it knows it just finished ("just got home, chess sure").
- **When it's asleep** (an activity named Sleep, Bed or Nap), it isn't in the living room, says goodnight about 10 minutes before, and a message wakes it up: short, groggy, maybe grumpy, often no answer, unless it's urgent. When it wakes up, it notices anything you changed in the room overnight.

The schedule is saved in `schedule.json`, which is private and left out of git and `npm run share`.

## Make it look and sound like them

| Piece | How |
|---|---|
| **Voice** | The person records 1–5 minutes of clean speech and creates a voice at https://elevenlabs.io (they should do the consent step themselves). Then click the **Voice** chip at the top of the clone's page: paste your ElevenLabs API key, click **Show my voices** (your clones are listed first, each with a free ▶ preview), pick one, choose speed or quality, click **Try it** to hear a line, and **Save and use it**. It switches right away, no restart, and **Use the Mac voice instead** switches back. **Speaks more than one language?** Set which language the main voice speaks, then pick another voice (for example their Chinese clone), choose **For Chinese**, and **Use for Chinese**. Add one per language. Each sentence is said in the voice for its language (worked out from the sentence itself), and anything else uses the main voice. Write in the persona notes which languages they speak and how they mix them. The key stays on your computer in `.env`. (`npm run setup` can do the same in the terminal, listing your voices to pick by number.) |
| **Avatar** | Put a `.vrm` or `.glb` file in the `avatar/` folder. The first one there (alphabetically) replaces the sample. For a cartoon look, make a `.vrm` in [VRoid Studio](https://vroid.com/en/studio) (free). For a realistic person, use a `.glb` character with a standard humanoid skeleton (Mixamo, Avaturn, Character Creator and Unreal bone names all work) and Apple ARKit face shape keys (like `jawOpen`, `eyeBlinkLeft`, `mouthSmileLeft`) or viseme keys, so it can blink, talk and show moods. A `.glb` without them still stands in the room, and the page says what's missing. |
| **House** | Click **House**. **Look** sets the time of day (or follows the clock), lamps, colors and floor. It also sets the walls (paint, stripes, dots, floral, brick, wood panels, or *your own picture* as wallpaper) and the view out the window (garden, city, lake, or *your own photo*). **Decorate** moves anything in the room, including the sofa, coffee table, TV, bookshelf, lamps, plants, pictures and rug it starts with (and **Put the original furniture back** if you change your mind). It also adds things from a catalog: armchair, beanbag, desk with a laptop, lamps, plants, cactus, flowers, bookcase, guitar, telescope, round rug, fish tank, speaker, a big flatscreen TV, a teddy bear, a giant toy spider, posters, a wall clock, a shelf, string lights, *your own framed photos* and *your own 3D models* (`.glb`). Drag them anywhere on the floor or walls, then turn, resize, recolor or remove them: the selected thing's controls, with **Remove**, stay pinned at the top of the panel. **Delete** removes the selected thing, **Esc** lets go of it, and **Undo** (or Cmd+Z) puts back the last one you removed. A few seconds after you stop, the clone says whether it likes the change, by its own taste in the persona notes ("pink stripes? Absolutely not. The telescope can stay, though"). It can feel anything a person would: thrilled by a new TV, grossed out, or startled when you drop something right next to it (it reacts within a second or two). If something scares it, like a spider for a clone who's afraid of them, it's scared for real, and you'll have to comfort it; it calms down gradually. Change things while it's out, and it notices when it comes home. How it reacts depends on who it is: the same spider delights a bug lover. There are two views. The usual one faces the clone, and dragging turns you around it (no zooming or sliding, and the camera stops at the walls). **Whole room** (top left) glides up to look down on the entire room, where you can drag to turn and scroll to zoom; the view out the window is hidden from up there. **Back to the clone** glides back down. Settings are saved in `house.json`, and uploads in `house-assets/`. |

## Share it with someone else

```bash
npm run share
```

This makes `<folder name>-share.zip` next to this folder. It contains only the app, with no keys, persona notes, memories, avatar or house settings. The other person unzips it and follows this guide from step 1. `.gitignore` leaves out the same personal files if you use git.

## Troubleshooting

| Problem | Fix |
|---|---|
| `command not found: npm` or `node` | Install Node.js (step 1), then open a new Terminal window. |
| "Port 4747 is already in use" | The clone is probably already running: open http://localhost:4747. Or set `PORT=4848` in `.env`. |
| Brain chip says "demo mode" | No API key for the chosen brain. Run `npm run setup`. |
| "rejected the API key" | The key was copied wrong or deleted. Run `npm run setup` and paste it again. |
| "rate-limiting" or "out of credit" | Add credit on the provider's website, or wait a minute. |
| No sound | Click anywhere on the page once (browsers block sound until you do). Check the volume. Off a Mac, set up ElevenLabs. |
| Mic button missing or blocked | Use Chrome or Safari, and allow the microphone when asked. |
| Stuck on "Loading avatar" | The 3D library and sample avatar load from the internet, so check the connection, then refresh. |
| Replies feel slow | Set `OPENAI_MODEL=gpt-5.4-mini` in `.env` and restart. With `BRAIN=chatgpt`, about 5 seconds is normal. |
| `BRAIN=chatgpt`: "Codex isn't signed in" or "Codex is not installed" | Run `npm install -g @openai/codex`, then `codex login` and choose Sign in with ChatGPT. Restart the clone. Meanwhile the backup model answers if you have an OpenAI key. |
| Something else | Run `npm run check`, and read the Terminal window running the clone for errors. |

## Where data goes

- The clone runs only on this computer (http://localhost), and only pages on this computer can use it. Keys stay in `.env`.
- **Each message:** the rules, persona notes, recalled memories, the room description, the mood and the recent conversation go to OpenAI or Anthropic, whichever brain is set.
- **Recall by meaning:** with an OpenAI key, the last few messages and each new memory also go to OpenAI's embedding model.
- **Voice:** each reply sentence goes to ElevenLabs when that voice is on. The Mac voice stays on the Mac.
- **Mic:** Chrome sends voice input to Google's speech service; Safari uses Apple's.
- **Pictures for the house:** they stay on this computer. "Describe it for me" sends that one picture to OpenAI once, and only when you click it.
- **Everything else stays here:** memories, mood, settings and token counts are files on this computer.

Agree with the person on who gets to talk to their clone, whether it's ever shown publicly, and that they can have it changed or deleted.

## Files

| Path | What it does |
|---|---|
| `Start EClone.command` | Double-click to set up (first time) and start (Mac) |
| `scripts/` | `setup.mjs`, `check.mjs` and `share.mjs`, for `npm run setup`, `check` and `share` |
| `server.js` | Serves the page, builds what the brain sees, streams replies, makes speech |
| `memory.js`, `mood.js`, `surroundings.js` | Memory, mood, and the room in words |
| `rules.md` | How any clone behaves |
| `persona/` | Who this clone is (private). `persona-template/` is the starting point. |
| `public/` | The page: chat (`app.js`), 3D stage, avatar and dragging (`scene.js`), house (`house*.js`), decor catalog (`decor.js`), Mind page (`mind.*`) |
| `memory/`, `house.json`, `house-assets/`, `schedule.json`, `.env` | Created as you use it. `memory/`, `house-assets/` (your uploaded pictures and models), `schedule.json` and `.env` are private. |

For developers: open the page with `?debug` to try moods and body language from the browser console, like `cloneDebug.mood('happy', 8)` or `cloneDebug.activity('thinking')`. INTRODUCTION.md covers the design, what was tested, and ideas for next steps.

## Responsible use

EClone makes a clone of a real person, so please use it the way you'd want someone to use a clone of you:

- **Only with their consent.** Make a clone only of someone who agrees to it and knows what it can do. Don't make one of a person who can't agree, or who hasn't.
- **Let them decide.** They should know who talks to their clone and whether it's ever shown publicly, and be able to have it changed or deleted. If they ask you to delete it, delete it.
- **Don't deceive anyone with it.** Don't use a clone to impersonate the person, pretend to be them in messages or calls, or trick people into thinking they're talking to the real person. The clone is built to say it's an AI when sincerely asked; keep it that way.
- **Only material they agreed to.** Build the clone from what the person shared or agreed to: their chats with you, their writing, their answers. Don't collect material about someone behind their back, and remember chats also contain the other people in them.
- **Keep it private.** Persona notes, source material, memories, voice samples and avatars are about a real person. Don't publish or share them without permission (`npm run share` and `.gitignore` leave them out).
- **Voices and faces need consent too.** A cloned voice or a lookalike avatar should come from the person themselves, through the provider's own consent process.
- **Not for harm.** Don't use EClone to harass, defraud or manipulate anyone, or for anything illegal where you live.

These are the author's expectations, not extra license terms. The MIT license below still applies as written.

## License

MIT, see [LICENSE](LICENSE). This covers the code only; persona notes, memories, voices and avatars you add stay yours and aren't part of the repository. Please also follow [Responsible use](#responsible-use).
