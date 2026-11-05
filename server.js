// Digital twin server: serves the web app, streams replies built from the persona
// notes (Claude or GPT), and turns reply text into speech (ElevenLabs or the Mac's `say`).
import http from 'node:http';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createMemory, formatTime, loadJson, saveJson } from './memory.js';
import { createCodex } from './codex.js';
import { FEELINGS, createMood, createTagReader, moodTag, splitMoodTag } from './mood.js';
import { cleanHouse } from './public/house-config.js';
import { describeHouse, houseChanges } from './surroundings.js';
import { cleanSchedule, clock, currentActivity, nextActivity, occurrences } from './public/schedule-config.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const AVATAR_DIR = path.join(ROOT, 'avatar');
const SAMPLE_AVATAR =
  'https://cdn.jsdelivr.net/gh/pixiv/three-vrm@v3.4.1/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm';

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // No .env yet: run with demo replies and the Mac voice.
}

const config = {
  port: Number(process.env.PORT || 4747),
  name: process.env.TWIN_NAME || 'Twin',
  personaDir: path.resolve(ROOT, process.env.PERSONA_DIR || 'persona'),
  rulesFile: path.resolve(ROOT, process.env.RULES_FILE || 'rules.md'), // another file lets you try rule changes side by side
  memoryDir: path.resolve(ROOT, process.env.MEMORY_DIR || 'memory'),
  houseFile: path.resolve(ROOT, process.env.HOUSE_FILE || 'house.json'), // the House panel's settings
  scheduleFile: path.resolve(ROOT, process.env.SCHEDULE_FILE || 'schedule.json'), // the twin's weekly schedule (private)
  // openai (GPT through the API), claude (Claude through the API), or chatgpt (GPT through
  // Codex, signed in with your ChatGPT account, so it uses your ChatGPT plan; see codex.js).
  brain: ['openai', 'claude', 'chatgpt'].includes(process.env.BRAIN) ? process.env.BRAIN : 'claude',
  model: process.env.CLAUDE_MODEL || 'claude-opus-5-5',
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
  elevenKey: process.env.ELEVENLABS_API_KEY || '',
  elevenVoice: process.env.ELEVENLABS_VOICE_ID || '',
  elevenModel: process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5',
  macVoice: process.env.MAC_VOICE || '',
};
const useElevenLabs = Boolean(config.elevenKey && config.elevenVoice);
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
// smaller memories are marked fuzzy, so the twin half-remembers them.
function memoryBlock(memories) {
  if (!memories.length) return '';
  return `<memories>\n${memories.map((m) => `- ${m.date}${m.fuzzy ? ' (fuzzy)' : ''}: ${m.text}`).join('\n')}\n</memories>`;
}

// The room the twin is standing in (the House panel's settings, in words), and what
// changed since it last spoke. The house as it was then is kept in house-seen.json.
async function surroundingsBlock() {
  const now = currentActivity(await loadSchedule());
  if (now?.activity.where === 'away') {
    return `<surroundings>\nYou're not at home right now: you're out at ${now.activity.name}${now.activity.note ? ` (${now.activity.note})` : ''}. The living room they see on their screen is empty while you're out.\n</surroundings>`;
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

// ---- Schedule: what the twin is doing, and leaving for things -----------------

async function loadSchedule() {
  return cleanSchedule(await loadJson(config.scheduleFile, {}).catch(() => ({})));
}

// What the twin is doing right now and what's next, for the brain. Empty without a schedule.
async function scheduleBlock(when = new Date()) {
  const schedule = await loadSchedule();
  if (!schedule.activities.length) return '';
  const describe = (o) => `${o.activity.name}${o.activity.note ? ` (${o.activity.note})` : ''}`;
  const day = (d) => (d.toDateString() === when.toDateString() ? 'today' : d.toDateString() === new Date(when.getTime() + 86_400_000).toDateString() ? 'tomorrow' : d.toLocaleDateString('en-US', { weekday: 'long' }));
  const now = currentActivity(schedule, when);
  const next = nextActivity(schedule, when);
  const lines = [];
  if (now) {
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

// Called every minute by the open page: what the twin is doing (for the status
// chip and whether it's in the house), and, a few minutes before it goes out for
// something, a line saying it's leaving. Each departure is announced once.
const ANNOUNCE_SCHEMA = { type: 'object', additionalProperties: false, required: ['line'], properties: { line: { type: 'string' } } };
let announcing = false;

async function handleTick(res) {
  const schedule = await loadSchedule();
  const when = new Date();
  const now = currentActivity(schedule, when);
  const status = now
    ? { name: now.activity.name, note: now.activity.note, until: clock(now.end), where: now.activity.where, busy: now.activity.busy }
    : null;
  let line = null;
  const due = occurrences(schedule, when).find(
    (o) => o.activity.where === 'away' && o.activity.notice && o.start > when && o.start - when <= o.activity.notice * 60_000,
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
  sendJson(res, 200, { scheduled: schedule.activities.length > 0, status, line, ...(line && { totals: memory.usageSummary() }) });
}

async function announceLeaving(due, when) {
  const messages = memory.messages();
  const cue = `${due.activity.name} ${due.activity.note}\n${messages.slice(-3).map((m) => m.content).join('\n')}`;
  const [vector, instructions, room, plans] = await Promise.all([memory.cueVector(cue), buildSystemPrompt(), surroundingsBlock(), scheduleBlock(when)]);
  const system = [instructions, memoryBlock(memory.recall(cue, { vector, reinforce: false })), room, plans, `<mood>\n${mood.describe()}\n</mood>`]
    .filter(Boolean)
    .join('\n\n');
  const minutes = Math.max(1, Math.round((due.start - when) / 60_000));
  const prompt =
    `It's ${clock(when)}. You need to head out for ${due.activity.name}${due.activity.note ? ` (${due.activity.note})` : ''} in about ${minutes} ` +
    `minutes (it starts at ${clock(due.start)}). Tell them you're about to leave, the way you'd tell a friend: one short line in your ` +
    'usual voice, with no mood tag. If you were in the middle of something with them, you can wrap it up.';
  const { data, usage } = await completeJson(system, prompt, ANNOUNCE_SCHEMA);
  await memory.recordUsage('chat', usage);
  const line = splitMoodTag(String(data.line ?? '').trim()).text;
  if (!line) return null;
  await memory.addMessage({ role: 'assistant', content: line, at: Date.now(), mood: mood.current() });
  return line;
}

// How the twin feels right now, and how to report a change. The tag format lives
// here, next to the code that reads it (mood.js).
function moodBlock() {
  return (
    `<mood>\n${mood.describe()}\n</mood>\n\n` +
    'Start every reply with a hidden tag saying how you feel after their latest message: the feeling, one ' +
    'number for how strongly, and a few words on why, like [mood: calm 1 | nothing much happened]. ' +
    `The feeling is one of: ${FEELINGS.join(', ')}. The number goes from 0 (barely) to 10 (as strong as it gets). ` +
    "The tag is removed before they see or hear anything, so never mention it. After the tag, reply as usual."
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
      const label = m.role === 'user' ? timeLabel(at, list[i - 1]?.at) : m.mood ? `${moodTag(m.mood)} ` : '';
      return { role: m.role, content: label + m.content.slice(0, 4000), at };
    })
    .slice(-100);
  // The twin may have spoken first (see handleOpener), so a conversation can open with
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
// break, how long they were away. The twin uses it to tell a late night from a
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
  const { text } = await readJson(req);
  const message = String(text ?? '').trim().slice(0, 4000);
  if (!message) return sendJson(res, 400, { error: 'No message to answer.' });

  // Talking over the twin stops its reply. Wait for that reply to be saved first,
  // so the conversation stays in the order things were said.
  if (inFlight) {
    inFlight.abort.abort();
    await inFlight.done;
  }
  const abort = new AbortController();
  let finished;
  const turn = { abort, done: new Promise((r) => (finished = r)) };
  inFlight = turn;

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  res.on('close', () => {
    if (!res.writableEnded) abort.abort();
  });

  const live = hasBrainKey();
  let reply = '';
  let felt = null;
  try {
    if (!live) {
      await streamDemoReply(message, send, abort.signal);
      send({ type: 'done', brain: 'demo' });
      return;
    }
    await memory.addMessage({ role: 'user', content: message, at: Date.now() });
    const messages = memory.messages();
    // What was just said (and the moment before it) is the cue for recall.
    const cue = messages.slice(-3).map((m) => m.content).join('\n');
    const [vector, instructions, room, plans] = await Promise.all([memory.cueVector(cue), buildSystemPrompt(), surroundingsBlock(), scheduleBlock()]);
    const recalled = memory.recall(cue, { vector });
    const system = [instructions, memoryBlock(recalled), room, plans, moodBlock()].filter(Boolean);
    const show = (text) => {
      if (!text) return;
      reply += text;
      send({ type: 'text', text });
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
      if (reply.trim() || abort.signal.aborted) break;
      const last = i === attempts.length - 1;
      const attempt = new AbortController();
      const stop = () => attempt.abort();
      abort.signal.addEventListener('abort', stop);
      let started = false;
      // Waiting on a stuck model is worse than switching to the backup.
      const timer = !last && backupModel ? setTimeout(() => started || attempt.abort(), config.fallbackAfterMs) : null;
      const tags = createTagReader((m) => {
        felt = m;
        send({ type: 'mood', ...m, at: Date.now(), halfLifeHours: mood.snapshot().halfLifeHours });
      });
      const stream = { openai: streamOpenAI, claude: streamClaude, codex: streamCodex }[model.provider];
      try {
        result = await stream(model.name, system, cleanHistory(messages), (event) => {
          started = true;
          show(tags.push(event.text));
        }, attempt.signal);
        show(tags.end());
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
    if (live && reply.trim()) {
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
    messages: memory.messages().map(({ role, content, at }) => ({
      role,
      content: role === 'assistant' ? splitMoodTag(content).text : content,
      at,
    })),
  });
}

// New chat: the twin sleeps on this conversation, then starts a fresh one.
// When they open the page after a break, the twin decides whether it would say
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
    else if (action === 'saveSchedule') await saveJson(config.scheduleFile, cleanSchedule(body.schedule));
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

async function elevenLabsSpeech(text) {
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.elevenVoice)}` +
    '?output_format=mp3_44100_128';
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': config.elevenKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: config.elevenModel }),
  });
  if (!response.ok) throw new Error(`ElevenLabs ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return { audio: Buffer.from(await response.arrayBuffer()), type: 'audio/mpeg' };
}

// The text goes through a file, never the command line, so it can't be read as options.
async function macSpeech(text) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'twin-say-'));
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
    const { audio, type } = useElevenLabs ? await elevenLabsSpeech(clean) : await macSpeech(clean);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(audio);
  } catch (err) {
    console.error('[tts]', err);
    sendJson(res, 502, { error: err.message });
  }
}

async function handleConfig(res) {
  const localAvatar = (await readdir(AVATAR_DIR).catch(() => [])).filter((f) => f.endsWith('.vrm')).sort()[0];
  sendJson(res, 200, {
    name: config.name,
    brain: hasBrainKey() ? config.brain : 'demo',
    model: brainModel,
    fallbackModel: backupModel?.name ?? null,
    voice: useElevenLabs ? 'elevenlabs' : 'mac',
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

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error('Request too large');
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
  if (!fromThisMac(req)) return sendJson(res, 403, { error: 'Only pages on this computer can use the twin.' });
  try {
    if (req.method === 'POST' && pathname === '/api/chat') return await handleChat(req, res);
    if (req.method === 'POST' && pathname === '/api/tts') return await handleTts(req, res);
    if (req.method === 'GET' && pathname === '/api/conversation') return await handleConversation(res);
    if (req.method === 'POST' && pathname === '/api/new-chat') return await handleNewChat(res);
    if (req.method === 'POST' && pathname === '/api/opener') return await handleOpener(res);
    if (req.method === 'POST' && pathname === '/api/house') return await handleSaveHouse(req, res);
    if (req.method === 'POST' && pathname === '/api/tick') return await handleTick(res);
    if (req.method === 'GET' && pathname === '/api/mind') return await handleMind(res);
    if (req.method === 'POST' && pathname === '/api/mind') return await handleMindChange(req, res);
    if (req.method === 'POST' && pathname === '/api/import') return await handleImport(req, res);
    if (req.method === 'GET' && pathname === '/api/config') return await handleConfig(res);
    if (req.method === 'GET' && pathname.startsWith('/avatar/')) {
      return await serveFile(res, AVATAR_DIR, pathname.slice('/avatar'.length));
    }
    if (req.method === 'GET') return await serveFile(res, PUBLIC_DIR, pathname === '/' ? '/index.html' : pathname === '/mind' ? '/mind.html' : pathname);
    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) sendJson(res, 500, { error: err.message });
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
    console.error(`Port ${config.port} is already in use. The twin may already be running: open http://localhost:${config.port}`);
    console.error('Or set PORT in .env to another number (like 4848) and start again.');
    process.exit(1);
  }
  throw err;
});
server.listen(config.port, '127.0.0.1', () => {
  console.log(`Digital twin running at http://localhost:${config.port}`);
  if (config.brain === 'chatgpt') {
    if (codexStatus.signedIn) console.log(`Brain: ${brainModel} through Codex, on your ChatGPT plan`);
    else console.log(`Brain: ChatGPT sign-in isn't ready (${codexStatus.detail}; run: codex login). ${backupModel ? `${backupModel.name} answers meanwhile.` : 'Demo replies until then.'}`);
  } else console.log(`Brain: ${hasBrainKey() ? brainModel : `demo replies (no ${brainLabel} API key)`}`);
  console.log(`Backup: ${backupModel ? `${backupModel.name} (if ${brainModel} fails or is silent for ${config.fallbackAfterMs / 1000} s)` : 'off'}`);
  console.log(`Voice: ${useElevenLabs ? 'ElevenLabs' : 'Mac say'}`);
});
