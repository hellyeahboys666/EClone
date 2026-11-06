// Building the persona from everything you have about the person: their chats, their
// own writing, their answers to questions, and what people who know them say.
//
//   parseSource   reads a file (chat exports from WhatsApp, Discord, Instagram or
//                 Messenger, Telegram, CSV, "Name: message" transcripts, or plain text)
//   measureStyle  how they really text, counted from their messages (no AI)
//   exchanges     real "they said / I replied" pairs, for examples and the accuracy test
//   chunks        the material cut into pieces for the AI to read
//
// The AI work (reading the chunks, writing the notes, testing) is in server.js, which
// passes the results back through here. Nothing here talks to the network.

// ---- Reading sources ------------------------------------------------------------------

export const KINDS = {
  chat: 'Chats with them in it',
  writing: 'Their own writing',
  answers: 'Their answers to questions',
  about: 'Written about them by someone else',
};

// { format, messages: [{ speaker, text }] } for a conversation, or { format: 'text', text }.
export function parseSource(raw, filename = '') {
  const text = String(raw).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lower = filename.toLowerCase();
  if (lower.endsWith('.json') || /^\s*[[{]/.test(text)) {
    try {
      const messages = fromJson(JSON.parse(text));
      if (messages.length) return { format: 'chat', messages };
    } catch {
      // Not JSON after all: read it as text.
    }
  }
  if (lower.endsWith('.csv')) {
    const messages = fromCsv(text);
    if (messages.length) return { format: 'chat', messages };
  }
  const plain = /<(html|body|div|p)\b/i.test(text.slice(0, 2000)) ? stripHtml(text) : text;
  const whatsapp = fromWhatsApp(plain);
  if (whatsapp.length >= 5) return { format: 'chat', messages: whatsapp };
  const transcript = fromTranscript(plain);
  if (transcript.length >= 5) return { format: 'chat', messages: transcript };
  return { format: 'text', text: plain.trim() };
}

// WhatsApp: "[12/31/23, 9:41:02 PM] Sam: hi" or "31/12/2023, 21:41 - Sam: hi".
// Lines without a date belong to the message above.
function fromWhatsApp(text) {
  const line = /^‎?\[?(\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}),?\s+(\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:\s?[AaPp]\.?\s?[Mm]\.?)?)\]?\s*(?:-\s*)?([^:\n]{1,50}?):\s(.*)$/;
  const out = [];
  for (const row of text.split('\n')) {
    const m = row.match(line);
    if (m) out.push({ speaker: m[3].replace(/^‎/, '').trim(), text: m[4] });
    else if (out.length && row.trim()) out.at(-1).text += `\n${row}`;
  }
  return out.filter((m) => !SKIP.test(m.text.trim()));
}

// "Sam: hi" transcripts, when most lines look like that and there are only a few names.
function fromTranscript(text) {
  const rows = text.split('\n').filter((r) => r.trim());
  const line = /^([A-Za-z][\w .'-]{0,30}?):\s+(.+)$/;
  const matches = rows.map((r) => r.match(line));
  const hits = matches.filter(Boolean);
  const names = new Set(hits.map((m) => m[1].trim()));
  if (hits.length < rows.length * 0.6 || names.size > 8) return [];
  const out = [];
  rows.forEach((r, i) => {
    if (matches[i]) out.push({ speaker: matches[i][1].trim(), text: matches[i][2] });
    else if (out.length) out.at(-1).text += `\n${r}`;
  });
  return out;
}

// Discord (DiscordChatExporter), Instagram / Messenger, Telegram, or any list of
// messages with a sender and a text field.
function fromJson(data) {
  const lists = [];
  const visit = (value, depth) => {
    if (depth > 5 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      if (value.some((v) => v && typeof v === 'object' && senderOf(v) && textOf(v))) lists.push(value);
      else for (const v of value.slice(0, 50)) visit(v, depth + 1);
    } else for (const v of Object.values(value)) visit(v, depth + 1);
  };
  visit(data, 0);
  const out = [];
  for (const list of lists) {
    // Instagram and Messenger list the newest first.
    const items = list.some((m) => 'timestamp_ms' in m) ? [...list].sort((a, b) => a.timestamp_ms - b.timestamp_ms) : list;
    for (const m of items) {
      const speaker = senderOf(m);
      const text = textOf(m);
      if (speaker && text && !SKIP.test(text.trim())) out.push({ speaker: fixMojibake(speaker), text: fixMojibake(text) });
    }
  }
  return out;
}
function senderOf(m) {
  const s = m.sender_name ?? m.author?.nickname ?? m.author?.name ?? (typeof m.author === 'string' ? m.author : null) ?? m.from ?? m.sender ?? m.speaker ?? m.name;
  return typeof s === 'string' && s.trim() ? s.trim().slice(0, 60) : null;
}
function textOf(m) {
  let t = m.content ?? m.text ?? m.message ?? m.body;
  if (Array.isArray(t)) t = t.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join(''); // Telegram
  return typeof t === 'string' && t.trim() ? t : null;
}
// Instagram and Messenger exports store UTF-8 as if it were Latin-1 ("Ã©" for "é").
function fixMojibake(s) {
  if (!/[Â-ô][\u0080-¿]/.test(s)) return s;
  try {
    const fixed = Buffer.from(s, 'latin1').toString('utf8');
    return fixed.includes('�') ? s : fixed;
  } catch {
    return s;
  }
}

// CSV with a sender column and a text column (iMessage and other exporters).
function fromCsv(text) {
  const rows = csvRows(text);
  if (rows.length < 2) return [];
  const head = rows[0].map((c) => c.trim().toLowerCase());
  const who = head.findIndex((c) => /^(sender|sender name|author|from|speaker|name|contact)$/.test(c));
  const what = head.findIndex((c) => /^(text|message|content|body)$/.test(c));
  if (who < 0 || what < 0) return [];
  return rows.slice(1).filter((r) => r[who]?.trim() && r[what]?.trim() && !SKIP.test(r[what].trim())).map((r) => ({ speaker: r[who].trim().slice(0, 60), text: r[what] }));
}
function csvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') row.push(cell), (cell = '');
    else if (c === '\n') row.push(cell), rows.push(row), (row = []), (cell = '');
    else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows;
}

function stripHtml(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n');
}

// Placeholders that aren't something the person said.
const SKIP = /^(<media omitted>|<attached:.*>|image omitted|video omitted|audio omitted|sticker omitted|gif omitted|document omitted|this message was deleted|you deleted this message|null|missed (voice|video) call|.{0,3}(joined|left) the (group|chat))$/i;

// Who's talking in a chat source, most messages first: [{ name, count }].
export function speakers(messages) {
  const counts = new Map();
  for (const m of messages) counts.set(m.speaker, (counts.get(m.speaker) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

export function wordCount(text) {
  return (String(text).match(/\S+/g) ?? []).length;
}

// ---- How they text, counted ------------------------------------------------------------

const EMOJI = /\p{Extended_Pictographic}/gu;
const HAS_EMOJI = /\p{Extended_Pictographic}/u;
const ACRONYMS = /\b(LOL|LMAO|LMFAO|OMG|WTF|IDK|TBH|BTW|ASAP|USA|TV|AI|PC|DM|FYI|GPA|SAT|ACT|AP)\b/g;
const STOP = new Set(
  `i me my you your we our they them their he him his she her it its a an the and or but if so to of in on at for with from by as is are was were be been am do does did have has had not no yes this that these those there here what when where who why how just can could would should will im i'm it's its dont don't thats that's ok okay oh like get got go going one also about all out up more some then than too really very`.split(/\s+/),
);

// Plain numbers from their own messages: how long, emoji, capitals, punctuation, and
// the words and phrases they use most.
export function measureStyle(texts) {
  const msgs = texts.map((t) => t.trim()).filter(Boolean);
  if (!msgs.length) return null;
  const words = msgs.map(wordCount).sort((a, b) => a - b);
  const share = (f) => Math.round((100 * msgs.filter(f).length) / msgs.length);
  const emojiCounts = new Map();
  const wordCounts = new Map();
  const phraseCounts = new Map();
  for (const m of msgs) {
    for (const e of m.match(EMOJI) ?? []) emojiCounts.set(e, (emojiCounts.get(e) ?? 0) + 1);
    const tokens = m.toLowerCase().replace(/https?:\/\/\S+/g, ' ').match(/[a-z][a-z']*/g) ?? [];
    for (const w of tokens) if (!STOP.has(w) && w.length > 1) wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= tokens.length; i++) {
        const gram = tokens.slice(i, i + n);
        if (gram.every((w) => STOP.has(w))) continue;
        const key = gram.join(' ');
        phraseCounts.set(key, (phraseCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const top = (map, min, n) => [...map].filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => ({ text: k, count: c }));
  return {
    messages: msgs.length,
    medianWords: words[Math.floor(words.length / 2)],
    longest: words.at(-1),
    shortShare: share((m) => wordCount(m) <= 5),
    lowercaseStart: share((m) => /^[a-z]/.test(m)),
    endsWithPeriod: share((m) => /[.]$/.test(m)),
    questions: share((m) => /\?\s*$/.test(m)),
    exclamations: share((m) => /!/.test(m)),
    allCaps: share((m) => /\b[A-Z]{3,}\b/.test(m.replace(ACRONYMS, ''))), // shouting, not acronyms
    emojiShare: share((m) => HAS_EMOJI.test(m)),
    topEmoji: top(emojiCounts, 2, 8),
    topWords: top(wordCounts, 3, 25),
    topPhrases: top(phraseCounts, 3, 20),
  };
}

// The numbers as a short paragraph for the "how I talk" note.
export function describeStyle(s) {
  if (!s) return '';
  const lines = [
    `Measured from ${s.messages} of my real messages:`,
    `- A typical message of mine is ${s.medianWords} words; ${s.shortShare}% are five words or fewer.`,
    `- ${s.lowercaseStart}% start with a lowercase letter, ${s.endsWithPeriod}% end with a period, ${s.questions}% are questions, ${s.exclamations}% have an exclamation mark.`,
    `- ${s.emojiShare}% have an emoji${s.topEmoji.length ? ` (most: ${s.topEmoji.slice(0, 5).map((e) => e.text).join(' ')})` : ''}. ${s.allCaps}% have words in capitals.`,
  ];
  if (s.topPhrases.length) lines.push(`- Phrases I use a lot: ${s.topPhrases.slice(0, 12).map((p) => `"${p.text}"`).join(', ')}.`);
  return lines.join('\n');
}

// ---- Real exchanges ----------------------------------------------------------------------

// Each time someone else said something and the person answered: { they, me }.
// Back-to-back messages from one side are joined, the way people double-text.
export function exchanges(messages, person) {
  const turns = [];
  for (const m of messages) {
    const mine = m.speaker === person;
    const text = m.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (turns.length && turns.at(-1).mine === mine) turns.at(-1).text += ` / ${text}`;
    else turns.push({ mine, text });
  }
  const out = [];
  for (let i = 1; i < turns.length; i++) {
    if (!turns[i].mine || turns[i - 1].mine) continue;
    const they = turns[i - 1].text;
    const me = turns[i].text;
    if (wordCount(me) > 45 || wordCount(they) > 60 || /https?:\/\//.test(me + they)) continue;
    out.push({ they, me });
  }
  return out;
}

// Splits the exchanges into examples (shown to the clone) and a held-out set for the
// accuracy test (never shown to it), picked evenly through the history.
export function pickExchanges(all, { examples = 30, test = 12 } = {}) {
  const usable = all.filter((e) => wordCount(e.me) >= 1);
  const spread = (list, n) => (list.length <= n ? list : Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]));
  const held = spread(usable.filter((_, i) => i % 4 === 2), test);
  const heldSet = new Set(held);
  return { examples: spread(usable.filter((e) => !heldSet.has(e)), examples), test: held };
}

export function examplesNote(examples) {
  if (!examples.length) return '';
  return [
    '# Real examples of how I text',
    '',
    'These are real messages of mine, word for word, with what the other person had just said. They show how I actually reply: the length, the wording, the attitude. Match this, but never repeat these lines word for word.',
    '',
    ...examples.map((e) => `- They: ${e.they}\n  Me: ${e.me}`),
  ].join('\n');
}

// ---- Material for the AI ------------------------------------------------------------------

// The sources cut into pieces of about `size` characters. In chats, the person's lines
// are marked "ME", so the AI knows whose words are whose. At most `max` pieces, taken
// evenly through everything when there's more.
export function chunks(sources, { size = 12_000, max = 40 } = {}) {
  const out = [];
  for (const s of sources) {
    const label = { chat: 'A chat. Lines starting "ME" are the person; the others are people they talk to.', writing: 'Something the person wrote themselves.', answers: "The person's own answers to questions about themselves.", about: 'Written about the person by someone else (second-hand: weaker than their own words).' }[s.kind] ?? '';
    const lines = s.parsed.format === 'chat'
      ? s.parsed.messages.map((m) => `${m.speaker === s.speaker ? 'ME' : m.speaker}: ${m.text.replace(/\s+/g, ' ').trim()}`)
      : s.parsed.text.split(/\n(?=\s*\n)/);
    let piece = '';
    for (const line of lines) {
      if (piece.length + line.length > size && piece) {
        out.push({ source: s.name, kind: s.kind, label, text: piece });
        piece = '';
      }
      piece += `${line}\n`;
    }
    if (piece.trim()) out.push({ source: s.name, kind: s.kind, label, text: piece });
  }
  // In chats, pieces where the person barely speaks say little about them.
  const useful = out.filter((c) => c.kind !== 'chat' || (c.text.match(/^ME:/gm) ?? []).length >= 5);
  if (useful.length <= max) return useful;
  return Array.from({ length: max }, (_, i) => useful[Math.floor((i * useful.length) / max)]);
}

// What the AI pulls out of each piece.
export const CATEGORIES = ['fact', 'routine', 'goal', 'speech', 'temperament', 'opinion', 'like', 'dislike', 'person', 'story'];
export const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'text', 'quote'],
        properties: { category: { type: 'string', enum: CATEGORIES }, text: { type: 'string' }, quote: { type: 'string' } },
      },
    },
  },
};

// Which findings each persona note is written from.
export const NOTE_PLAN = [
  { file: '01-about-me.md', title: 'About me', categories: ['fact', 'routine', 'goal'], covers: 'name, age, where they live, school or work, family, pets, daily routine, what they are working toward' },
  { file: '02-how-i-talk.md', title: 'How I talk', categories: ['speech', 'temperament'], covers: 'tone, humor, slang and phrases they really use, how long their messages are, how they type, what annoys them and how they react when annoyed or angry, how fast they get mad and calm down' },
  { file: '03-opinions-and-likes.md', title: 'Opinions and likes', categories: ['opinion', 'like', 'dislike'], covers: 'interests, favorite things, strong opinions, things they hate' },
  { file: '04-people-and-stories.md', title: 'People and stories', categories: ['person', 'story'], covers: 'friends, family and others they mention (with how they feel about each), memorable stories and things that happened' },
];

export const NOTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'missing'],
  properties: { text: { type: 'string' }, missing: { type: 'array', items: { type: 'string' } } },
};

// The findings for one note, without duplicates, as lines for the prompt.
export function findingsFor(findings, categories, limit = 30_000) {
  const seen = new Set();
  const lines = [];
  let length = 0;
  for (const f of findings) {
    if (!categories.includes(f.category)) continue;
    const key = f.text.toLowerCase().replace(/\W+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const line = `- [${f.kind === 'about' ? 'second-hand' : f.category}] ${f.text}${f.quote ? ` (quote: "${f.quote.slice(0, 200)}")` : ''}`;
    if (length + line.length > limit) break;
    lines.push(line);
    length += line.length;
  }
  return lines;
}

export const SCORE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scores', 'summary'],
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'style', 'substance', 'note'],
        properties: { index: { type: 'integer' }, style: { type: 'integer' }, substance: { type: 'integer' }, note: { type: 'string' } },
      },
    },
    summary: { type: 'string' },
  },
};
