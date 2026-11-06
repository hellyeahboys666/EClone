// Digital clone server: serves the web app, streams replies built from the persona
// notes (Claude or GPT), and turns reply text into speech (ElevenLabs or the Mac's `say`).
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createMemory, formatTime, loadJson, saveJson } from './memory.js';
import { updateEnvFile } from './env-file.js';
import { LANGUAGES, LANGUAGE_CODES, detectLanguage } from './languages.js';
import {
  KINDS, NOTE_PLAN, NOTE_SCHEMA, FINDINGS_SCHEMA, SCORE_SCHEMA,
  chunks, describeStyle, examplesNote, exchanges, findingsFor, measureStyle, parseSource, pickExchanges, speakers, wordCount,
} from './persona-builder.js';
import { createCodex } from './codex.js';
import { FEELINGS, createMood, createTagReader, moodTag, splitMoodTag } from './mood.js';
import { cleanHouse } from './public/house-config.js';
import { describeHouse, houseChanges } from './surroundings.js';
import { cleanSchedule, clock, currentActivity, isSleep, nextActivity, occurrences, withDefaultSleep } from './public/schedule-config.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');

// The app's own files as they were when it started. The page is read fresh from disk,
// but the server keeps running its old code until restarted, so after an update the
// two can disagree: the page then says to restart.
function codeStamp() {
  const parts = [];
  for (const dir of [ROOT, PUBLIC_DIR, path.join(ROOT, 'scripts')]) {
    for (const f of readdirSync(dir).sort()) {
      if (!/\.(m?js|html|css)$/.test(f)) continue;
      const st = statSync(path.join(dir, f));
      parts.push(`${f}:${st.size}:${st.mtimeMs}`);
    }
  }
  return parts.join('|');
}
const startStamp = codeStamp();
const codeChanged = () => {
  try {
    return codeStamp() !== startStamp;
  } catch {
    return false;
  }
};
const AVATAR_DIR = path.join(ROOT, 'avatar');
const SAMPLE_AVATAR =
  'https://cdn.jsdelivr.net/gh/pixiv/three-vrm@v3.4.1/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm';

// Settings and keys. ENV_FILE points somewhere else (for testing with another setup).
const ENV_FILE = path.resolve(ROOT, process.env.ENV_FILE || '.env');
try {
  process.loadEnvFile(ENV_FILE);
} catch {
  // No .env yet: run with demo replies and the Mac voice.
}

const config = {
  port: Number(process.env.PORT || 4747),
  name: process.env.CLONE_NAME || process.env.TWIN_NAME || 'Clone', // TWIN_ names from older setups still work
  personaDir: path.resolve(ROOT, process.env.PERSONA_DIR || 'persona'),
  // Everything you give it about the person (chats, writing, answers), to build the persona from (private).
  sourcesDir: path.resolve(ROOT, process.env.SOURCES_DIR || 'sources'),
  personaBackupsDir: path.resolve(ROOT, process.env.PERSONA_BACKUPS_DIR || 'persona-backups'),
  rulesFile: path.resolve(ROOT, process.env.RULES_FILE || 'rules.md'), // another file lets you try rule changes side by side
  memoryDir: path.resolve(ROOT, process.env.MEMORY_DIR || 'memory'),
  houseFile: path.resolve(ROOT, process.env.HOUSE_FILE || 'house.json'), // the House panel's settings
  assetDir: path.resolve(ROOT, process.env.HOUSE_ASSETS_DIR || 'house-assets'), // pictures and 3D models you uploaded (private)
  scheduleFile: path.resolve(ROOT, process.env.SCHEDULE_FILE || 'schedule.json'), // the clone's weekly schedule (private)
  // openai (GPT through the API), claude (Claude through the API), or chatgpt (GPT through
  // Codex, signed in with your ChatGPT account, so it uses your ChatGPT plan; see codex.js).
  brain: ['openai', 'claude', 'chatgpt'].includes(process.env.BRAIN) ? process.env.BRAIN : 'claude',
  model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
  effort: process.env.CLAUDE_EFFORT || 'low',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-5.4',
  openaiEffort: process.env.OPENAI_REASONING_EFFORT || 'low',
  codexModel: process.env.CODEX_MODEL || 'gpt-6-sol',
  codexEffort: process.env.CODEX_EFFORT || 'low',
  // Codex talks to ChatGPT directly, even if its own settings send it elsewhere. "default" uses Codex's settings.
  codexBaseUrl: process.env.CODEX_BASE_URL || 'https://chatgpt.com/backend-api/codex',
  // Backup model, used when the main one fails or hasn't started answering in time.
  // A name starting with "claude" uses Claude; anything else uses OpenAI. "none" turns it off.
  fallbackModel: process.env.FALLBACK_MODEL || 'gpt-5.4-mini',
  fallbackAfterMs: 1000 * Number(process.env.FALLBACK_AFTER_SECONDS || 20),
  // Whether the clone may cut you off while you're still typing or talking (yes/no).
  interrupts: !/^(no|off|false|0)$/i.test(process.env.CLONE_INTERRUPTS || process.env.TWIN_INTERRUPTS || 'yes'),
  // none (text only, the default), mac (this Mac's voice) or elevenlabs. Left unset, an
  // ElevenLabs voice that's set up is used, and otherwise there's no voice.
  voice: process.env.VOICE || '',
  elevenKey: process.env.ELEVENLABS_API_KEY || '',
  elevenVoice: process.env.ELEVENLABS_VOICE_ID || '',
  elevenVoiceName: process.env.ELEVENLABS_VOICE_NAME || '',
  elevenModel: process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5',
  macVoice: process.env.MAC_VOICE || '',
  // More ElevenLabs voices, one per language, for a clone that speaks several (private).
  voicesFile: path.resolve(ROOT, process.env.VOICES_FILE || 'voices.json'),
};
// The voice can be changed from the page (the Voice panel) while the clone is running.
const elevenReady = () => Boolean(config.elevenKey && config.elevenVoice);
function voiceMode() {
  if (config.voice === 'elevenlabs') return elevenReady() ? 'elevenlabs' : 'none';
  if (config.voice === 'mac') return process.platform === 'darwin' ? 'mac' : 'none';
  if (config.voice === 'none') return 'none';
  return elevenReady() ? 'elevenlabs' : 'none';
}
const useElevenLabs = () => voiceMode() === 'elevenlabs';
const brainLabel = { openai: 'OpenAI', claude: 'Claude', chatgpt: 'ChatGPT (Codex)' }[config.brain];
const brainModel = { openai: config.openaiModel, claude: config.model, chatgpt: config.codexModel }[config.brain];
const execFileAsync = promisify(execFile);

// The models to try, in order: the main one, then the backup if it's set up (and
// different). Each says which provider runs it.
const mainModel = { name: brainModel, provider: config.brain === 'chatgpt' ? 'codex' : config.brain };
const codex = createCodex({
  bin: process.env.CODEX_BIN,
  model: config.codexModel,
  effort: config.codexEffort,
  baseUrl: config.codexBaseUrl === 'default' ? '' : config.codexBaseUrl,
});
const codexStatus = config.brain === 'chatgpt' ? await codex.status() : null;
const backupModel = (() => {
  const name = config.fallbackModel.trim();
  if (!name || name === 'none' || name === brainModel) return null;
  const provider = name.startsWith('claude') ? 'claude' : 'openai';
  const hasKey = provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  return hasKey ? { name, provider } : null;
})();

let anthropicClient;
function claude() {
  anthropicClient ??= new Anthropic();
  return anthropicClient;
}

let openaiClient;
function openai() {
  openaiClient ??= new OpenAI();
  return openaiClient;
}

// The persona is re-read on every turn, so edits to persona/*.md apply on the next message.
async function buildSystemPrompt() {
  const rules = await readFile(config.rulesFile, 'utf8');
  const files = (await readdir(config.personaDir))
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .sort();
  const notes = await Promise.all(
    files.map(async (f) => {
      const body = await readFile(path.join(config.personaDir, f), 'utf8');
      return `<file name="${f}">\n${body.trim()}\n</file>`;
    }),
  );
  return `${rules.trim()}\n\n<persona_notes>\n${notes.join('\n\n')}\n</persona_notes>`;
}

// The memories this moment brought back, in the form the rules describe. Faded,
// smaller memories are marked fuzzy, so the clone half-remembers them.
function memoryBlock(memories) {
  if (!memories.length) return '';
  return `<memories>\n${memories.map((m) => `- ${m.date}${m.fuzzy ? ' (fuzzy)' : ''}: ${m.text}`).join('\n')}\n</memories>`;
}

// The room the clone is standing in (the House panel's settings, in words), and what
// changed since it last spoke. The house as it was then is kept in house-seen.json.
async function surroundingsBlock() {
  const now = currentActivity(await loadSchedule());
  if (now?.activity.where === 'away') {
    return `<surroundings>\nYou're not at home right now: you're out at ${now.activity.name}${now.activity.note ? ` (${now.activity.note})` : ''}. The living room they see on their screen is empty while you're out.\n</surroundings>`;
  }
  if (isSleep(now?.activity)) {
    return "<surroundings>\nYou're in bed in your bedroom, in the dark, not in the living room they see on their screen (it's empty while you sleep).\n</surroundings>";
  }
  const house = await loadHouse();
  const seen = await loadJson(path.join(config.memoryDir, 'house-seen.json'), null).catch(() => null);
  const changes = houseChanges(seen, house);
  return (
    `<surroundings>\n${describeHouse(house)}` +
    (changes.length ? `\nSince you last spoke, ${changes.join('; ')}. You notice it as soon as you look around.` : '') +
    '\n</surroundings>'
  );
}

async function rememberHouseSeen() {
  await saveJson(path.join(config.memoryDir, 'house-seen.json'), await loadHouse());
}

// ---- Schedule: what the clone is doing, and leaving for things -----------------

// With a default night's sleep added the first time (and saved, so it shows on the Mind page).
async function loadSchedule() {
  const { schedule, changed } = withDefaultSleep(await loadJson(config.scheduleFile, {}).catch(() => ({})));
  if (changed) await saveJson(config.scheduleFile, schedule).catch((err) => console.error('[schedule]', err));
  return schedule;
}

// Not in the living room they see: out somewhere, or asleep in bed.
const outOfRoom = (o) => o?.activity.where === 'away' || isSleep(o?.activity);

// What the clone is doing right now and what's next, for the brain. Empty without a schedule.
async function scheduleBlock(when = new Date()) {
  const schedule = await loadSchedule();
  if (!schedule.activities.length) return '';
  const describe = (o) => `${o.activity.name}${o.activity.note ? ` (${o.activity.note})` : ''}`;
  const day = (d) => (d.toDateString() === when.toDateString() ? 'today' : d.toDateString() === new Date(when.getTime() + 86_400_000).toDateString() ? 'tomorrow' : d.toLocaleDateString('en-US', { weekday: 'long' }));
  const now = currentActivity(schedule, when);
  const next = nextActivity(schedule, when);
  const lines = [];
  if (now && isSleep(now.activity)) {
    lines.push(
      `Right now you're asleep (${describe(now)}, until ${clock(now.end)}). Their message woke you up, or you saw it half asleep. ` +
        "You're groggy: reply the way someone just woken up would, very short, mumbly, maybe grumpy about being woken or asking why they're up so late, " +
        "and wanting to go back to sleep. Often you don't answer at all ([no reply]). If it's urgent or important, you wake up properly. " +
        "If they keep messaging, you get more awake and more annoyed.",
    );
  } else if (now) {
    const a = now.activity;
    lines.push(`Right now you're ${a.where === 'away' ? 'out at' : 'at home doing'} ${describe(now)}, until ${clock(now.end)}.`);
    if (a.busy) lines.push("You're busy, so reply the way you would when busy: briefly, and maybe say you're busy or at it and will talk later, in your own words. If it's urgent or important, you make time.");
  } else {
    lines.push("Right now you're free, with nothing scheduled.");
    // Something that just ended ("you got off work 5 minutes ago"), so a person would know.
    const done = occurrences(schedule, when).filter((o) => o.end <= when && when - o.end < 2 * 3_600_000).at(-1);
    if (done) {
      const ago = Math.round((when - done.end) / 60_000);
      lines.push(`You finished ${describe(done)} at ${clock(done.end)}, ${ago < 60 ? `about ${Math.max(1, ago)} minutes ago` : 'a little while ago'}${done.activity.where === 'away' ? ", and you're back home" : ''}.`);
    }
  }
  if (next) {
    const minutes = Math.round((next.start - when) / 60_000);
    const soon = minutes <= 60 ? `, in about ${minutes} minutes` : '';
    lines.push(`Next: ${describe(next)} at ${clock(next.start)} ${day(next.start)}${soon}${next.activity.where === 'away' ? ' (you go out for it)' : ''}.`);
  }
  return `<schedule>\n${lines.join(' ')}\n</schedule>`;
}

// Called every minute by the open page: what the clone is doing (for the status
// chip and whether it's in the house), and, a few minutes before it goes out for
// something, a line saying it's leaving. Each departure is announced once.
const ANNOUNCE_SCHEMA = { type: 'object', additionalProperties: false, required: ['line'], properties: { line: { type: 'string' } } };
let announcing = false;

async function handleTick(res) {
  const schedule = await loadSchedule();
  const when = new Date();
  const now = currentActivity(schedule, when);
  const status = now
    ? { name: now.activity.name, note: now.activity.note, until: clock(now.end), where: now.activity.where, busy: now.activity.busy, asleep: isSleep(now.activity) }
    : null;
  let line = null;
  const due = occurrences(schedule, when).find(
    (o) => outOfRoom(o) && o.activity.notice && o.start > when && o.start - when <= o.activity.notice * 60_000,
  );
  if (due && hasBrainKey() && !inFlight && !announcing) {
    const stateFile = path.join(config.memoryDir, 'schedule-state.json');
    const state = await loadJson(stateFile, { announced: [] }).catch(() => ({ announced: [] }));
    if (!state.announced.includes(due.key)) {
      announcing = true;
      try {
        state.announced = [...state.announced, due.key].slice(-60);
        await saveJson(stateFile, state); // marked first, so a failure can't make it repeat
        line = await announceLeaving(due, when);
      } catch (err) {
        console.error('[schedule]', err);
      } finally {
        announcing = false;
      }
    }
  }
  // Back from something it went out for: it walks in and notices whatever changed
  // while it was gone. Each return is handled once, within half an hour of it.
  let felt = null;
  const back = !line && !outOfRoom(now)
    ? occurrences(schedule, when).filter((o) => outOfRoom(o) && o.end <= when && when - o.end < 30 * 60_000).at(-1)
    : null;
  if (back && hasBrainKey() && !inFlight && !announcing && !reacting) {
    const stateFile = path.join(config.memoryDir, 'schedule-state.json');
    const state = await loadJson(stateFile, { announced: [] }).catch(() => ({ announced: [] }));
    const returned = state.returned ?? [];
    if (!returned.includes(back.key)) {
      reacting = true;
      try {
        await saveJson(stateFile, { ...state, returned: [...returned, back.key].slice(-60) });
        const reaction = await reactToHouse({ arriving: back.activity });
        if (reaction) ({ line, felt } = reaction);
      } catch (err) {
        console.error('[schedule]', err);
      } finally {
        reacting = false;
      }
    }
  }
  sendJson(res, 200, {
    updated: codeChanged(),
    scheduled: schedule.activities.length > 0,
    status,
    line,
    ...(felt && { mood: moodForPage(felt) }),
    ...(line && { totals: memory.usageSummary() }),
  });
}

async function announceLeaving(due, when) {
  const messages = memory.messages();
  const cue = `${due.activity.name} ${due.activity.note}\n${messages.slice(-3).map((m) => m.content).join('\n')}`;
  const [vector, instructions, room, plans] = await Promise.all([memory.cueVector(cue), buildSystemPrompt(), surroundingsBlock(), scheduleBlock(when)]);
  const system = [instructions, memoryBlock(memory.recall(cue, { vector, reinforce: false })), room, plans, `<mood>\n${mood.describe()}\n</mood>`]
    .filter(Boolean)
    .join('\n\n');
  const minutes = Math.max(1, Math.round((due.start - when) / 60_000));
  const prompt = isSleep(due.activity)
    ? `It's ${clock(when)}. You're going to bed in about ${minutes} minutes (at ${clock(due.start)}). Tell them you're heading to bed, ` +
      "the way you'd say goodnight to a friend: one short line in your usual voice, with no mood tag. If you were in the middle of something with them, you can wrap it up."
    : `It's ${clock(when)}. You need to head out for ${due.activity.name}${due.activity.note ? ` (${due.activity.note})` : ''} in about ${minutes} ` +
    `minutes (it starts at ${clock(due.start)}). Tell them you're about to leave, the way you'd tell a friend: one short line in your ` +
    'usual voice, with no mood tag. If you were in the middle of something with them, you can wrap it up.';
  const { data, usage } = await completeJson(system, prompt, ANNOUNCE_SCHEMA);
  await memory.recordUsage('chat', usage);
  const line = splitMoodTag(String(data.line ?? '').trim()).text;
  if (!line) return null;
  await memory.addMessage({ role: 'assistant', content: line, at: Date.now(), mood: mood.current() });
  return line;
}

// How the clone feels right now, and how to report a change. The tag format lives
// here, next to the code that reads it (mood.js).
function moodBlock() {
  return (
    `<mood>\n${mood.describe()}\n</mood>\n\n` +
    'Start every reply with a hidden tag saying how you feel after their latest message: the feeling, one ' +
    'number for how strongly, and a few words on why, like [mood: calm 1 | nothing much happened]. ' +
    `The feeling is one of: ${FEELINGS.join(', ')}. The number goes from 0 (barely) to 10 (as strong as it gets). ` +
    "The tag is removed before they see or hear anything, so never mention it. After the tag, reply as usual, or, " +
    'if you would say nothing at all to this, write only [no reply] after the tag.'
  );
}

// Keeps only plain user/assistant text turns, starting with a user turn. Spoken
// replies are short, so the latest 100 turns stay cheap to resend.
function cleanHistory(messages) {
  const list = (Array.isArray(messages) ? messages : []).filter(
    (m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim(),
  );
  const turns = list
    .map((m) => {
      if (m.role !== 'assistant' || m.mood) return m;
      const { mood: found, text } = splitMoodTag(m.content);
      return found ? { ...m, content: text, mood: found } : m;
    })
    .map((m, i) => {
      // A message without a time (an old client) is treated as sent just now if it's the latest.
      const at = Number.isFinite(m.at) ? m.at : i === list.length - 1 ? Date.now() : NaN;
      // Earlier replies keep their mood tags, so the brain sees how its feelings went
      // and keeps writing the tag.
      let label = m.role === 'user' ? timeLabel(at, list[i - 1]?.at) : m.mood ? `${moodTag(m.mood)} ` : '';
      // Interruptions, both ways (the dash at the end shows where the speaker was cut off).
      if (m.interrupting) label += '(They talked over you, cutting you off.) ';
      if (m.cutOff) label += '(You cut them off before they finished; this is as far as they got.) ';
      return { role: m.role, content: label + m.content.slice(0, 4000), at };
    })
    .slice(-100);
  // The clone may have spoken first (see handleOpener), so a conversation can open with
  // its line; the brain needs a turn from them first, so note that they opened the chat.
  if (turns[0]?.role === 'assistant') {
    turns.unshift({ role: 'user', content: `${timeLabel(turns[0].at)}(They opened the chat but haven't said anything yet.)` });
  }
  // Two lines in a row from the same side become one turn.
  const merged = [];
  for (const { role, content } of turns) {
    if (merged.at(-1)?.role === role) merged.at(-1).content += `\n${content}`;
    else merged.push({ role, content });
  }
  return merged;
}

// Marks each of their messages with when it was sent (this Mac's clock) and, after a
// break, how long they were away. The clone uses it to tell a late night from a
// morning, and someone coming back from someone repeating themselves.
function timeLabel(at, previousAt) {
  if (!Number.isFinite(at)) return '';
  const minutes = Math.round((at - previousAt) / 60000);
  let away = '';
  if (minutes >= 10) {
    const hours = Math.round(minutes / 60);
    const span =
      minutes < 60 ? `${minutes} minutes` : hours < 48 ? `${hours} hour${hours === 1 ? '' : 's'}` : `${Math.round(hours / 24)} days`;
    away = `, back after about ${span}`;
  }
  return `[${formatTime(at)}${away}] `;
}

// Token counts in one shape for both brains. `input` includes cached tokens.
function claudeUsage(u) {
  const cached = u.cache_read_input_tokens ?? 0;
  return { input: u.input_tokens + cached + (u.cache_creation_input_tokens ?? 0), cached, output: u.output_tokens };
}

function openaiUsage(u) {
  return { input: u.input_tokens, cached: u.input_tokens_details?.cached_tokens ?? 0, output: u.output_tokens };
}

// One-off request for a JSON reply matching `schema`, used to form memories.
// (Forming memories, reflecting, deciding whether to speak first.) Falls back to the
// backup model if the main one fails.
async function completeJson(system, prompt, schema) {
  try {
    return await completeJsonWith(mainModel, system, prompt, schema);
  } catch (err) {
    if (!backupModel) throw err;
    console.error(`[backup] ${mainModel.name} failed (${describeError(err)}); trying ${backupModel.name}`);
    return await completeJsonWith(backupModel, system, prompt, schema);
  }
}

async function completeJsonWith({ name, provider }, system, prompt, schema) {
  if (provider === 'codex') return codex.json(system, prompt, schema);
  if (provider === 'openai') {
    const r = await openai().responses.create({
      model: name,
      instructions: system,
      input: prompt,
      reasoning: { effort: 'low' },
      text: { format: { type: 'json_schema', name: 'memories', schema, strict: true } },
    });
    return { data: JSON.parse(r.output_text), usage: openaiUsage(r.usage) };
  }
  const r = await claude().beta.messages.create({
    model: name,
    max_tokens: 8000,
    system,
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
  });
  const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { data: JSON.parse(text), usage: claudeUsage(r.usage) };
}

// Meaning vectors for recall by meaning, from OpenAI's small embedding model (used
// with either brain whenever an OpenAI key is set). Without one, recall matches words.
const embed = process.env.OPENAI_API_KEY
  ? async (texts) => {
      const r = await openai().embeddings.create({ model: 'text-embedding-3-small', dimensions: 256, input: texts });
      return { vectors: r.data.map((d) => d.embedding), usage: { input: r.usage.total_tokens, cached: 0, output: 0 } };
    }
  : null;

function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError || err instanceof OpenAI.AuthenticationError) {
    return `${brainLabel} rejected the API key in .env.`;
  }
  if (err instanceof Anthropic.RateLimitError || err instanceof OpenAI.RateLimitError) {
    return `${brainLabel} is rate-limiting requests, or the account is out of credit. Wait a moment and try again.`;
  }
  if (err instanceof Anthropic.APIConnectionError || err instanceof OpenAI.APIConnectionError) {
    return `Could not reach the ${brainLabel} API. Check the internet connection.`;
  }
  if (err instanceof Anthropic.APIError || err instanceof OpenAI.APIError) {
    return `${brainLabel} API error ${err.status ?? ''}: ${err.message.replace(/^\d{3}\s+/, '')}`;
  }
  return err?.message || String(err);
}

async function streamDemoReply(lastUserText, send, signal) {
  const reply =
    (config.brain === 'chatgpt'
      ? "I'm in demo mode, so I can't really think yet. Codex isn't signed in with ChatGPT; run codex login and restart. "
      : `I'm in demo mode, so I can't really think yet. There's no ${brainLabel} API key in the dot env file. `) +
    `You said: "${lastUserText.slice(0, 200)}". Once the key is in, I'll answer as myself.`;
  for (const word of reply.split(/(?<=\s)/)) {
    if (signal.aborted) return;
    send({ type: 'text', text: word });
    await new Promise((r) => setTimeout(r, 35));
  }
}

// Both brains stream text through `send` and return which model answered and the
// tokens used. `system` is [rules + persona, recalled memories]; the first part
// rarely changes, so it's the part that gets cached.
async function streamClaude(modelName, system, history, send, signal) {
  const stream = claude().beta.messages.stream(
    {
      model: modelName,
      max_tokens: 16000,
      system: system.map((text, i) => ({ type: 'text', text, ...(i === 0 && { cache_control: { type: 'ephemeral' } }) })),
      messages: history,
      output_config: { effort: config.effort },
      // If a safety classifier declines, the API retries on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    },
    { signal },
  );
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      send({ type: 'text', text: event.delta.text });
    }
  }
  const final = await stream.finalMessage();
  return { model: final.model, refused: final.stop_reason === 'refusal', usage: claudeUsage(final.usage) };
}

// ChatGPT through Codex: the whole reply arrives at once (see codex.js).
function streamCodex(modelName, system, history, send, signal) {
  return codex.reply(system, history, send, signal);
}

async function streamOpenAI(modelName, system, history, send, signal) {
  const stream = await openai().responses.create(
    {
      model: modelName,
      instructions: system.join('\n\n'),
      input: history,
      reasoning: { effort: config.openaiEffort },
      text: { verbosity: 'low' }, // short, spoken-length replies
      stream: true,
    },
    { signal },
  );
  let model = modelName;
  let refused = false;
  let usage;
  for await (const event of stream) {
    if (event.type === 'response.output_text.delta') send({ type: 'text', text: event.delta });
    else if (event.type === 'response.refusal.delta') refused = true;
    else if (event.type === 'response.completed') {
      model = event.response.model;
      usage = event.response.usage && openaiUsage(event.response.usage);
    } else if (event.type === 'response.failed') throw new Error(event.response.error?.message ?? 'OpenAI response failed.');
  }
  return { model, refused, usage };
}

// The reply being streamed right now, so a new message can cut it off cleanly.
let inFlight = null;

async function handleChat(req, res) {
  const { text, cutOff } = await readJson(req);
  const message = String(text ?? '').trim().slice(0, 4000);
  if (!message) return sendJson(res, 400, { error: 'No message to answer.' });
  // `cutOff`: they talked over the clone, and this is as far as it had got (what was
  // shown and heard). Only that much counts as said.
  let interrupting = false;

  // Talking over the clone stops its reply. Wait for that reply to be saved first,
  // so the conversation stays in the order things were said.
  if (inFlight) {
    inFlight.abort.abort();
    await inFlight.done;
  }
  const abort = new AbortController();
  let finished;
  const turn = { abort, done: new Promise((r) => (finished = r)) };
  inFlight = turn;
  if (typeof cutOff === 'string') interrupting = await memory.cutOffLastReply(cutOff.slice(0, 4000)).catch(() => false);

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  res.on('close', () => {
    if (!res.writableEnded) abort.abort();
  });

  const live = hasBrainKey();
  let reply = '';
  let silent = false;
  let felt = null;
  try {
    if (!live) {
      await streamDemoReply(message, send, abort.signal);
      send({ type: 'done', brain: 'demo' });
      return;
    }
    await memory.addMessage({ role: 'user', content: message, at: Date.now(), ...(interrupting && { interrupting: true }) });
    const messages = memory.messages();
    // What was just said (and the moment before it) is the cue for recall.
    const cue = messages.slice(-3).map((m) => m.content).join('\n');
    const [vector, instructions, room, plans] = await Promise.all([memory.cueVector(cue), buildSystemPrompt(), surroundingsBlock(), scheduleBlock()]);
    const recalled = memory.recall(cue, { vector });
    const system = [instructions, memoryBlock(recalled), room, plans, moodBlock()].filter(Boolean);
    // The clone may choose to say nothing: then the reply (after the mood tag) is just
    // [no reply]. Text starting with "[" is held back until it's clear which it is.
    let held = '';
    const show = (text) => {
      if (!text || silent) return;
      if (!reply && (held || text.trimStart().startsWith('['))) {
        held += text;
        const start = held.trimStart();
        if (NO_REPLY.test(start)) {
          silent = true;
          return;
        }
        if (!start.includes(']') && start.length < 40) return;
        text = held;
        held = '';
      }
      reply += text;
      send({ type: 'text', text });
    };
    const flushHeld = () => {
      if (held && !silent) {
        const text = held;
        held = '';
        show(text);
      }
    };
    // The main model answers. If it fails, or hasn't started answering in time, the
    // backup takes over (without a backup, the main one gets a second try). An empty
    // reply, which happens now and then when the brain sends only the mood tag, also
    // gets a second try. The reply opens with a hidden mood tag; the page gets the
    // mood, never the tag.
    const attempts = [mainModel, backupModel ?? mainModel];
    let result;
    let answeredBy = mainModel;
    let fellBack = null;
    for (const [i, model] of attempts.entries()) {
      if (reply.trim() || silent || abort.signal.aborted) break;
      const last = i === attempts.length - 1;
      const attempt = new AbortController();
      const stop = () => attempt.abort();
      abort.signal.addEventListener('abort', stop);
      let started = false;
      // Waiting on a stuck model is worse than switching to the backup.
      const timer = !last && backupModel ? setTimeout(() => started || attempt.abort(), config.fallbackAfterMs) : null;
      const tags = createTagReader((m) => {
        felt = mood.settle(m); // anger cools slowly, whatever the brain says
        send({ type: 'mood', ...felt, at: Date.now(), halfLifeHours: mood.snapshot().halfLifeHours });
      });
      const stream = { openai: streamOpenAI, claude: streamClaude, codex: streamCodex }[model.provider];
      try {
        result = await stream(model.name, system, cleanHistory(messages), (event) => {
          started = true;
          show(tags.push(event.text));
        }, attempt.signal);
        show(tags.end());
        flushHeld();
        answeredBy = model;
        await memory.recordUsage('chat', result.usage);
        if (model !== mainModel) fellBack ??= { from: mainModel.name, reason: 'its reply was empty' };
      } catch (err) {
        // Talked over, already partly answered, or nobody left to try: stop here.
        if (abort.signal.aborted || reply.trim() || last) throw err;
        const reason = attempt.signal.aborted ? `no answer after ${config.fallbackAfterMs / 1000} s` : describeError(err);
        console.error(`[backup] ${model.name} failed (${reason}); trying ${attempts[i + 1].name}`);
        if (attempts[i + 1] !== model) fellBack = { from: model.name, reason };
      } finally {
        clearTimeout(timer);
        abort.signal.removeEventListener('abort', stop);
      }
    }
    if (!result) return;
    const { model, refused, usage } = result;
    if (refused) send({ type: 'refusal' });
    if (silent) send({ type: 'silent' });
    send({ type: 'done', brain: answeredBy.provider === 'codex' ? 'chatgpt' : answeredBy.provider, model, usage, totals: memory.usageSummary(), ...(fellBack && { fallback: fellBack }) });
  } catch (err) {
    if (!abort.signal.aborted) {
      console.error('[chat]', err);
      send({ type: 'error', message: describeError(err) });
    }
  } finally {
    // Keep even a cut-off reply, so the conversation matches what was actually said.
    // A feeling counts even if the reply was cut off.
    if (felt) await mood.set(felt).catch((err) => console.error('[mood]', err));
    if (live && silent && !reply.trim()) {
      // Saying nothing is still an answer: the brain sees it chose silence.
      await memory.addMessage({ role: 'assistant', content: '[no reply]', at: Date.now(), mood: felt ?? mood.current(), silent: true });
    } else if (live && reply.trim()) {
      // A reply without a tag keeps the mood as it stood, so the history the brain
      // sees still shows a tag on every reply and it keeps writing them.
      await memory.addMessage({ role: 'assistant', content: reply, at: Date.now(), mood: felt ?? mood.current() });
      await rememberHouseSeen().catch((err) => console.error('[house]', err));
    }
    res.end();
    if (inFlight === turn) inFlight = null;
    finished();
  }
}

async function handleConversation(res) {
  sendJson(res, 200, {
    messages: memory.messages()
      .filter((m) => m.content || m.silent)
      .map(({ role, content, at, silent }) => ({
        role,
        content: silent ? '' : role === 'assistant' ? splitMoodTag(content).text : content,
        at,
        ...(silent && { silent: true }),
      })),
  });
}

// New chat: the clone sleeps on this conversation, then starts a fresh one.
// When they open the page after a break, the clone decides whether it would say
// something first, the way a friend might ("so how'd the test go?"). Usually it waits.
const OPENER_GAP_MS = 3 * 3_600_000;
const OPENER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['speak', 'line'],
  properties: { speak: { type: 'boolean' }, line: { type: 'string' } },
};

async function handleOpener(res) {
  const messages = memory.messages();
  const lastAt = messages.at(-1)?.at ?? memory.lastTalked();
  if (!hasBrainKey() || inFlight || !lastAt || Date.now() - lastAt < OPENER_GAP_MS) return sendJson(res, 200, { line: null });
  try {
    const recent = messages.slice(-10);
    const cue = recent.length ? recent.map((m) => m.content).join('\n') : 'catching up with them';
    const [vector, instructions, room, plans] = await Promise.all([memory.cueVector(cue), buildSystemPrompt(), surroundingsBlock(), scheduleBlock()]);
    const system = [instructions, memoryBlock(memory.recall(cue, { vector, reinforce: false })), room, plans, `<mood>\n${mood.describe()}\n</mood>`]
      .filter(Boolean)
      .join('\n\n');
    const away = timeLabel(Date.now(), lastAt).replace(/^\[|\] $/g, '');
    const transcript = recent
      .map((m) => `${m.role === 'user' ? 'Them' : 'Me'}: ${m.role === 'assistant' ? splitMoodTag(m.content).text : m.content}`)
      .join('\n');
    const prompt =
      (transcript ? `How our last conversation ended:\n${transcript}\n\n` : '') +
      `It's now ${away}. They just opened the chat and haven't said anything yet. Like a real person seeing a ` +
      "friend come online, decide whether you'd say something first. Only do it if there's a real reason: following " +
      'up on something you remember that has happened since (a test, a plan, news), something you have been ' +
      "meaning to tell them, or a strong feeling left over from last time. Otherwise don't speak, and let them talk " +
      'first. If you speak, it is one short line in your usual voice, with no mood tag.';
    const { data, usage } = await completeJson(system, prompt, OPENER_SCHEMA);
    await memory.recordUsage('chat', usage);
    const line = data.speak ? splitMoodTag(data.line.trim()).text : '';
    if (!line) return sendJson(res, 200, { line: null });
    await memory.addMessage({ role: 'assistant', content: line, at: Date.now(), mood: mood.current(), opener: true });
    sendJson(res, 200, { line, totals: memory.usageSummary() });
  } catch (err) {
    console.error('[opener]', err);
    sendJson(res, 200, { line: null });
  }
}

// After you change the house, the clone looks around and reacts the way it would, by
// its own taste and nerves (from the persona notes): it might love the plant, hate the
// wallpaper, jump at something that suddenly appeared right next to it, or come home
// to a new TV and be thrilled. Its mood follows, and the line is saved in the
// conversation like anything it says.
const REACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['line', 'feeling', 'intensity', 'reason'],
  properties: {
    line: { type: 'string' },
    feeling: { type: 'string', enum: FEELINGS },
    intensity: { type: 'integer' },
    reason: { type: 'string' },
  },
};
let reacting = false;

// What the clone writes (after its mood tag) when it chooses not to answer.
const NO_REPLY = /^\[\s*(no reply|no response|silence|says? nothing|ignores?[^\]]*)\s*\]\s*$/i;

// `arriving` is the activity it just came home from, or null if it was standing there.
// Returns { line, felt }, or null when nothing changed (or nothing was said).
async function reactToHouse({ arriving = null } = {}) {
  const house = await loadHouse();
  const seenFile = path.join(config.memoryDir, 'house-seen.json');
  const seen = await loadJson(seenFile, null).catch(() => null);
  const changes = houseChanges(seen, house);
  if (!changes.length) return null;
  const cue = `${changes.join('\n')}\n${memory.messages().slice(-2).map((m) => m.content).join('\n')}`;
  const [vector, instructions, room, plans] = await Promise.all([memory.cueVector(cue), buildSystemPrompt(), surroundingsBlock(), scheduleBlock()]);
  const system = [instructions, memoryBlock(memory.recall(cue, { vector, reinforce: false })), room, plans, `<mood>\n${mood.describe()}\n</mood>`]
    .filter(Boolean)
    .join('\n\n');
  const what = isSleep(arriving)
    ? `You just woke up and walked into the living room. While you were asleep, someone changed your home: ${changes.join('; ')}. You see it the moment you come in, still a bit sleepy.`
    : arriving
    ? `You just got home from ${arriving.name}${arriving.note ? ` (${arriving.note})` : ''} and walked in. While you were out, someone changed your home: ${changes.join('; ')}. You see it the moment you come in.`
    : `Just now, while you were standing there, they changed your home: ${changes.join('; ')}. It happened with no warning, right in front of you.`;
  const prompt =
    `${what} React out loud the way you really would, in one or two short sentences. ` +
    'How you react depends on who you are (your notes, your taste, what scares or delights you, what you said before), not on what a ' +
    "typical person would do. A person could feel anything here: thrilled by a big new thing, delighted, curious, confused, " +
    "annoyed it isn't their style, grossed out, startled by something that appeared out of nowhere right beside them, or genuinely " +
    "scared of it. If it would scare you, be scared for real and let it show; don't brush it off or calm down by yourself in the " +
    "same breath. If you like it, say so; if it isn't your style, say so your way; if they removed something you liked, you can mind. " +
    'Also give the one feeling it leaves you with (from the list), how strongly from 0 to 10 (a real fright or a huge surprise can be ' +
    "8 or more), and a few words on why. The line has no mood tag.";
  const { data, usage } = await completeJson(system, prompt, REACTION_SCHEMA);
  await memory.recordUsage('chat', usage);
  await saveJson(seenFile, house); // seen now, so it won't bring it up again
  const line = splitMoodTag(String(data.line ?? '').trim()).text;
  if (!line) return null;
  const felt = {
    feeling: data.feeling,
    intensity: Math.min(10, Math.max(0, Math.round(data.intensity))),
    reason: String(data.reason ?? '').trim().slice(0, 200) || 'how the room changed',
  };
  const settled = await mood.set(felt);
  await memory.addMessage({ role: 'assistant', content: line, at: Date.now(), mood: settled });
  return { line, felt: settled };
}

async function handleHouseReact(res) {
  const none = () => sendJson(res, 200, { line: null });
  if (!hasBrainKey() || inFlight || reacting) return none();
  if (outOfRoom(currentActivity(await loadSchedule()))) return none(); // it'll notice when it's back
  reacting = true;
  try {
    const reaction = await reactToHouse();
    if (!reaction) return none();
    sendJson(res, 200, { line: reaction.line, mood: moodForPage(reaction.felt), totals: memory.usageSummary() });
  } catch (err) {
    console.error('[house]', err);
    none();
  } finally {
    reacting = false;
  }
}

function moodForPage(felt) {
  return { ...felt, at: Date.now(), since: Date.now(), halfLifeHours: mood.snapshot().halfLifeHours };
}

// ---- Interrupting: the clone cuts in while they're still typing or talking ------
// The page sends what they've typed (or said into the mic) so far, whenever they
// pause or have added a few words. Usually the clone lets them finish. If it would cut
// in, the page shows them being cut off and the clone's line, and only then (accept)
// is it saved, so a check that comes back after they already sent is dropped.
const INTERJECT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['interrupt', 'line', 'feeling', 'intensity', 'reason'],
  properties: {
    interrupt: { type: 'boolean' },
    line: { type: 'string' },
    feeling: { type: 'string', enum: FEELINGS },
    intensity: { type: 'integer' },
    reason: { type: 'string' },
  },
};
let interjecting = false;
let pendingInterjection = null;

async function handleInterject(req, res) {
  const { draft } = await readJson(req);
  const text = String(draft ?? '').trim().slice(0, 2000);
  const no = () => sendJson(res, 200, { interrupt: false });
  if (!config.interrupts || !hasBrainKey() || inFlight || reacting || interjecting) return no();
  if ((text.match(/\S+/g) ?? []).length < 4) return no();
  if (outOfRoom(currentActivity(await loadSchedule()))) return no(); // can't see them typing
  interjecting = true;
  try {
    const recent = cleanHistory(memory.messages()).slice(-8)
      .map((m) => `${m.role === 'user' ? 'Them' : 'You'}: ${m.content}`)
      .join('\n');
    const cue = `${recent.slice(-600)}\n${text}`;
    const [vector, instructions, room, plans] = await Promise.all([memory.cueVector(cue), buildSystemPrompt(), surroundingsBlock(), scheduleBlock()]);
    const system = [instructions, memoryBlock(memory.recall(cue, { vector, reinforce: false })), room, plans, `<mood>\n${mood.describe()}\n</mood>`]
      .filter(Boolean)
      .join('\n\n');
    const prompt =
      `The conversation so far:\n${recent || '(nothing yet)'}\n\n` +
      `They're in the middle of saying something to you and haven't finished. So far: "${text}"\n\n` +
      'Would you cut them off right now? Almost always people let each other finish, so the answer is usually no. ' +
      'Only cut in if what they have said so far really gets to you and it is like you to interrupt: it insults you or ' +
      "someone or something you care about, it's badly wrong about something you care about, it's something you strongly " +
      "object to, or your reaction just won't wait (shock, alarm, excitement). Judge it by your own notes: if you'd agree " +
      "with what they're saying, or it isn't about anything you care about, there's nothing to cut in about. Being mildly " +
      'bored or disagreeing a little is not enough. If you would cut in, write what you would blurt out, short and in your ' +
      'own voice: polite if that is you or you are only a bit bothered ("sorry, can I stop you there"), firm if you are ' +
      "angry, and if you are furious (8 or more) and you are someone who yells, yell it in CAPITALS. Also give the feeling (one of the listed feelings), how strongly 0 to 10, and a few words on why. If you would " +
      'let them finish, set interrupt to false and leave the line empty. No mood tag in the line.';
    const model = backupModel ?? mainModel; // quick: they're still typing
    const { data, usage } = await completeJsonWith(model, system, prompt, INTERJECT_SCHEMA);
    await memory.recordUsage('chat', usage);
    const line = splitMoodTag(String(data.line ?? '').trim()).text;
    if (!data.interrupt || !line) return no();
    const felt = {
      feeling: data.feeling,
      intensity: Math.min(10, Math.max(0, Math.round(data.intensity))),
      reason: String(data.reason ?? '').trim().slice(0, 200) || 'what they were saying',
    };
    pendingInterjection = { token: randomUUID(), draft: text, line, felt, at: Date.now() };
    sendJson(res, 200, { interrupt: true, token: pendingInterjection.token, line, mood: moodForPage(felt), totals: memory.usageSummary() });
  } catch (err) {
    console.error('[interject]', err);
    no();
  } finally {
    interjecting = false;
  }
}

async function handleInterjectAccept(req, res) {
  const { token } = await readJson(req);
  const p = pendingInterjection;
  if (!p || p.token !== token || Date.now() - p.at > 60_000 || inFlight) return sendJson(res, 409, { ok: false });
  pendingInterjection = null;
  await memory.addMessage({ role: 'user', content: `${p.draft}—`, at: p.at, cutOff: true });
  const settled = await mood.set(p.felt);
  await memory.addMessage({ role: 'assistant', content: p.line, at: Date.now(), mood: settled });
  sendJson(res, 200, { ok: true });
}

async function handleNewChat(res) {
  if (inFlight) {
    inFlight.abort.abort();
    await inFlight.done;
  }
  try {
    if (hasBrainKey()) await memory.startOver();
    sendJson(res, 200, { ok: true });
  } catch (err) {
    console.error('[memory]', err);
    sendJson(res, 502, { error: describeError(err) });
  }
}

// The House panel's settings (time of day, colors, furniture...), kept in house.json.
async function loadHouse() {
  return cleanHouse(await loadJson(config.houseFile, {}).catch(() => ({})));
}

// Uploads for the house: a picture (wallpaper, the view, a framed photo) or a 3D
// model (.glb). The file's first bytes must match its type. Saved in house-assets/.
const ASSET_TYPES = [
  { ext: 'jpg', max: 15e6, test: (b) => b[0] === 0xff && b[1] === 0xd8 },
  { ext: 'png', max: 15e6, test: (b) => b.subarray(0, 4).toString('hex') === '89504e47' },
  { ext: 'webp', max: 15e6, test: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  { ext: 'glb', max: 40e6, test: (b) => b.subarray(0, 4).toString() === 'glTF' },
];

async function handleUploadAsset(req, res) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 40e6) return sendJson(res, 413, { error: 'That file is too big (40 MB at most).' });
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  const type = ASSET_TYPES.find((t) => t.test(body));
  if (!type) return sendJson(res, 400, { error: 'Pictures must be JPEG, PNG or WebP, and 3D models .glb.' });
  if (body.length > type.max) return sendJson(res, 413, { error: 'That picture is too big (15 MB at most).' });
  const name = `${randomUUID().slice(0, 12)}.${type.ext}`;
  await mkdir(config.assetDir, { recursive: true });
  await writeFile(path.join(config.assetDir, name), body);
  sendJson(res, 200, { url: `/house-assets/${name}` });
}

// Optional: a short description of an uploaded picture, so the clone knows what it
// shows. Sends the picture to OpenAI once, only when you ask for it.
async function handleDescribePicture(req, res) {
  const { url } = await readJson(req);
  const name = /^\/house-assets\/([a-z0-9-]{6,40}\.(jpg|png|webp))$/.exec(url ?? '')?.[1];
  if (!name) return sendJson(res, 400, { error: 'Unknown picture.' });
  if (!process.env.OPENAI_API_KEY) return sendJson(res, 400, { error: 'Describing pictures needs OPENAI_API_KEY in .env. Type a short description instead.' });
  const bytes = await readFile(path.join(config.assetDir, name));
  const mime = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[name.split('.').pop()];
  try {
    const r = await openai().responses.create({
      model: 'gpt-5.4-mini',
      reasoning: { effort: 'low' },
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: 'Describe this picture in one short phrase (under 12 words) for someone who can\'t see it, like "a sunset over a beach with palm trees". Only the phrase.' },
          { type: 'input_image', image_url: `data:${mime};base64,${bytes.toString('base64')}` },
        ],
      }],
    });
    await memory.recordUsage('memory', openaiUsage(r.usage));
    sendJson(res, 200, { description: r.output_text.trim().replace(/^"|"\.?$|\.$/g, '').slice(0, 80) });
  } catch (err) {
    sendJson(res, 502, { error: describeError(err) });
  }
}

async function handleSaveHouse(req, res) {
  const house = cleanHouse(await readJson(req));
  await saveJson(config.houseFile, house);
  sendJson(res, 200, { house });
}

// ---- Mind page: the persona notes, rules and memory, edited from the browser ----

const NOTE_NAME = /^[A-Za-z0-9][\w .-]{0,60}\.md$/;

async function handleMind(res) {
  const names = (await readdir(config.personaDir).catch(() => [])).filter((f) => f.endsWith('.md')).sort();
  const persona = await Promise.all(names.map(async (name) => ({ name, text: await readFile(path.join(config.personaDir, name), 'utf8') })));
  sendJson(res, 200, {
    name: config.name,
    persona,
    rules: await readFile(config.rulesFile, 'utf8').catch(() => ''),
    memories: memory.list(),
    mood: mood.snapshot(),
    conversation: memory.messages().length,
    schedule: await loadSchedule(),
  });
}

// ---- Building the persona from everything about the person -------------------------
// Sources (chats, their writing, their answers, what others say about them) are kept in
// sources/: index.json lists them, <id>.txt holds each one as given, and
// analysis.json holds the last analysis (the drafted notes) and accuracy tests.

const SOURCE_LIMIT = 20_000_000;
let build = null; // the analysis or accuracy test running now: { kind, step, done, total, error }

const sourcesIndexFile = () => path.join(config.sourcesDir, 'index.json');
const analysisFile = () => path.join(config.sourcesDir, 'analysis.json');
async function loadSources() {
  return loadJson(sourcesIndexFile(), { consent: null, sources: [] }).catch(() => ({ consent: null, sources: [] }));
}
async function saveSources(index) {
  await mkdir(config.sourcesDir, { recursive: true });
  await saveJson(sourcesIndexFile(), index);
}
async function loadAnalysis() {
  return loadJson(analysisFile(), null).catch(() => null);
}
async function readSource(meta) {
  const raw = await readFile(path.join(config.sourcesDir, `${meta.id}.txt`), 'utf8');
  return { ...meta, parsed: parseSource(raw, meta.name) };
}

async function sourcesState() {
  const index = await loadSources();
  const analysis = await loadAnalysis();
  return {
    name: config.name,
    kinds: KINDS,
    consent: index.consent,
    sources: index.sources,
    build,
    analysis: analysis && { builtAt: analysis.builtAt, appliedAt: analysis.appliedAt ?? null, stats: analysis.stats, drafts: analysis.drafts, gaps: analysis.gaps, counts: analysis.counts, held: analysis.test?.length ?? 0 },
    tests: analysis?.tests ?? [],
  };
}

async function handleSourcesAction(req, res) {
  const body = await readJson(req, SOURCE_LIMIT + 100_000);
  const index = await loadSources();
  const busy = () => build && !build.finished;
  switch (body.action) {
    case 'consent':
      index.consent = body.agreed ? { agreed: true, at: new Date().toISOString() } : null;
      await saveSources(index);
      break;
    case 'add': {
      if (!index.consent?.agreed) return sendJson(res, 403, { error: `First confirm that ${config.name} agreed to this.` });
      const text = String(body.text ?? '');
      if (!text.trim()) return sendJson(res, 400, { error: 'That source is empty.' });
      const name = String(body.name ?? 'Pasted text').replace(/[\r\n]/g, ' ').trim().slice(0, 120) || 'Pasted text';
      const parsed = parseSource(text, name);
      const id = randomUUID().replace(/-/g, '').slice(0, 12);
      await mkdir(config.sourcesDir, { recursive: true });
      await writeFile(path.join(config.sourcesDir, `${id}.txt`), text);
      const people = parsed.format === 'chat' ? speakers(parsed.messages) : [];
      // In a chat, guess the person: the speaker whose name matches the clone's, if any.
      const first = config.name.toLowerCase().split(/\s+/)[0];
      const guess = people.find((p) => p.name.toLowerCase().split(/\s+/).includes(first) || p.name.toLowerCase().startsWith(first))?.name ?? null;
      index.sources.push({
        id,
        name,
        kind: parsed.format === 'chat' ? 'chat' : KINDS[body.kind] && body.kind !== 'chat' ? body.kind : 'writing',
        format: parsed.format,
        speakers: people.slice(0, 30),
        speaker: guess,
        words: parsed.format === 'chat' ? parsed.messages.reduce((n, m) => n + wordCount(m.text), 0) : wordCount(parsed.text),
        messages: parsed.format === 'chat' ? parsed.messages.length : 0,
        addedAt: new Date().toISOString(),
      });
      await saveSources(index);
      break;
    }
    case 'update': {
      const source = index.sources.find((s) => s.id === body.id);
      if (!source) return sendJson(res, 404, { error: 'No such source.' });
      if (source.format === 'chat' && body.speaker !== undefined) source.speaker = source.speakers.some((p) => p.name === body.speaker) ? body.speaker : null;
      if (source.format !== 'chat' && KINDS[body.kind] && body.kind !== 'chat') source.kind = body.kind;
      await saveSources(index);
      break;
    }
    case 'remove':
      index.sources = index.sources.filter((s) => s.id !== body.id);
      if (/^[a-f0-9]{12}$/.test(body.id)) await rm(path.join(config.sourcesDir, `${body.id}.txt`), { force: true });
      await saveSources(index);
      break;
    case 'analyze':
      if (busy()) return sendJson(res, 409, { error: 'Already working on it.' });
      if (!index.consent?.agreed) return sendJson(res, 403, { error: `First confirm that ${config.name} agreed to this.` });
      if (!hasBrainKey()) return sendJson(res, 400, { error: 'The clone needs a working brain (an API key or the ChatGPT sign-in) to analyze.' });
      if (!index.sources.length) return sendJson(res, 400, { error: 'Add something about them first.' });
      if (index.sources.some((s) => s.format === 'chat' && !s.speaker)) return sendJson(res, 400, { error: `In each chat, pick which speaker is ${config.name}.` });
      runBuild('analyze', () => analyzeSources(index));
      break;
    case 'apply':
      if (busy()) return sendJson(res, 409, { error: 'Wait until it finishes.' });
      await applyDrafts(body.drafts);
      break;
    case 'test':
      if (busy()) return sendJson(res, 409, { error: 'Already working on it.' });
      if (!hasBrainKey()) return sendJson(res, 400, { error: 'The clone needs a working brain to test.' });
      runBuild('test', testAccuracy);
      break;
    default:
      return sendJson(res, 400, { error: 'Unknown action.' });
  }
  sendJson(res, 200, await sourcesState());
}

// Runs an analysis or test in the background; the page follows `build` for progress.
function runBuild(kind, work) {
  build = { kind, step: 'Starting', done: 0, total: 0, error: null, finished: false, startedAt: Date.now() };
  const job = build;
  work(job)
    .catch((err) => {
      console.error(`[build] ${kind}`, err);
      job.error = describeError(err);
    })
    .finally(() => (job.finished = true));
}

// A few requests at a time, so a long analysis doesn't take forever or flood the API.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

async function analyzeSources(index, job = build) {
  const sources = await Promise.all(index.sources.map(readSource));
  const name = config.name;

  // 1. Counted, not guessed: how they text, and real exchanges.
  job.step = 'Measuring how they text';
  const chats = sources.filter((s) => s.parsed.format === 'chat');
  const mine = chats.flatMap((s) => s.parsed.messages.filter((m) => m.speaker === s.speaker).map((m) => m.text));
  const stats = measureStyle(mine);
  const picked = pickExchanges(chats.flatMap((s) => exchanges(s.parsed.messages, s.speaker)));

  // 2. The AI reads everything, piece by piece, and pulls out what it shows about them.
  const pieces = chunks(sources);
  job.step = 'Reading everything';
  job.total = pieces.length;
  const reader =
    `You are helping build an accurate picture of one real person, ${name}, from material they agreed to share. ` +
    'Read the piece you are given and list what it shows about them: facts, routines, goals, how they talk (real phrases, slang, ' +
    'typing habits), temperament (what annoys them, how they react, how they joke), opinions, likes, dislikes, people in their life ' +
    "(name, who they are to them, how they feel about them) and stories. Only what the piece really shows: no guesses, no generic traits. " +
    "Write each finding as a short, specific sentence about them. Add a short exact quote that shows it when there is one, else an empty quote. " +
    'In chats, only the lines marked ME are theirs; use the other lines just as context.';
  const findings = (
    await mapLimit(pieces, 3, async (piece) => {
      try {
        const { data, usage } = await completeJson(reader, `${piece.label}\nFrom: ${piece.source}\n\n${piece.text}`, FINDINGS_SCHEMA);
        await memory.recordUsage('persona', usage);
        return (data.findings ?? []).map((f) => ({ ...f, kind: piece.kind }));
      } catch (err) {
        console.error('[build] piece', describeError(err));
        return [];
      } finally {
        job.done++;
      }
    })
  ).flat();
  if (!findings.length) throw new Error("Couldn't get anything out of the sources. Check the clone's brain works, then try again.");

  // 3. The notes, written from the findings, one per topic.
  job.step = 'Writing the notes';
  job.done = 0;
  job.total = NOTE_PLAN.length;
  const writer =
    `You write one persona note for a digital clone of ${name}, a real person, from findings about them. The clone reads it as its own notes. ` +
    "Write in the first person, as them (\"I'm 17\", not \"they're 17\"). Be specific and concrete: real names, real phrases in quotes, real opinions, " +
    'real habits. One fact or habit per line, as short lines or bullets under a few headings. Use only what the findings support; never invent. ' +
    "When findings disagree, prefer the person's own words over second-hand ones, and mention real inconsistency briefly. Leave out anything trivial or repeated. " +
    'Start with a "# " heading. Then list in `missing` up to 6 short questions you would ask them to fill the biggest gaps for this topic.';
  const notes = await mapLimit(NOTE_PLAN, 2, async (plan) => {
    const lines = findingsFor(findings, plan.categories);
    try {
      if (!lines.length) return { plan, text: `# ${plan.title}\n\n(Nothing in the sources about this yet.)`, missing: [`Tell me about: ${plan.covers}.`] };
      const extra = plan.file === '02-how-i-talk.md' && stats
        ? `\n\nMeasured from their real messages (for your understanding; the exact numbers are added under the note automatically, so describe the style in words and don't repeat the numbers):\n${describeStyle(stats)}`
        : '';
      const { data, usage } = await completeJson(writer, `Note: ${plan.file} (${plan.title}). It covers ${plan.covers}.\n\nFindings:\n${lines.join('\n')}${extra}`, NOTE_SCHEMA);
      await memory.recordUsage('persona', usage);
      return { plan, text: String(data.text ?? '').trim(), missing: data.missing ?? [] };
    } finally {
      job.done++;
    }
  });

  const drafts = notes.map(({ plan, text }) => ({
    file: plan.file,
    text: plan.file === '02-how-i-talk.md' && stats ? `${text}\n\n## Measured from my messages\n\n${describeStyle(stats)}\n` : `${text}\n`,
  }));
  if (picked.examples.length) drafts.push({ file: '05-real-examples.md', text: `${examplesNote(picked.examples)}\n` });
  const gaps = [...new Set(notes.flatMap((n) => n.missing.map((q) => String(q).trim()).filter(Boolean)))].slice(0, 18);

  const old = await loadAnalysis();
  await mkdir(config.sourcesDir, { recursive: true });
  await saveJson(analysisFile(), {
    builtAt: new Date().toISOString(),
    stats,
    drafts,
    gaps,
    test: picked.test, // real exchanges kept out of the notes, for the accuracy test
    counts: { sources: sources.length, pieces: pieces.length, findings: findings.length, myMessages: mine.length, examples: picked.examples.length },
    tests: old?.tests ?? [],
  });
  job.step = 'Done';
}

// Uses the (possibly edited) drafts as the persona notes. The old notes are copied to
// persona-backups/<date and time>/ first, so nothing is lost.
async function applyDrafts(edited) {
  const analysis = await loadAnalysis();
  if (!analysis) throw Object.assign(new Error('Analyze first.'), { status: 400 });
  const drafts = Array.isArray(edited) && edited.length ? edited : analysis.drafts;
  const allowed = new Set(analysis.drafts.map((d) => d.file));
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  const existing = (await readdir(config.personaDir).catch(() => [])).filter((f) => f.endsWith('.md') && f !== 'README.md');
  if (existing.length) {
    const backup = path.join(config.personaBackupsDir, stamp);
    await mkdir(backup, { recursive: true });
    for (const f of existing) await writeFile(path.join(backup, f), await readFile(path.join(config.personaDir, f)));
  }
  await mkdir(config.personaDir, { recursive: true });
  for (const d of drafts) {
    if (!allowed.has(d.file)) continue;
    await writeText(path.join(config.personaDir, d.file), String(d.text ?? '').slice(0, 100_000));
  }
  analysis.drafts = analysis.drafts.map((d) => drafts.find((e) => e.file === d.file) ?? d);
  analysis.appliedAt = new Date().toISOString();
  analysis.backup = existing.length ? stamp : null;
  await saveJson(analysisFile(), analysis);
}

// Accuracy: the clone answers real messages it has never seen (held out from the
// notes), and its replies are scored against what the person really said.
async function testAccuracy(job = build) {
  const name = config.name;
  const analysis = await loadAnalysis();
  const held = analysis?.test ?? [];
  if (!held.length) throw new Error('No held-out chat messages to test with. Add chats with them in it, then analyze.');
  const system = await buildSystemPrompt();
  job.step = 'The clone is answering real messages';
  job.total = held.length;
  const REPLY = { type: 'object', additionalProperties: false, required: ['reply'], properties: { reply: { type: 'string' } } };
  const replies = await mapLimit(held, 3, async (e) => {
    try {
      const { data, usage } = await completeJson(
        system,
        `This is a text chat, not a spoken one. Someone you know just texted you:\n"${e.they}"\n\n` +
          'Write exactly what you would text back, in your own style. If you would send several short messages, separate them with " / ". No mood tag, nothing else.',
        REPLY,
      );
      await memory.recordUsage('persona', usage);
      return splitMoodTag(String(data.reply ?? '').trim()).text;
    } catch (err) {
      console.error('[build] test reply', describeError(err));
      return '';
    } finally {
      job.done++;
    }
  });
  job.step = 'Scoring';
  const items = held.map((e, i) => ({ they: e.they, real: e.me, clone: replies[i] }));
  const judge =
    `You judge how well a digital clone of ${name} imitates them. For each item you get what someone texted, what ${name} really replied, ` +
    "and what the clone replied. Score style 1-10 (would a close friend believe the clone's reply came from them: length, wording, slang, " +
    'capitals, punctuation, tone) and substance 1-10 (same attitude, answer and facts; a different but equally plausible answer can still score well). ' +
    'Add a short note on what is off. Then a summary: the biggest consistent differences, and what information about them seems to be missing.';
  const { data, usage } = await completeJson(judge, items.map((it, i) => `Item ${i}\nThey: ${it.they}\nReal: ${it.real}\nClone: ${it.clone || '(no reply)'}`).join('\n\n'), SCORE_SCHEMA);
  await memory.recordUsage('persona', usage);
  const scored = items.map((it, i) => {
    const s = (data.scores ?? []).find((x) => x.index === i) ?? { style: 0, substance: 0, note: '' };
    const clamp = (n) => Math.max(0, Math.min(10, Math.round(Number(n) || 0)));
    return { ...it, style: clamp(s.style), substance: clamp(s.substance), note: String(s.note ?? '') };
  });
  const avg = (k) => Math.round((10 * scored.reduce((n, s) => n + s[k], 0)) / scored.length) / 10;
  const result = { at: new Date().toISOString(), style: avg('style'), substance: avg('substance'), summary: String(data.summary ?? ''), items: scored };
  const latest = await loadAnalysis();
  latest.tests = [result, ...(latest.tests ?? [])].slice(0, 6);
  await saveJson(analysisFile(), latest);
  job.step = 'Done';
}

// Writes a text file safely: to a temporary file first, then renamed into place.
async function writeText(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}

async function handleMindChange(req, res) {
  const { action, ...body } = await readJson(req);
  const text = typeof body.text === 'string' ? body.text.slice(0, 100_000) : '';
  const note = () => {
    if (!NOTE_NAME.test(body.name ?? '')) throw Object.assign(new Error('Note names are letters, numbers, spaces, - or _, ending in .md (like 05-music.md).'), { status: 400 });
    return path.join(config.personaDir, body.name);
  };
  try {
    if (action === 'savePersona') await writeText(note(), text);
    else if (action === 'deletePersona') await unlink(note());
    else if (action === 'saveRules') await writeText(config.rulesFile, text);
    else if (action === 'addMemory') await memory.addMemory(body);
    else if (action === 'updateMemory') await memory.updateMemory(body.id, body);
    else if (action === 'deleteMemory') await memory.removeMemory(body.id);
    else if (action === 'forgetAll') await memory.forgetAll();
    else if (action === 'resetMood') await mood.reset();
    else if (action === 'saveSchedule') await saveJson(config.scheduleFile, { ...cleanSchedule(body.schedule), sleepAdded: true });
    else if (action === 'clearConversation') await memory.clearConversation();
    else return sendJson(res, 400, { error: 'Unknown change.' });
  } catch (err) {
    return sendJson(res, err.status ?? 400, { error: err.message });
  }
  return handleMind(res);
}

async function handleImport(req, res) {
  const { messages } = await readJson(req);
  sendJson(res, 200, { messages: await memory.importConversation(messages) });
}

// ---- ElevenLabs ------------------------------------------------------------------
// The models people pick from in the Voice panel, until the account's own list (from
// ElevenLabs) comes in. A saved model that isn't here is kept and shown too.
const ELEVEN_MODELS = [
  ['eleven_flash_v2_5', 'Flash v2.5: fastest and cheapest'],
  ['eleven_turbo_v2_5', 'Turbo v2.5: fast, a bit richer'],
  ['eleven_multilingual_v2', 'Multilingual v2: most natural, slower'],
  ['eleven_v3', 'v3: most expressive, slowest'],
];
const ELEVEN_ID = /^[\w-]{1,200}$/; // keys, voice and model IDs: letters, digits, _ and -
const ELEVEN_MODEL = /^eleven_[\w-]{1,80}$/;

async function elevenLabsSpeech(text, { key = config.elevenKey, voice = config.elevenVoice, model = config.elevenModel } = {}) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: model }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw elevenError(response.status, await response.text());
  return { audio: Buffer.from(await response.arrayBuffer()), type: 'audio/mpeg' };
}

// What went wrong, in words someone can act on.
function elevenError(status, body = '') {
  let detail = '';
  try {
    const parsed = JSON.parse(body).detail;
    detail = typeof parsed === 'string' ? parsed : parsed?.message ?? '';
  } catch {
    detail = body.slice(0, 200);
  }
  const why = {
    401: "ElevenLabs didn't accept the key. Check you copied all of it, and that it's allowed to read voices and use text to speech.",
    402: 'The ElevenLabs account is out of credits, or this voice or model needs a paid plan.',
    404: "ElevenLabs couldn't find that voice. Pick one from the list again.",
    429: 'ElevenLabs says too many requests or out of credits. Wait a minute, or check the account.',
  }[status];
  const err = new Error(why ?? `ElevenLabs answered ${status}${detail ? `: ${detail}` : ''}`);
  err.status = status === 401 ? 400 : 502;
  return err;
}

// The key to use: the one just pasted in the panel, or the saved one.
function elevenKeyFrom(body) {
  const key = String(body.key ?? '').trim() || config.elevenKey;
  if (!key) throw Object.assign(new Error('Paste your ElevenLabs API key first.'), { status: 400 });
  if (!ELEVEN_ID.test(key)) throw Object.assign(new Error("That doesn't look like an ElevenLabs API key."), { status: 400 });
  return key;
}

// The main voice's language and the extra voices: { mainLanguage, languages: [{ lang, voiceId, voiceName, model }] }.
let voiceLanguages = cleanVoiceLanguages(await loadJson(config.voicesFile, {}).catch(() => ({})));
function cleanVoiceLanguages(input) {
  const seen = new Set();
  const languages = (Array.isArray(input?.languages) ? input.languages : [])
    .filter((v) => LANGUAGE_CODES.has(v?.lang) && ELEVEN_ID.test(v?.voiceId ?? '') && !seen.has(v.lang) && seen.add(v.lang))
    .map((v) => ({ lang: v.lang, voiceId: v.voiceId, voiceName: String(v.voiceName ?? '').slice(0, 80), model: ELEVEN_MODEL.test(v.model ?? '') ? v.model : '' }));
  return { mainLanguage: LANGUAGE_CODES.has(input?.mainLanguage) ? input.mainLanguage : 'en', languages };
}

// Which voice says this sentence: the one for its language, or the main voice.
function voiceFor(text) {
  const { mainLanguage, languages } = voiceLanguages;
  const extra = languages.filter((v) => v.lang !== mainLanguage);
  if (!extra.length) return {};
  const lang = detectLanguage(text, [mainLanguage, ...extra.map((v) => v.lang)]);
  const match = extra.find((v) => v.lang === lang);
  return match ? { voice: match.voiceId, model: match.model || config.elevenModel } : {};
}

function voiceState() {
  return {
    mainLanguage: voiceLanguages.mainLanguage,
    languages: voiceLanguages.languages,
    languageList: LANGUAGES.map(({ code, name }) => [code, name]),
    using: voiceMode(),
    elevenReady: elevenReady(), // a voice is set up, so switching to it is one click
    hasKey: Boolean(config.elevenKey), // the key itself never goes to the page
    voiceId: config.elevenVoice,
    voiceName: config.elevenVoiceName,
    model: config.elevenModel,
    models: ELEVEN_MODELS.some(([id]) => id === config.elevenModel) ? ELEVEN_MODELS : [[config.elevenModel, config.elevenModel], ...ELEVEN_MODELS],
    macWorks: process.platform === 'darwin',
  };
}

// The voices on the account (yours first, then ElevenLabs' own), with free previews.
async function handleVoiceList(req, res) {
  const key = elevenKeyFrom(await readJson(req));
  const get = (what) => fetch(`https://api.elevenlabs.io/v1/${what}`, { headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(15_000) });
  const [response, modelResponse] = await Promise.all([get('voices'), get('models').catch(() => null)]);
  if (!response.ok) throw elevenError(response.status, await response.text());
  const { voices = [] } = await response.json();
  // The text-to-speech models this account can use (a key without that permission
  // just keeps the built-in list).
  const known = Object.fromEntries(ELEVEN_MODELS);
  const models = modelResponse?.ok
    ? (await modelResponse.json()).filter((m) => m.can_do_text_to_speech && ELEVEN_MODEL.test(m.model_id)).map((m) => [m.model_id, known[m.model_id] ?? m.name ?? m.model_id])
    : [];
  const yours = (v) => (['cloned', 'professional', 'generated'].includes(v.category) ? 0 : 1);
  const list = voices
    .map((v) => ({
      id: v.voice_id,
      name: v.name,
      mine: yours(v) === 0,
      kind: { cloned: 'your clone', professional: 'your clone (pro)', generated: 'made by you', premade: 'ElevenLabs' }[v.category] ?? v.category ?? '',
      about: [v.labels?.gender, v.labels?.age, v.labels?.accent].filter(Boolean).join(', '),
      preview: /^https:\/\//.test(v.preview_url ?? '') ? v.preview_url : null,
    }))
    .sort((a, b) => Number(!a.mine) - Number(!b.mine) || a.name.localeCompare(b.name));
  sendJson(res, 200, { voices: list, models });
}

// One line in the chosen voice, before saving (uses a few ElevenLabs credits).
async function handleVoiceTry(req, res) {
  const body = await readJson(req);
  const key = elevenKeyFrom(body);
  const voice = String(body.voiceId ?? '');
  const model = ELEVEN_MODEL.test(body.model ?? '') ? body.model : config.elevenModel;
  if (!ELEVEN_ID.test(voice)) return sendJson(res, 400, { error: 'Pick a voice first.' });
  const sample = (LANGUAGES.find((l) => l.code === body.lang) ?? LANGUAGES[0]).sample.replace('{name}', config.name);
  const text = String(body.text ?? '').trim().slice(0, 200) || sample;
  const { audio, type } = await elevenLabsSpeech(text, { key, voice, model });
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(audio);
}

// Save the voice to .env and start using it right away. { use: 'mac' } switches
// back to the Mac voice (the key stays saved, so switching back is one click).
async function handleVoiceSave(req, res) {
  const body = await readJson(req);
  if (['addLanguage', 'removeLanguage', 'mainLanguage'].includes(body.action)) return handleVoiceLanguage(body, res);
  // Off, the Mac voice, or back to the ElevenLabs voice that's set up. The ElevenLabs
  // settings stay saved either way, so switching back is one click.
  if (['none', 'mac', 'elevenlabs'].includes(body.use)) {
    if (body.use === 'mac' && process.platform !== 'darwin') return sendJson(res, 400, { error: "The built-in voice only works on a Mac." });
    if (body.use === 'elevenlabs' && !elevenReady()) return sendJson(res, 400, { error: 'Set up an ElevenLabs voice first.' });
    config.voice = body.use;
    updateEnvFile(ENV_FILE, { VOICE: body.use }, { fallback: path.join(ROOT, '.env.example') });
    return sendJson(res, 200, voiceState());
  }
  const key = elevenKeyFrom(body);
  const voice = String(body.voiceId ?? '');
  if (!ELEVEN_ID.test(voice)) return sendJson(res, 400, { error: 'Pick a voice first.' });
  const model = ELEVEN_MODEL.test(body.model ?? '') ? body.model : config.elevenModel;
  const name = String(body.voiceName ?? '').replace(/[\r\n#=]/g, ' ').trim().slice(0, 80);
  updateEnvFile(ENV_FILE, { VOICE: 'elevenlabs', ELEVENLABS_API_KEY: key, ELEVENLABS_VOICE_ID: voice, ELEVENLABS_VOICE_NAME: name, ELEVENLABS_MODEL: model }, { fallback: path.join(ROOT, '.env.example') });
  Object.assign(config, { voice: 'elevenlabs', elevenKey: key, elevenVoice: voice, elevenVoiceName: name, elevenModel: model });
  sendJson(res, 200, voiceState());
}

// Extra voices for other languages: each sentence in that language is said in its voice.
async function handleVoiceLanguage(body, res) {
  const next = structuredClone(voiceLanguages);
  if (!LANGUAGE_CODES.has(body.lang)) return sendJson(res, 400, { error: 'Pick a language.' });
  if (body.action === 'mainLanguage') next.mainLanguage = body.lang;
  else if (body.action === 'removeLanguage') next.languages = next.languages.filter((v) => v.lang !== body.lang);
  else {
    const key = elevenKeyFrom(body);
    const voice = String(body.voiceId ?? '');
    if (!ELEVEN_ID.test(voice)) return sendJson(res, 400, { error: 'Pick a voice first.' });
    if (!config.elevenVoice) return sendJson(res, 400, { error: 'Save a main voice first, then add voices for other languages.' });
    if (key !== config.elevenKey) {
      updateEnvFile(ENV_FILE, { ELEVENLABS_API_KEY: key }, { fallback: path.join(ROOT, '.env.example') });
      config.elevenKey = key;
    }
    const entry = { lang: body.lang, voiceId: voice, voiceName: String(body.voiceName ?? '').trim().slice(0, 80), model: ELEVEN_MODEL.test(body.model ?? '') ? body.model : config.elevenModel };
    next.languages = [...next.languages.filter((v) => v.lang !== body.lang), entry];
  }
  voiceLanguages = cleanVoiceLanguages(next);
  await saveJson(config.voicesFile, voiceLanguages);
  sendJson(res, 200, voiceState());
}

async function handleVoiceRoute(req, res, handler) {
  try {
    await handler(req, res);
  } catch (err) {
    if (err.name === 'TimeoutError') return sendJson(res, 504, { error: "ElevenLabs didn't answer in time. Check the internet connection." });
    sendJson(res, err.status ?? 500, { error: err.message });
  }
}

// The text goes through a file, never the command line, so it can't be read as options.
async function macSpeech(text) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clone-say-'));
  try {
    await writeFile(path.join(dir, 'in.txt'), text);
    const args = ['-f', 'in.txt', '-o', 'out.wav', '--file-format=WAVE', '--data-format=LEI16@22050'];
    if (config.macVoice) args.unshift('-v', config.macVoice);
    await execFileAsync('say', args, { cwd: dir });
    return { audio: await readFile(path.join(dir, 'out.wav')), type: 'audio/wav' };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function handleTts(req, res) {
  const { text } = await readJson(req);
  const clean = String(text ?? '').trim().slice(0, 1500);
  if (!clean) return sendJson(res, 400, { error: 'No text to speak.' });
  try {
    const mode = voiceMode();
    if (mode === 'none') return sendJson(res, 409, { error: 'The voice is off.' });
    const { audio, type } = mode === 'elevenlabs' ? await elevenLabsSpeech(clean, voiceFor(clean)) : await macSpeech(clean);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(audio);
  } catch (err) {
    console.error('[tts]', err);
    sendJson(res, 502, { error: err.message });
  }
}

async function handleConfig(res) {
  const localAvatar = (await readdir(AVATAR_DIR).catch(() => [])).filter((f) => /\.(vrm|glb)$/i.test(f)).sort()[0];
  sendJson(res, 200, {
    name: config.name,
    brain: hasBrainKey() ? config.brain : 'demo',
    model: brainModel,
    fallbackModel: backupModel?.name ?? null,
    voice: voiceMode(),
    updated: codeChanged(), // the files changed since it started: it needs a restart
    voiceName: useElevenLabs() ? config.elevenVoiceName || null : null,
    avatarUrl: localAvatar ? `/avatar/${encodeURIComponent(localAvatar)}` : SAMPLE_AVATAR,
    sampleAvatar: !localAvatar,
    usage: memory.usageSummary(),
    mood: mood.snapshot(),
    house: await loadHouse(),
  });
}

function hasBrainKey() {
  // Without the ChatGPT sign-in, the backup model (API) can still answer.
  if (config.brain === 'chatgpt') return Boolean(codexStatus?.signedIn || backupModel);
  if (config.brain === 'openai') return Boolean(process.env.OPENAI_API_KEY);
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.vrm': 'model/gltf-binary',
  '.glb': 'model/gltf-binary',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

async function serveFile(res, baseDir, urlPath) {
  const filePath = path.resolve(baseDir, '.' + decodeURIComponent(urlPath));
  if (!filePath.startsWith(baseDir + path.sep)) return sendJson(res, 403, { error: 'Forbidden' });
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req, limit = 1_000_000) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw Object.assign(new Error('Too large: the limit is about 20 MB per file.'), { status: 413 });
  }
  return raw ? JSON.parse(raw) : {};
}

// Only pages served from this Mac may use the server. The Host check stops other
// websites reaching it through tricks like DNS rebinding; the Origin check stops
// them sending changes (a chat, a memory edit) from your browser.
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
function fromThisMac(req) {
  if (!LOCAL.test(req.headers.host ?? '')) return false;
  const origin = req.headers.origin;
  return !origin || origin === 'null' ? req.method === 'GET' || !origin : LOCAL.test(origin.replace(/^https?:\/\//, ''));
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (!fromThisMac(req)) return sendJson(res, 403, { error: 'Only pages on this computer can use the clone.' });
  try {
    if (req.method === 'POST' && pathname === '/api/chat') return await handleChat(req, res);
    if (req.method === 'POST' && pathname === '/api/tts') return await handleTts(req, res);
    if (req.method === 'GET' && pathname === '/api/conversation') return await handleConversation(res);
    if (req.method === 'POST' && pathname === '/api/new-chat') return await handleNewChat(res);
    if (req.method === 'POST' && pathname === '/api/opener') return await handleOpener(res);
    if (req.method === 'POST' && pathname === '/api/house') return await handleSaveHouse(req, res);
    if (req.method === 'POST' && pathname === '/api/house-asset') return await handleUploadAsset(req, res);
    if (req.method === 'POST' && pathname === '/api/describe-picture') return await handleDescribePicture(req, res);
    if (req.method === 'POST' && pathname === '/api/house-react') return await handleHouseReact(res);
    if (req.method === 'POST' && pathname === '/api/interject') return await handleInterject(req, res);
    if (req.method === 'POST' && pathname === '/api/interject/accept') return await handleInterjectAccept(req, res);
    if (req.method === 'GET' && pathname.startsWith('/house-assets/')) {
      return await serveFile(res, config.assetDir, pathname.slice('/house-assets'.length));
    }
    if (req.method === 'POST' && pathname === '/api/tick') return await handleTick(res);
    if (req.method === 'GET' && pathname === '/api/mind') return await handleMind(res);
    if (req.method === 'POST' && pathname === '/api/mind') return await handleMindChange(req, res);
    if (req.method === 'POST' && pathname === '/api/import') return await handleImport(req, res);
    if (req.method === 'GET' && pathname === '/api/config') return await handleConfig(res);
    if (req.method === 'GET' && pathname === '/api/voice') return sendJson(res, 200, voiceState());
    if (req.method === 'GET' && pathname === '/api/sources') return sendJson(res, 200, await sourcesState());
    if (req.method === 'POST' && pathname === '/api/sources') return await handleSourcesAction(req, res);
    if (req.method === 'POST' && pathname === '/api/voice/voices') return await handleVoiceRoute(req, res, handleVoiceList);
    if (req.method === 'POST' && pathname === '/api/voice/try') return await handleVoiceRoute(req, res, handleVoiceTry);
    if (req.method === 'POST' && pathname === '/api/voice') return await handleVoiceRoute(req, res, handleVoiceSave);
    if (req.method === 'GET' && pathname.startsWith('/avatar/')) {
      return await serveFile(res, AVATAR_DIR, pathname.slice('/avatar'.length));
    }
    if (req.method === 'GET') return await serveFile(res, PUBLIC_DIR, pathname === '/' ? '/index.html' : pathname === '/mind' ? '/mind.html' : pathname);
    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) sendJson(res, err.status ?? 500, { error: err.message });
    else res.end();
  }
});

const memory = createMemory({
  dir: config.memoryDir,
  name: config.name,
  completeJson,
  embed,
  onError: (err) => console.error('[memory]', describeError(err)),
});
await memory.load();
const mood = createMood({ file: path.join(config.memoryDir, 'mood.json') });
await mood.load();

// Localhost only: nobody else on the network can use your API keys through this server.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use. The clone may already be running: open http://localhost:${config.port}`);
    console.error('Or set PORT in .env to another number (like 4848) and start again.');
    process.exit(1);
  }
  throw err;
});
server.listen(config.port, '127.0.0.1', () => {
  console.log(`Digital clone running at http://localhost:${config.port}`);
  if (config.brain === 'chatgpt') {
    if (codexStatus.signedIn) console.log(`Brain: ${brainModel} through Codex, on your ChatGPT plan`);
    else console.log(`Brain: ChatGPT sign-in isn't ready (${codexStatus.detail}; run: codex login). ${backupModel ? `${backupModel.name} answers meanwhile.` : 'Demo replies until then.'}`);
  } else console.log(`Brain: ${hasBrainKey() ? brainModel : `demo replies (no ${brainLabel} API key)`}`);
  console.log(`Backup: ${backupModel ? `${backupModel.name} (if ${brainModel} fails or is silent for ${config.fallbackAfterMs / 1000} s)` : 'off'}`);
  console.log(`Voice: ${{ elevenlabs: `ElevenLabs${config.elevenVoiceName ? ` (${config.elevenVoiceName})` : ''}`, mac: 'Mac say', none: 'off (text only)' }[voiceMode()]}`);
});
