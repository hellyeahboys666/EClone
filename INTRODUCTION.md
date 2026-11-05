# EClone: project introduction (demo version)

An introduction for anyone, person or AI, who is picking this project up. It explains what the app does, how it works, where everything is, what has been tested, and the rules for changing it. Updated November 5, 2026.

## What it is

A web app that runs on one Mac and lets you talk with a 3D "digital twin" of a real person, a friend who agreed to have it made.

- You type, or click the mic and talk.
- An AI model (OpenAI's GPT or Anthropic's Claude) answers in that person's voice and style, based on notes about them.
- The reply is read aloud, sentence by sentence, in a Mac voice or a cloned voice from ElevenLabs.
- A 3D avatar stands in a house and moves its mouth along with the audio, blinks, and idles. The house is a living room with a window (the sun casts light through it), a kitchen through a doorway, and furniture. Its look can be changed from a House panel.
- The twin remembers past conversations in files on the Mac, loosely the way a person does: it forms memories, recalls the ones related to what's being said, and lets the rest fade.
- It has a mood. Feelings come from what's said, linger, and fade over a few hours. They show on the avatar's face and in how it talks, and emotional moments are remembered more strongly.
- It thinks and remembers more like a person:
  - It only knows what someone like them would know.
  - It half-remembers old details.
  - It forms impressions over time ("I get the sense they've been worn down lately").
  - It sometimes speaks first after a break ("How'd the chem test go?").

Who the twin is based on is described only in the private persona notes (see "Working rules" below). This introduction doesn't include any of that.

## Where it stands now

| Part | Current setup |
|---|---|
| Runs at | http://localhost:4747, on this Mac only. Not online, not in a git repository. |
| Brain | OpenAI `gpt-5.4` (Claude is also supported; switch with `BRAIN` in `.env`), with `gpt-5.4-mini` as the backup |
| Voice | The Mac's built-in voice. ElevenLabs is supported but not set up. |
| Avatar | A sample avatar from the three-vrm project. No custom avatar yet. |
| Memory | On, stored in `memory/` |

## How one message travels

1. The browser sends what you said to the server (`POST /api/chat`).
2. The server saves it, with the time, to `memory/conversation.json`.
3. **Recall:** using the last three messages as the cue, `memory.js` picks the long-term memories related to them by meaning, plus the most important ones (like your name). Faded small memories come back marked fuzzy.
4. The server builds the instructions for the model from six parts: `rules.md` (how to behave), the notes in `persona/` (who to be), the recalled memories, the room it's standing in (with anything that changed), its schedule (what it's doing, what's next, what just ended), and the current mood. While the schedule has it out, the room is replaced with "you're not at home". Each of your messages is stamped with when you sent it, for example `[Wednesday, November 4, 2026 at 9:42 PM, back after about 3 hours]`.
5. The reply streams back from GPT or Claude. It starts with a hidden mood tag, like `[mood: annoyed 6 | they brushed off my point]`. The server removes the tag and saves the mood. The browser gets the mood for the face and the Mood chip, then the reply text as it arrives.
6. The browser cuts the text into sentences and asks the server to turn each one into audio (`POST /api/tts`). The sentences play in order, and the loudness of the audio drives the avatar's mouth.
   - The words aren't shown as they arrive. Each sentence's words appear in the bubble while its audio plays, spread over the audio's length, with longer words getting a little more time (`createCaption` in `app.js`).
   - Without sound (not allowed yet, or a voice error), they appear at about 2.8 words a second.
   - Interrupting stops the words where they are.
7. The server saves the reply (even if you cut it off) and counts the tokens used.
8. Later, when you've been quiet for 10 minutes, every 16 messages, or when you click **New chat**, the conversation is turned into long-term memories.

```
you ──text/speech──▶ browser (public/) ──▶ server.js ──▶ GPT or Claude
                         ▲                  │  rules.md + persona/ + recalled memories
                         │                  │  + the conversation, time-stamped
                         │                  ▼
                         └── audio + mouth ◀── voice (Mac `say` or ElevenLabs)
                                             memory.js ⇄ memory/*.json
```

## What's where

| Path | What it does |
|---|---|
| `server.js` | Small Node web server, no framework. Serves the page, builds the instructions, streams replies from GPT or Claude, makes speech, and handles New chat and settings. Listens on 127.0.0.1 only, and refuses requests whose Host or Origin isn't this computer, so other websites can't read memories or send changes through your browser (including DNS rebinding). |
| `scripts/setup.mjs` | `npm run setup`: a first-time wizard (no packages needed).<br>• Checks Node and installs the packages.<br>• Asks for the name, brain and key (hidden while typing), and tests the key with a free request.<br>• Optionally sets up ElevenLabs.<br>• Starts `persona/` from `persona-template/`.<br>• Writes `.env` with permissions 600, keeping its comments.<br>Answers can be piped in for automation. |
| `scripts/check.mjs` | `npm run check`: checks Node, packages, `.env`, the key (a free request; `-- --offline` skips it), backup model, voice, persona (including unfilled "(replace this)" lines), avatar, memory and whether the twin is running. It prints counts only, and gives a fix for each problem. |
| `scripts/share.mjs` | `npm run share`: zips the app next to the folder without `.env`, `persona/`, `persona-backups/`, `memory/`, `reference/`, avatars, `house.json`, `node_modules` or `.claude`. |
| `Start EClone.command` | Double-click launcher for Mac. It installs if needed, runs setup the first time, starts the twin and opens the browser, or just opens the browser if the twin is already running. |
| `persona-template/` | The starting persona: a writing guide with 15 interview questions, and four fill-in notes marked "(replace this)". |
| `public/mind.html`, `mind.js`, `mind.css` | The Mind page (`/mind`).<br>• Edit, add and delete persona notes, and edit `rules.md`.<br>• Search, edit, add and forget memories, change their importance, or forget everything.<br>• Reset the mood, or clear the chat without remembering it.<br>Changes go through `POST /api/mind`, so they're safe while the twin runs and memories are forming. |
| `memory.js` | The twin's memory: saving the conversation, forming memories and impressions, recall by meaning, fading, and token counts. |
| `codex.js` | The ChatGPT sign-in brain (`BRAIN=chatgpt`). Each message runs `codex exec`:
• signed in with ChatGPT, so it uses the ChatGPT plan, not API credits
• in an empty folder, with a read-only sandbox, no saved sessions and no tool servers
• with the API keys removed from its environment
• talking to ChatGPT directly (`CODEX_BASE_URL`)

The prompt goes in on stdin. The reply comes back in one piece through its JSON events, and memory forming uses `--output-schema`. It takes about 5 s a reply, and Codex adds about 15–20k tokens of its own to each call. Those tokens are recorded as `plan` (not billed). If Codex fails or isn't ready, the backup model answers. |
| `mood.js` | The twin's mood: reading the hidden mood tag, saving the feeling, and fading it over time. |
| `rules.md` | General behavior rules for any twin (how to talk, time and memory, having opinions, honesty). Re-read on every message. |
| `persona/` | Notes about the person: who they are, how they talk, their opinions. Re-read on every message. **Private.** |
| `persona-backups/` | Earlier copies of the persona notes. **Private.** |
| `memory/` | The twin's memory files (created automatically). **Private.** |
| `avatar/` | Put a `.vrm` avatar here to replace the sample one. |
| `public/index.html` | The page: 3D canvas, top bar with status chips, chat panel. Loads three.js from a CDN with an import map, so there's no build step. |
| `public/app.js` | Chat, mic input, streaming, the sentence-by-sentence speech queue, interrupting, the Mood and Tokens chips, New chat, speaking first after a break. Opening the page with `?debug` adds `twinDebug.mood('happy', 8)` and `twinDebug.activity('thinking')` to the browser console. |
| `public/house.js` | The house, built from simple shapes plus textures drawn in code (no image files):<br>• a living room with a window and an outside view (garden, city or lake)<br>• a kitchen through a doorway<br>• curtains and a small plant on the window sill (all the furniture is movable items, built in `decor.js`)<br>• lighting for morning, day, sunset and night: the sun shines through the window and casts shadows, and lamps light the room at night |
| `public/schedule-config.js` | The weekly schedule: activities with days, times, at home or out, busy, and a leaving announcement. It works out what's happening now, what's next and what just ended, including overnight times. Used by the server and the Mind page's Schedule tab. Saved in `schedule.json` (private). |
| `surroundings.js` | Puts the house into words for the twin: what's around it, the view and light outside, and whether the lamps are on. It also lists what changed since the twin last spoke (compared with `memory/house-seen.json`) so the twin notices, for example "Okay but did the walls change? I just noticed they're sage green now." New things are described by size and closeness ("a huge toy spider appeared right next to you, about 0.6 m away"), since that's what makes a person jump. |
| `public/decor.js` | Everything you can move, built from simple shapes: the room's starting furniture (sofa, coffee table, side table with a lamp, floor lamp, TV console, bookshelf, plants, prints, rug) and the Decorate catalog. Houses saved before the furniture was movable are converted by `cleanHouse` in `house-config.js` (`startingFurniture`), so they look the same. Your own framed pictures and `.glb` models load from `house-assets/`; models are resized so their biggest side is 1 m and set on the floor. |
| `public/house-config.js` | The House settings: each option, the defaults, and the cleaner that keeps only valid values (used by both the page and the server). |
| `public/house-panel.js` | The House panel (the **House** button at the top). Changes show right away and are saved to `house.json`. |
| `house.json` | Saved House settings. Not private. |
| `public/scene.js` | The three.js stage (a free camera that turns all the way around, zooms and slides but stays inside the walls, rising through the ceiling for the **Whole room** view; tone mapping; reflections), loading the VRM avatar, idle motion, blinking, mood expressions, body language (eyes that glance away now and then, a look up and aside while thinking, nods while listening, a droop when low), and the mouth driven by audio loudness. |
| `public/style.css` | Page styles. |
| `.env` | Settings and API keys. **Secret, never share or print.** `.env.example` is the template. |
| `README.md` | Setup and how to make the twin your own. |

Dependencies: Node 20.12 or newer (it runs on 22), plus the `openai` and `@anthropic-ai/sdk` packages. The page uses three.js 0.169 and @pixiv/three-vrm 3.4.1 from jsDelivr, so it needs an internet connection.

## The twin's "mind" has four layers

1. **Rules (`rules.md`)**: the same for any twin.
   - **How to talk:** spoken style, short replies (often a few words or one sentence), no lists or emoji. It doesn't end every reply with a question; it asks only when it actually wants to know something. A greeting gets a greeting back, not an introduction.
   - **Time and memory:** it uses the time stamps to notice late nights or long breaks. A repeated "hello" soon after greeting gets "why are you saying hello again?", while a hello after a break is normal. It uses recalled memories the way a friend would. It's unsure about memories marked fuzzy ("I think Lisbon?") and treats impressions as hunches, with one short guess ("school again?") rather than analysing their feelings.
   - **Knowing what you'd know:** it only knows what someone of that age, schooling, job and interests would know offhand. It knows its own interests well, is hazy on schoolwork, and says "no idea" to trivia.
   - **Feelings:** they come from what happens, linger and fade gradually, and show in how it talks rather than being announced. Bad moods are allowed.
   - **A mind of its own:** it doesn't just agree. It questions things that don't add up and keeps its position until given a good reason.
   - **Honesty:** it only states facts found in its notes, memories, or the conversation. It says plainly that it's an AI if sincerely asked, and makes no promises on the real person's behalf.
2. **Persona (`persona/*.md`)**: who this particular person is. Any `.md` file in the folder except `README.md` is included.
3. **Memory (`memory/`)**: what the twin has learned from talking with you.
4. **Mood (`memory/mood.json`)**: how the twin feels right now. It's one feeling at a time (calm, happy, amused, excited, proud, grateful, curious, surprised, confused, skeptical, bored, tired, nervous, worried, sympathetic, embarrassed, annoyed, angry, hurt, sad) with a strength from 0 to 10 and a reason.
   - The strength halves every 2 hours, and below 1.5 it counts as worn off, so an 8/10 is a 4 after two hours and gone in about five.
   - It carries over between conversations and restarts.
   - It drives the avatar's expression (each feeling maps to one of the avatar's happy, angry, sad, relaxed or surprised faces). The expression is softened while talking, so lip sync stays visible.

## How the memory works

The files in `memory/` are plain JSON:

- `conversation.json`: the current conversation, word for word, up to the last 100 messages (short-term memory). Each message has `role`, `content`, and `at` (time in ms).
- `memories.json`: long-term memories. Each one is `{ id, text, date, importance 1–10, created, lastRecalled, recalls }`, written in the twin's first person, for example "Sam told me their dog learned to open the fridge." Impressions are kept here too, with `"kind": "impression"`.
- `vectors.json`: what each memory is about, as 256 numbers (from OpenAI's `text-embedding-3-small`), for recall by meaning. Built automatically, including for old memories.
- `usage.json`: token counts, kept as a running total and per day (the last 60 days), split into chat and memory upkeep.
- `mood.json`: the current feeling `{ feeling, intensity, reason, since, at }`. Each saved reply in `conversation.json` also keeps the mood it was said in.

**Forming memories (consolidation):**

- Runs after 10 quiet minutes, every 16 new messages, on New chat, and at startup if something was left over.
- The new part of the conversation and the known memories most related to it are sent to the model, which returns `{ new: [...], updated: [...] }` as structured JSON.
- The model is told to:
  - Write short first-person memories.
  - Turn relative dates into real ones ("Friday" becomes "Friday, November 6").
  - Update an existing memory by its id when something changes, instead of adding a duplicate.
  - Skip small talk.
  - Keep the feeling in the memory where the twin felt something strongly (3/10 or more), and rate it as more important. People remember emotional moments better.
  - Leave out passwords, addresses, phone numbers, and account details.

**Reflection** (after every 10 new memories):

- The twin looks back over its 60 most recent memories and notes up to 3 impressions that no single memory says, for example "I get the sense Sam has been worn down lately, with repeated all-nighters."
- It updates an old impression instead of repeating it.

**Recall** (every message):

- The cue (the last three messages) is turned into a meaning vector, and each memory is scored by how far it stands out from the rest for this cue. That's measured in standard deviations from the average similarity, because small talk like "hey" never stands out by more than about 2, while real matches reach 3 to 6.
- Shared words add a bonus, which keeps names like "Biscuit" strong. Common words are ignored, rare words count more, and a word found in more than half the memories (like the other person's name) is ignored.
- Each memory gets a score:

  ```
  relevance = max(0, stand-out − 1.5) / 3  +  0.5 × shared words (vs. the best match)
  score     = relevance  +  0.5 × recency  +  0.5 × importance / 10
  recency   = 0.995 ^ (hours since last recalled)     (about 40% after a week)
  ```

- Up to 10 "core" memories (importance 9 or 10) always come along, plus the 15 highest-scoring others.
- **Fuzzy:** a recalled memory is marked fuzzy when `recency + importance / 10 < 0.8` and its importance is below 9. Small things go hazy after a week or so, and big ones stay sharp.
- **Reinforcement:** memories the cue clearly brought back count as recalled again, so they fade more slowly. That means a stand-out of 2.5 or more, or at least half the best word match. Nothing is ever deleted.
- **Without an OpenAI key,** or if embedding fails or takes more than 2 seconds, recall falls back to shared words alone.

Every write goes to a temporary file first and is then renamed into place, so a crash can't corrupt the memory.

## Server endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/chat` `{ text }` | Answers one message. The reply is a stream of server-sent events: `mood`, `text`, `done` (with model and token usage), `error`, and `refusal`. Sending a new message cuts off the reply in progress. |
| `POST /api/tts` `{ text }` | One sentence as audio: MP3 from ElevenLabs, or WAV from the Mac's `say`. |
| `GET /api/conversation` | The current conversation, used to redraw the chat after a refresh. |
| `POST /api/new-chat` | Forms memories from this conversation, then starts a fresh one. |
| `GET /api/mind`, `POST /api/mind` `{ action, ... }` | The Mind page. `GET` returns the persona notes, rules, memories, mood and chat length. `POST` actions are `savePersona`, `deletePersona`, `saveRules`, `addMemory`, `updateMemory`, `deleteMemory`, `forgetAll`, `resetMood` and `clearConversation`. Note names must be simple `.md` names, so they can't reach outside `persona/`. |
| `POST /api/tick` | Called every minute by the open page. Returns what the twin is doing (for the status chip and whether the avatar is home). A few minutes before an activity it goes out for, it also returns a leaving line, announced once per occurrence (tracked in `memory/schedule-state.json`). Within 30 minutes of coming home from something it went out for, it also looks around and reacts to whatever changed while it was gone (once per return), and the response carries its new mood. |
| `POST /api/house-asset` | Uploads a picture (JPEG, PNG or WebP, up to 15 MB; the page shrinks it to 2048 px first) or a 3D model (`.glb`, up to 40 MB). The type is checked from the file's first bytes. Saved in `house-assets/` and served at `/house-assets/…`. |
| `POST /api/describe-picture` | Optional: a short description of an uploaded picture, from OpenAI (`gpt-5.4-mini`), so the twin knows what it shows. Only runs when you click "Describe it for me". |
| `POST /api/house-react` | Called a few seconds after you stop changing the house, or when you close the panel. The twin reacts to what changed since it last looked, by its taste in the persona notes (one or two sentences, plus a feeling that updates its mood). It's skipped while the twin is out. Something dropped within 1.2 m of the twin triggers it after about a second instead. The prompt allows any feeling (delight, disgust, a real fright) and leaves the reaction to the persona; `rules.md` says fear doesn't vanish by itself and settles gradually with comfort. |
| `POST /api/house` | Saves the House settings (invalid values are replaced with defaults). `GET /api/config` returns them as `house`. |
| `POST /api/opener` | Called when the page loads. After a break of 3 hours or more, the twin decides whether to say something first, and returns its line or `null`. |
| `POST /api/import` | One-time move of a conversation kept in the browser by an older version. |
| `GET /api/config` | Name, brain, model, voice, avatar address, token totals, and current mood for the page. |

## Settings (`.env`)

| Key | Meaning |
|---|---|
| `BRAIN` | `openai`, `claude` or `chatgpt` (ChatGPT plan through Codex; see `codex.js`) |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT` | GPT settings (default `gpt-5.4`, effort `low`). Replies also use low verbosity, to keep them short. |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `CLAUDE_EFFORT` | Claude settings (default `claude-opus-5-5`, effort `low`). The rules and persona are prompt-cached. |
| `FALLBACK_MODEL`, `FALLBACK_AFTER_SECONDS` | Backup model (default `gpt-5.4-mini`; a name starting with `claude` uses Claude; `none` turns it off). It answers when the main model fails or hasn't started answering after 20 seconds, and also forms memories and decides about speaking first if the main model fails. The page shows a note when it answered, and the Brain chip's tooltip names it. |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL` | Cloned voice. Leave these blank to use the Mac voice. |
| `MAC_VOICE` | A voice name from `say -v '?'` |
| `TWIN_NAME` | The name shown on the page |
| `HOUSE_FILE` | Where the House settings are saved (default `house.json`) |
| `PERSONA_DIR`, `MEMORY_DIR`, `RULES_FILE` | Use a different persona folder, memory folder or rules file (handy for testing changes side by side) |
| `PORT` | Default 4747 |

With no API key, the app still runs in demo mode: it repeats what you said, so you can check the avatar and voice for free.

## Running it

The step-by-step guide for setting it up from scratch is [README.md](README.md). In short:

```bash
npm run setup   # first time: installs, asks for the key, writes .env
npm start       # then open http://localhost:4747
npm run check   # if anything's wrong
```

Then open http://localhost:4747 in Chrome or Safari. Voice input needs one of these, because it uses the browser's speech recognition.

Edits to `rules.md` and `persona/` apply on the next message. Changes to `server.js`, `memory.js`, or `.env` need a restart (Ctrl+C, then `npm start`). Changes to `public/` need a page refresh.

## Design choices, and why

- **Localhost only.** The server holds the API keys, so nothing else on the network can use them.
- **Time stamps on each message, not in the instructions.** Tests showed the model ignored a "they were away" note placed in the instructions but noticed it on the message itself.
- **Real dates in memories.** A stored "on Friday" once made the twin ask how a test went before the test had happened.
- **Speech one sentence at a time.** Audio for each sentence is requested as soon as the sentence is complete, so the twin starts talking before the whole reply arrives.
- **Interruptions keep the order.** A new message stops the current reply, waits for the cut-off part to be saved, and then answers. The saved conversation always matches what was actually said.
- **Short replies.** Rules plus GPT's low verbosity setting brought replies from about 31 words to about 8 in a test, and almost none end with a question.
- **Mood in a hidden tag, not a second request.** The same model that writes the reply first says how it feels, so the feeling comes before the words and there's no extra request. Earlier replies keep their tags in the history the model sees, so it keeps writing them.
  - In a test, insulting the stand-in persona's hobbies made it annoyed (4/10).
  - The annoyance carried into the next message ("Still think your take was terrible").
  - An apology calmed it.
  - The resulting memory was "It annoyed me when they called my hobbies lame, but they apologized and I let it go."
- **A backup model.** If the main model fails or hasn't started answering in 20 seconds, `gpt-5.4-mini` answers instead, which it does in under a second. It was tested with a model name that doesn't exist (the backup answered every time and also formed the memories), with a 0.3-second limit (the backup took over), and with the backup off (the error showed as before).
- **Safety nets for the mood tag.** The parser reads any `[mood ...]` loosely and always hides it, because the model once copied "0-10" from the instructions and the tag leaked. If a reply comes back with only a tag, it's asked once more. A reply without a tag is saved with the mood as it stood, so the history keeps showing tags.

## What was tested, and what was kept (November 5, 2026)

Each idea was tried side by side against the current version, using a made-up stand-in persona and separate memory folders. Where it helped, a blind GPT judge compared whole conversations in both orders.

| Idea | Result | Decision |
|---|---|---|
| Knowledge limits (rule) | The current rules recited the Krebs cycle and Brazil's third president. A first rule only partly helped. A strict rule stopped trivia but made it play dumb about its own interests. The tuned rule knows its own world (Andromeda's distance, chain wear), is hazy on school stuff, and says "no idea" to trivia. | Kept (tuned rule) |
| Private thought in the mood tag | The model mostly stopped writing tags (6 of 7 replies). The current version won "reads between the lines" 2–0 and tied on sounding human. | Dropped |
| Thinking longer (reasoning effort medium) | First words arrived after 4.8 s instead of 1.5 s, with no clearly better replies. | Dropped |
| Fuzzy memories | Hedging with exact details ("I think it was Velvet Static?") and gist-only forgetting both beat perfect recall. Gist won 2–0 over the current version and tied 1–1 with fuzzy. Fuzzy was kept because it costs nothing extra and loses no details. | Kept (fuzzy labels) |
| Reflection (impressions) | With 69 memories, a vague "feeling off lately" recalled 14 chit-chat memories and no stress pattern without reflection, and the right impressions with it. In conversation it always won "knows what's going on" 2–0. It lost "sounds human" 0–2 across three wordings, because connecting dots reads as slightly analytical. | Kept, with the lightest wording |
| Recall by meaning | With 12 reworded cues among 69 memories, word matching found 2 and meaning ranked the right memory first for 11 (top 5 for all 12). Small talk strengthens nothing. It adds about 0.2–0.5 s per message. | Kept |
| Speaking first | Over 3 fresh rounds each, a test yesterday got "How'd the chem test go?" every time. Nothing notable and a fight 4 hours earlier got silence every time. A 20-minute gap doesn't ask the model at all. | Kept |
| Body language and mood faces | Checked in Chrome: angry, sad (with head droop), happy and surprised faces, and the thinking look. | Kept |

## Known limits

- Recall by meaning needs an OpenAI key (it falls back to shared words without one). Embedding the cue adds about 0.2–0.5 s before the first words; in the last full test, first words averaged about 2.4 s.
- Lip sync follows loudness, not the actual mouth shapes of the sounds.
- In Chrome, voice input is processed by Google's speech service. Safari uses Apple's.
- One person and one conversation at a time. There are no accounts or logins (it relies on running locally).
- Token counts don't include the voice, and there's no dollar estimate.
- Mood is one feeling at a time, so mixed feelings aren't modeled. The Mac voice doesn't change with mood. Only the words and the face do.
- Without ElevenLabs, the voice comes from the Mac's `say` command, so on any other computer the voice needs ElevenLabs.
- There's no automated test suite. Changes have been checked with scripts that chat with a made-up test persona.
- Memories are about one person: if someone else uses the twin, it will think they're the same person.
- The model now and then skips the mood tag, which leaves the mood unchanged for that reply.

## Ideas for next steps

- **Lip sync:** use ElevenLabs' per-character timings to drive the avatar's mouth shapes.
- **Speech-to-text:** Whisper on the server, for browsers without speech recognition.
- **Gestures:** the mood already drives the face; drive a few body animations from it too, and voice emotion with ElevenLabs v3 tags like [sighs] and [laughs].
- **Per-person memory:** recognize who's talking and keep separate memories and a relationship with each person.
- **Faster first words:** skip the meaning lookup for tiny messages like "ok", or start the reply while it runs.
- **Custom avatar:** a custom avatar (VRoid Studio exports `.vrm`) and a cloned voice, both made with the person's consent.

## Working rules for anyone changing it

- **Keep keys secret.** Never print, paste, or commit API keys. They live only in `.env`.
- **Keep the private folders private.** `persona/`, `persona-backups/`, `memory/`, and any `.vrm` or voice files are about a real person. Don't upload them, commit them, or paste their contents into AI tools.
- **Test with a made-up persona and a separate memory folder,** so tests don't touch the real twin's memory. For example:

  ```bash
  PORT=4748 TWIN_NAME=Robin PERSONA_DIR=/path/to/test-persona MEMORY_DIR=/path/to/test-memory node server.js
  ```

- **Stop the server before editing the files in `memory/` by hand.** Deleting the folder wipes the twin's memory.
- **Respect the person's say.** The person the twin is based on gets a say in who talks to it, whether it's ever shown publicly, and whether it's deleted.
