// The twin's memory, kept as JSON files on this Mac (memory/ by default):
//   conversation.json  the current conversation, word for word (short-term memory)
//   memories.json      long-term memories formed from past conversation
//   usage.json         token counts
//   vectors.json       what each memory is about, as numbers, for recall by meaning
//   (mood.json, the twin's current feeling, is kept by mood.js)
//
// It works loosely like a person's memory. While the twin is idle, new conversation
// is consolidated into short dated memories, and old ones are updated when things
// change. Every so often it mulls them over and forms impressions. Each message
// brings back the memories it relates to by meaning (so "my nan" finds the grandma
// memory), plus the core ones (like the other person's name). Memories that keep
// coming up stay strong; the rest fade and turn fuzzy, but are never deleted.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const KEEP_MESSAGES = 100; // conversation kept word for word; older parts live on as memories
const CONSOLIDATE_EVERY = 16; // new messages before memories form mid-conversation
const IDLE_MS = 10 * 60_000; // quiet time before the twin "sleeps on" the conversation
const RECALL_LIMIT = 15; // memories one moment can bring back, besides the core ones
const CORE_IMPORTANCE = 9; // memories this important always come to mind
const CORE_LIMIT = 10;
const FADE_PER_HOUR = 0.995; // a memory not recalled for a week keeps about 40% of its pull
const REFLECT_AFTER = 10; // new memories before the twin mulls things over again
const REFLECT_ON = 60; // how many recent memories it looks back over
// Recall by meaning: a memory counts as related when it stands out from the rest for
// this cue (in standard deviations). Small talk like "hey" never gets past about 2;
// real matches usually reach 3 to 6.
const STANDS_OUT = 1.5; // below this, a memory's meaning match is just noise
const CLEARLY_RELATED = 2.5; // at or above this, recalling it strengthens it

const timeFormat = new Intl.DateTimeFormat('en-US', {
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
});

export function formatTime(at) {
  return timeFormat.format(at);
}

function localDay(at = Date.now()) {
  return new Date(at).toLocaleDateString('en-CA'); // YYYY-MM-DD
}

const MEMORY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['new', 'updated'],
  properties: {
    new: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'date', 'importance'],
        properties: { text: { type: 'string' }, date: { type: 'string' }, importance: { type: 'integer' } },
      },
    },
    updated: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text', 'importance'],
        properties: { id: { type: 'string' }, text: { type: 'string' }, importance: { type: 'integer' } },
      },
    },
  },
};

function consolidationPrompt(name) {
  return (
    `You form the long-term memories of ${name}, who talks with people as a digital twin. Read the new part of a ` +
    `conversation and decide what ${name} would remember, the way a person does after talking with a friend. Write ` +
    `each memory in ${name}'s first person ("Sam told me...", "I promised..."), one short sentence about one thing. ` +
    `Remember who they are and what they shared about themselves, plans and events, how they seemed, what we talked ` +
    `about, things I said about myself that I should stay consistent with, and anything I said I'd follow up on. ` +
    `Turn relative dates into real ones using when the message was sent ("Friday" becomes "Friday, November 6"), so ` +
    `later I can tell whether something has happened yet. Skip small talk and anything the known memories already ` +
    `cover. If the conversation changes or adds to a known memory (a plan happened, a fact changed), update that ` +
    `memory by its id instead of adding a new one. Leave out passwords, addresses, phone numbers and account ` +
    `details. Rate importance from 1 (trivial) to 10 (core, like their name or something big in their life). ` +
    `Where I clearly felt something (shown after "Me" in brackets), keep the feeling in the memory ("It really ` +
    `annoyed me when they...") and rate it as more important, the way people remember emotional moments better. ` +
    `Give each new memory the date it's from as YYYY-MM-DD.`
  );
}

const IMPRESSION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['new', 'updated'],
  properties: {
    new: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'importance'],
        properties: { text: { type: 'string' }, importance: { type: 'integer' } },
      },
    },
    updated: MEMORY_SCHEMA.properties.updated,
  },
};

function reflectionPrompt(name) {
  return (
    `You are ${name}, thinking back over what you remember about the person you talk with, the way people mull ` +
    `things over. From the memories below, note up to 3 impressions you've come to that no single memory says on ` +
    `its own: how they're doing lately, patterns in what they do or feel, what matters to them, how things are ` +
    `between us. Write each as one short first-person sentence, like "I get the sense..." or "I've noticed...". ` +
    `Only note impressions the memories really support, and return none if nothing stands out. If one of my ` +
    `existing impressions should change, update it by its id instead of adding a new one. Rate importance from 1 to 10.`
  );
}

// Words that say nothing about which memory is meant.
const STOP_WORDS = new Set(
  ("a about after again all also am an and any are as at be been but by can could did do does don't for from " +
    "get got had has have he her him his how i i'm if in into is it it's its just like me my no not now of on " +
    "or our out she so some than that that's the their them then there they this to too told up us was we " +
    "were what when where which who why will with would you you're your").split(' '),
);
const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

function terms(text) {
  const out = new Set();
  for (const { segment, isWordLike } of segmenter.segment(text.toLowerCase())) {
    if (!isWordLike || STOP_WORDS.has(segment)) continue;
    // Rough stemming so "tests" and "testing" match "test".
    out.add(segment.length > 4 ? segment.replace(/(ing|ed|es|s)$/, '') : segment);
  }
  return out;
}

// Writes go to a temporary file first, so a crash mid-write can't corrupt the memory.
let writeCount = 0;
export async function saveJson(file, data) {
  const tmp = `${file}.${process.pid}.${writeCount++}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, file);
}

export async function loadJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw new Error(`${path.basename(file)} is unreadable (${err.message}). Fix or move it, then restart.`);
  }
}

// `embed(texts)` turns texts into meaning vectors (and reports tokens used); without
// it, recall matches words only.
export function createMemory({ dir, name, completeJson, embed, onError, reflect: reflecting = true }) {
  const files = {
    conversation: path.join(dir, 'conversation.json'),
    memories: path.join(dir, 'memories.json'),
    usage: path.join(dir, 'usage.json'),
    vectors: path.join(dir, 'vectors.json'),
  };
  let conversation = { messages: [], consolidated: 0 };
  let memories = [];
  let usage = { total: {}, days: {} };
  let vectors = new Map(); // memory id -> Float32Array
  let queue = Promise.resolve();
  let idleTimer;

  async function load() {
    await mkdir(dir, { recursive: true });
    conversation = await loadJson(files.conversation, conversation);
    usage = await loadJson(files.usage, usage);
    memories = await loadJson(files.memories, null);
    if (!memories) memories = await importNotes();
    const saved = await loadJson(files.vectors, {});
    // (Copied into a fresh buffer, since a decoded Buffer may sit at an odd offset.)
    vectors = new Map(Object.entries(saved).map(([id, b64]) => [id, new Float32Array(Uint8Array.from(Buffer.from(b64, 'base64')).buffer)]));
    // Memories from before recall by meaning (or added by hand) get their vectors now.
    vectorize().catch((err) => onError?.(err));
    // Sleep on whatever was left from before the server stopped.
    const last = conversation.messages.at(-1);
    if (pending() && last && Date.now() - last.at > IDLE_MS) consolidate().catch(() => {});
  }

  // Gives every memory without one a meaning vector, a batch at a time.
  async function vectorize() {
    if (!embed) return;
    const missing = memories.filter((m) => !vectors.has(m.id));
    for (let i = 0; i < missing.length; i += 100) {
      const batch = missing.slice(i, i + 100);
      const { vectors: got, usage: used } = await embed(batch.map((m) => m.text));
      batch.forEach((m, k) => vectors.set(m.id, Float32Array.from(got[k])));
      await recordUsage('memory', used);
    }
    if (!missing.length) return;
    const out = {};
    for (const m of memories) if (vectors.has(m.id)) out[m.id] = Buffer.from(vectors.get(m.id).buffer).toString('base64');
    await saveJson(files.vectors, out);
  }

  // The meaning vector of what was just said, or null (no embedder, slow or failed),
  // in which case recall falls back to matching words.
  async function cueVector(text) {
    if (!embed || !text.trim()) return null;
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('embedding timed out')), 2000));
      const { vectors: got, usage: used } = await Promise.race([embed([text.slice(0, 8000)]), timeout]);
      recordUsage('memory', used).catch(() => {});
      return Float32Array.from(got[0]);
    } catch (err) {
      onError?.(err);
      return null;
    }
  }

  // An earlier version kept memories as lines in memories.md; bring them over once.
  async function importNotes() {
    const notes = await readFile(path.join(dir, 'memories.md'), 'utf8').catch(() => '');
    const now = Date.now();
    const imported = notes
      .split('\n')
      .map((line) => line.match(/^-\s*(\d{4}-\d{2}-\d{2})?:?\s*(.+)$/))
      .filter(Boolean)
      .map(([, date, text]) => ({
        id: randomUUID().slice(0, 8), text: text.trim(), date: date ?? localDay(now), importance: 5,
        created: now, lastRecalled: now, recalls: 0,
      }));
    await saveJson(files.memories, imported);
    return imported;
  }

  function pending() {
    return conversation.messages.length - conversation.consolidated;
  }

  function messages() {
    return conversation.messages;
  }

  async function addMessage(message) {
    conversation.messages.push(message);
    await saveJson(files.conversation, conversation);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => consolidate().catch(() => {}), IDLE_MS);
    idleTimer.unref();
    if (message.role === 'assistant' && pending() >= CONSOLIDATE_EVERY) consolidate().catch(() => {});
  }

  // Turns the conversation since the last consolidation into memories. Runs one at a
  // time; failures leave the messages pending so the next run picks them up.
  function consolidate() {
    const run = queue.then(async () => {
      const upTo = conversation.messages.length;
      const fresh = conversation.messages.slice(conversation.consolidated, upTo);
      if (fresh.some((m) => m.role === 'user')) await formMemories(fresh);
      conversation.consolidated = upTo;
      if (reflecting) await reflect();
      // Keep the latest messages word for word; everything older is now in memories.
      const drop = Math.min(conversation.messages.length - KEEP_MESSAGES, conversation.consolidated);
      if (drop > 0) {
        conversation.messages.splice(0, drop);
        conversation.consolidated -= drop;
      }
      await saveJson(files.conversation, conversation);
    });
    queue = run.catch((err) => onError?.(err));
    return run;
  }

  async function formMemories(fresh) {
    // Only feelings worth noticing are shown, so calm replies don't read as emotional.
    const who = (m) =>
      m.role === 'user' ? 'Them' : m.mood && m.mood.feeling !== 'calm' && m.mood.intensity >= 3
        ? `Me [feeling ${m.mood.feeling}, ${m.mood.intensity}/10]` : 'Me';
    // (A mood tag that slipped into a saved reply is dropped.)
    const said = (m) => (m.role === 'user' ? m.content : m.content.replace(/^\s*\[\s*mood\b[^\]]*\]\s*/i, ''));
    const transcript = fresh.map((m) => `[${formatTime(m.at)}] ${who(m)}: ${said(m)}`).join('\n');
    const known = recall(transcript, { vector: await cueVector(transcript), limit: 40, reinforce: false })
      .map((m) => `${m.id} (${m.date}, importance ${m.importance}): ${m.text}`)
      .join('\n');
    const { data, usage: used } = await completeJson(
      consolidationPrompt(name),
      `<known_memories>\n${known || '(none yet)'}\n</known_memories>\n\n<conversation>\n${transcript}\n</conversation>`,
      MEMORY_SCHEMA,
    );
    await recordUsage('memory', used);

    const now = Date.now();
    const importance = (n) => Math.min(10, Math.max(1, Math.round(Number(n) || 5)));
    for (const u of data.updated ?? []) {
      const m = memories.find((x) => x.id === u.id);
      if (!m || !u.text?.trim()) continue;
      // Like recalling a memory and updating it: it comes back stronger.
      Object.assign(m, { text: u.text.trim(), importance: importance(u.importance), lastRecalled: now });
      vectors.delete(m.id); // its meaning changed
    }
    for (const n of data.new ?? []) {
      if (!n.text?.trim()) continue;
      memories.push({
        id: randomUUID().slice(0, 8),
        text: n.text.trim(),
        date: /^\d{4}-\d{2}-\d{2}$/.test(n.date) ? n.date : localDay(fresh.at(-1).at),
        importance: importance(n.importance),
        created: now,
        lastRecalled: now,
        recalls: 0,
      });
    }
    await saveJson(files.memories, memories);
    await vectorize().catch((err) => onError?.(err));
  }

  // Every so often the twin mulls over its recent memories and forms impressions no
  // single memory says ("I get the sense they're running on no sleep"), the way
  // people notice patterns. Impressions are memories too, so they're recalled the same way.
  async function reflect() {
    const facts = memories.filter((m) => m.kind !== 'impression');
    const since = facts.filter((m) => m.created > (conversation.reflectedAt ?? 0)).length;
    if (since < REFLECT_AFTER) return;
    const recent = [...facts].sort((a, b) => b.created - a.created).slice(0, REFLECT_ON).reverse();
    const mine = memories.filter((m) => m.kind === 'impression');
    const { data, usage: used } = await completeJson(
      reflectionPrompt(name),
      `<memories>\n${recent.map((m) => `- ${m.date}: ${m.text}`).join('\n')}\n</memories>\n\n` +
        `<my_impressions>\n${mine.map((m) => `${m.id} (${m.date}): ${m.text}`).join('\n') || '(none yet)'}\n</my_impressions>`,
      IMPRESSION_SCHEMA,
    );
    await recordUsage('memory', used);

    const now = Date.now();
    const importance = (n) => Math.min(10, Math.max(1, Math.round(Number(n) || 6)));
    for (const u of data.updated ?? []) {
      const m = mine.find((x) => x.id === u.id);
      if (!m || !u.text?.trim()) continue;
      Object.assign(m, { text: u.text.trim(), importance: importance(u.importance), lastRecalled: now });
      vectors.delete(m.id);
    }
    for (const n of (data.new ?? []).slice(0, 3)) {
      if (!n.text?.trim()) continue;
      memories.push({
        id: randomUUID().slice(0, 8), kind: 'impression', text: n.text.trim(), date: localDay(now),
        importance: importance(n.importance), created: now, lastRecalled: now, recalls: 0,
      });
    }
    conversation.reflectedAt = now;
    await saveJson(files.memories, memories);
    await vectorize().catch((err) => onError?.(err));
  }

  // Returns the memories a cue brings to mind, oldest first. Scores mix how related a
  // memory is to the cue, how recently it was last recalled, and how important it is.
  // Relatedness is by meaning when there's a cue `vector` (with a bonus for shared
  // words, which keeps names like "Biscuit" strong), otherwise by shared words alone.
  // Recalled memories are reinforced, so they fade more slowly.
  function recall(cue, { vector = null, limit = RECALL_LIMIT, reinforce = true } = {}) {
    if (!memories.length) return [];
    const cueTerms = terms(cue);
    const memoryTerms = memories.map((m) => terms(m.text));
    const seenIn = new Map();
    for (const t of memoryTerms) for (const w of t) seenIn.set(w, (seenIn.get(w) ?? 0) + 1);

    // Shared words. A word in most memories (like the other person's name) doesn't
    // say which one is meant; rare words ("chemistry") say more than common ones.
    const tooCommon = memories.length >= 4 ? memories.length / 2 : Infinity;
    const words = memoryTerms.map((t) => {
      let overlap = 0;
      for (const w of cueTerms) if (t.has(w) && seenIn.get(w) <= tooCommon) overlap += Math.log(1 + memories.length / seenIn.get(w));
      return overlap / Math.sqrt(t.size || 1);
    });
    const topWords = Math.max(...words) || 1;

    // Meaning: how far each memory stands out from the rest for this cue.
    let meaning = null;
    if (vector) {
      const sims = memories.map((m) => {
        const v = vectors.get(m.id);
        if (!v || v.length !== vector.length) return null;
        let dot = 0;
        for (let k = 0; k < v.length; k++) dot += v[k] * vector[k];
        return dot;
      });
      const known = sims.filter((x) => x !== null);
      const mean = known.reduce((a, b) => a + b, 0) / (known.length || 1);
      const sd = Math.sqrt(known.reduce((a, b) => a + (b - mean) ** 2, 0) / (known.length || 1));
      if (known.length >= 2 && sd > 0) meaning = sims.map((x) => (x === null ? 0 : (x - mean) / sd));
    }

    const now = Date.now();
    const scored = memories.map((m, i) => {
      const wordShare = words[i] / topWords;
      const relevance = meaning ? Math.max(0, meaning[i] - STANDS_OUT) / 3 + 0.5 * wordShare : wordShare;
      // Only memories the cue clearly brought back get stronger, not ones that came along.
      const related = (words[i] > 0 && wordShare >= 0.5) || (meaning !== null && meaning[i] >= CLEARLY_RELATED);
      const recency = FADE_PER_HOUR ** ((now - m.lastRecalled) / 3_600_000);
      return { m, relevance, related, recency, score: relevance + 0.5 * recency + 0.5 * (m.importance / 10) };
    });
    scored.sort((a, b) => b.score - a.score);

    const core = scored.filter((s) => s.m.importance >= CORE_IMPORTANCE).slice(0, CORE_LIMIT);
    const rest = scored.filter((s) => !core.includes(s)).slice(0, limit);
    const chosen = [...core, ...rest];
    // How clear each memory is as it comes back, before this recall strengthens it:
    // small things go hazy after a week or so, big ones stay sharp much longer.
    const fuzzy = new Set(chosen.filter((s) => s.m.importance < 9 && s.recency + s.m.importance / 10 < 0.8).map((s) => s.m));

    if (reinforce) {
      let changed = false;
      for (const s of chosen) {
        if (!s.related) continue;
        s.m.lastRecalled = now;
        s.m.recalls += 1;
        changed = true;
      }
      if (changed) saveJson(files.memories, memories).catch((err) => onError?.(err));
    }
    return chosen
      .map((s) => ({ ...s.m, fuzzy: fuzzy.has(s.m) }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created);
  }

  // Ends the current conversation after consolidating it, like closing a chat.
  async function startOver() {
    await consolidate();
    const lastAt = conversation.messages.at(-1)?.at ?? conversation.lastAt;
    conversation = { messages: [], consolidated: 0, reflectedAt: conversation.reflectedAt, lastAt };
    clearTimeout(idleTimer);
    await saveJson(files.conversation, conversation);
  }

  // When they last talked, even if the conversation has since been closed with New chat.
  function lastTalked() {
    return conversation.messages.at(-1)?.at ?? conversation.lastAt ?? null;
  }

  // Takes over a conversation an earlier version kept in the browser, if none is here yet.
  async function importConversation(list) {
    if (conversation.messages.length) return conversation.messages;
    const valid = (Array.isArray(list) ? list : [])
      .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000), at: Number.isFinite(m.at) ? m.at : Date.now() }))
      .slice(-KEEP_MESSAGES);
    conversation = { messages: valid, consolidated: 0 };
    await saveJson(files.conversation, conversation);
    return conversation.messages;
  }

  async function recordUsage(kind, used) {
    if (!used) return;
    if (used.plan) kind = 'plan'; // on the ChatGPT plan through Codex: not billed
    const day = localDay();
    for (const bucket of [usage.total, (usage.days[day] ??= {})]) {
      const b = (bucket[kind] ??= { input: 0, cached: 0, output: 0, requests: 0 });
      b.input += used.input;
      b.cached += used.cached;
      b.output += used.output;
      b.requests += 1;
    }
    for (const d of Object.keys(usage.days).sort().slice(0, -60)) delete usage.days[d];
    await saveJson(files.usage, usage);
  }

  function usageSummary() {
    return { today: usage.days[localDay()] ?? {}, total: usage.total };
  }

  // ---- Editing by hand (the Mind page) -----------------------------------------
  // Changes go through here rather than the files, so they can't clash with memories
  // being formed at the same moment.

  function list() {
    return memories.map(({ id, kind, text, date, importance, recalls, lastRecalled }) => ({ id, kind: kind ?? 'fact', text, date, importance, recalls, lastRecalled }));
  }

  const clampImportance = (n) => Math.min(10, Math.max(1, Math.round(Number(n) || 5)));

  async function addMemory({ text, importance, date }) {
    const now = Date.now();
    const m = {
      id: randomUUID().slice(0, 8), text: String(text).trim().slice(0, 1000), importance: clampImportance(importance),
      date: /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date : localDay(now), created: now, lastRecalled: now, recalls: 0,
    };
    if (!m.text) throw new Error('A memory needs some text.');
    memories.push(m);
    await saveJson(files.memories, memories);
    vectorize().catch((err) => onError?.(err));
    return m;
  }

  async function updateMemory(id, { text, importance }) {
    const m = memories.find((x) => x.id === id);
    if (!m) throw new Error('That memory no longer exists.');
    if (text !== undefined) {
      const clean = String(text).trim().slice(0, 1000);
      if (!clean) throw new Error('A memory needs some text.');
      if (clean !== m.text) vectors.delete(m.id);
      m.text = clean;
    }
    if (importance !== undefined) m.importance = clampImportance(importance);
    await saveJson(files.memories, memories);
    vectorize().catch((err) => onError?.(err));
    return m;
  }

  async function removeMemory(id) {
    memories = memories.filter((m) => m.id !== id);
    vectors.delete(id);
    await saveJson(files.memories, memories);
    await saveVectors();
  }

  // Forgets every long-term memory (the conversation and token counts stay).
  async function forgetAll() {
    memories = [];
    vectors = new Map();
    conversation.reflectedAt = Date.now();
    await saveJson(files.memories, memories);
    await saveVectors();
    await saveJson(files.conversation, conversation);
  }

  // Clears the current conversation without forming memories from it.
  async function clearConversation() {
    const lastAt = conversation.messages.at(-1)?.at ?? conversation.lastAt;
    conversation = { messages: [], consolidated: 0, reflectedAt: conversation.reflectedAt, lastAt };
    clearTimeout(idleTimer);
    await saveJson(files.conversation, conversation);
  }

  async function saveVectors() {
    const out = {};
    for (const m of memories) if (vectors.has(m.id)) out[m.id] = Buffer.from(vectors.get(m.id).buffer).toString('base64');
    await saveJson(files.vectors, out);
  }

  return {
    load, messages, addMessage, consolidate, recall, cueVector, lastTalked, startOver, importConversation, recordUsage, usageSummary,
    list, addMemory, updateMemory, removeMemory, forgetAll, clearConversation,
  };
}
