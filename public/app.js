// The conversation side: text and voice input, streaming replies from the
// server, and a speech queue that plays each sentence as soon as it's ready.
import { createStage } from './scene.js';
import { createHousePanel } from './house-panel.js';

const els = {
  canvas: document.getElementById('scene'),
  name: document.getElementById('twin-name'),
  brainChip: document.getElementById('brain-chip'),
  voiceChip: document.getElementById('voice-chip'),
  moodChip: document.getElementById('mood-chip'),
  tokenChip: document.getElementById('token-chip'),
  newChat: document.getElementById('new-chat'),
  houseButton: document.getElementById('house-button'),
  housePanel: document.getElementById('house-panel'),
  loading: document.getElementById('loading'),
  log: document.getElementById('log'),
  form: document.getElementById('composer'),
  input: document.getElementById('input'),
  mic: document.getElementById('mic'),
  hint: document.getElementById('hint'),
};

const speech = createSpeechQueue((err) => hint(`Voice error: ${err.message}`));

// Open the page with ?debug to try body language and moods from the browser console:
// twinDebug.activity('thinking'), twinDebug.mood('happy', 8).
if (new URLSearchParams(location.search).has('debug')) {
  window.twinDebug = {
    activity: (a) => (activity = a),
    mood: (feeling, intensity = 8) => {
      mood = { feeling, intensity, at: Date.now(), halfLifeHours: 2 };
      showMood();
    },
  };
}
let currentTurn = null;
let mood = { feeling: 'calm', intensity: 0, at: Date.now(), halfLifeHours: 2 };
// What the twin is doing, for its body language: 'idle', 'listening' (your mic is on)
// or 'thinking' (waiting for its reply to start). Talking comes from the voice itself.
let activity = 'idle';

init();

async function init() {
  const config = await (await fetch('/api/config')).json();
  els.name.textContent = config.name;
  document.title = `${config.name} · EClone`;
  setBrainChip(config.brain, config.model);
  els.brainChip.title = config.fallbackModel
    ? `Backup model: ${config.fallbackModel}. It answers if ${config.model} fails or doesn't start answering in time.`
    : 'No backup model.';
  els.voiceChip.textContent = config.voice === 'elevenlabs' ? 'Voice: ElevenLabs clone' : 'Voice: Mac built-in';
  showUsage(null, config.usage);
  if (config.mood) mood = config.mood;
  showMood();
  setInterval(showMood, 60_000); // the feeling fades even while nobody's talking
  loadConversation()
    .then(maybeSpeakFirst)
    .catch((err) => hint(`Couldn't load the conversation: ${err.message}`));
  els.newChat.addEventListener('click', newChat);

  const stage = createStage(els.canvas, {
    avatarUrl: config.avatarUrl,
    house: config.house,
    getMouthLevel: () => speech.level(),
    getMood: currentFeeling,
    getActivity: () => activity,
    onProgress: (p) => (els.loading.textContent = `Loading avatar… ${Math.min(100, Math.round(p * 100))}%`),
  });
  createHousePanel({ button: els.houseButton, panel: els.housePanel, initial: config.house, onChange: stage.setHouse });
  stage.loaded
    .then(() => {
      els.loading.hidden = true;
      if (config.sampleAvatar) hint('Using a sample avatar. Put your own .vrm file in the avatar folder to replace it.');
    })
    .catch((err) => (els.loading.textContent = `Avatar failed to load: ${err.message}`));

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = els.input.value;
    els.input.value = '';
    send(text);
  });
  setupMic();
}

function setBrainChip(brain, model) {
  els.brainChip.textContent = brain === 'demo' ? 'Brain: demo mode (no API key)' : `Brain: ${model}`;
  els.brainChip.classList.toggle('warn', brain === 'demo');
}

function hint(text) {
  els.hint.textContent = text;
}

function addBubble(kind, text) {
  const li = document.createElement('li');
  li.className = `bubble ${kind}`;
  li.textContent = text;
  els.log.append(li);
  els.log.scrollTop = els.log.scrollHeight;
  return li;
}

// The conversation and the twin's memories live on the server (memory/ on this
// Mac), so they survive refreshes, restarts and switching browsers.
async function loadConversation() {
  let { messages } = await (await fetch('/api/conversation')).json();
  if (!messages.length) messages = await importOldConversation();
  for (const m of messages) addBubble(m.role === 'user' ? 'user' : 'twin', m.content);
}

// After a break, the twin may say something first ("so how'd the test go?"). The
// server decides; most of the time it waits for you.
async function maybeSpeakFirst() {
  const res = await fetch('/api/opener', { method: 'POST' });
  const { line, totals } = await res.json();
  if (!line || currentTurn) return;
  addBubble('twin', line);
  if (totals) showUsage(null, totals);
  speech.sayIfAllowed(line);
}

// An earlier version kept the conversation in this browser; hand it to the server once.
async function importOldConversation() {
  const key = `twin-history:${els.name.textContent}`;
  try {
    const old = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(old) || !old.length) return [];
    const res = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: old }),
    });
    if (!res.ok) return [];
    localStorage.removeItem(key);
    return (await res.json()).messages;
  } catch {
    return [];
  }
}

// The twin sleeps on this conversation (forms memories from it), then starts fresh.
async function newChat() {
  if (!confirm(`Start a new conversation? ${els.name.textContent} will remember what mattered in this one.`)) return;
  interrupt();
  els.newChat.disabled = true;
  hint('Saving this conversation to memory…');
  try {
    const res = await fetch('/api/new-chat', { method: 'POST' });
    if (!res.ok) throw new Error((await res.json()).error ?? `Server error ${res.status}`);
    els.log.replaceChildren();
    hint('');
  } catch (err) {
    hint(`Couldn't save this conversation to memory, so it's still here: ${err.message}`);
  } finally {
    els.newChat.disabled = false;
  }
}

function tokens(bucket) {
  return Object.values(bucket ?? {}).reduce((sum, b) => sum + (b?.input ?? 0) + (b?.output ?? 0), 0);
}

function short(n) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// Tokens chip: the last reply and today's total, with a breakdown on hover.
function showUsage(last, totals) {
  const today = tokens(totals?.today);
  els.tokenChip.textContent = last ? `Tokens: ${short(last.input + last.output)} last · ${short(today)} today` : `Tokens: ${short(today)} today`;
  const lines = [];
  if (last) {
    lines.push(`Last reply: ${last.input.toLocaleString()} in (${last.cached.toLocaleString()} cached), ${last.output.toLocaleString()} out`);
  }
  const memoryToday = tokens({ memory: totals?.today?.memory });
  lines.push(`Today: ${today.toLocaleString()} (memory upkeep ${memoryToday.toLocaleString()})`);
  lines.push(`All time: ${tokens(totals?.total).toLocaleString()}`);
  els.tokenChip.title = lines.join('\n');
}

// The twin's feeling right now: it fades by half every couple of hours, the same
// way the server works it out (mood.js), and below 1.5 it has worn off.
function currentFeeling() {
  const hours = (Date.now() - mood.at) / 3_600_000;
  const level = mood.intensity * 0.5 ** (hours / (mood.halfLifeHours || 2));
  return level < 1.5 || mood.feeling === 'calm' ? { feeling: 'calm', level: 0 } : { feeling: mood.feeling, level };
}

// Mood chip: the feeling, with how strong it is and why on hover.
function showMood() {
  const { feeling, level } = currentFeeling();
  els.moodChip.textContent = `Mood: ${feeling}`;
  els.moodChip.title = feeling === 'calm'
    ? 'Calm: nothing in particular right now.'
    : `About ${Math.round(level)}/10${mood.reason ? `, because: ${mood.reason}` : ''}. Fades over a few hours.`;
}

// Stops the twin mid-sentence when you start talking or send something new.
function interrupt() {
  currentTurn?.abort();
  currentTurn = null;
  speech.stop();
}

async function send(rawText) {
  const text = rawText.trim();
  if (!text) return;
  interrupt();
  speech.unlock();
  hint('');
  addBubble('user', text);

  const bubble = addBubble('twin', '');
  const turn = new AbortController();
  currentTurn = turn;
  activity = 'thinking';
  let reply = '';
  let unspoken = '';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: turn.signal,
    });
    if (!res.ok) throw new Error((await res.json()).error ?? `Server error ${res.status}`);

    for await (const event of readEvents(res)) {
      if (event.type === 'text') {
        if (activity === 'thinking') activity = 'idle';
        reply += event.text;
        unspoken += event.text;
        bubble.textContent = reply;
        els.log.scrollTop = els.log.scrollHeight;
        let cut;
        while ((cut = sentenceEnd(unspoken)) > 0) {
          speech.say(unspoken.slice(0, cut));
          unspoken = unspoken.slice(cut);
        }
      } else if (event.type === 'mood') {
        mood = event;
        showMood();
      } else if (event.type === 'refusal') {
        hint('Claude declined to answer that one.');
      } else if (event.type === 'error') {
        bubble.classList.add('error');
        bubble.textContent = event.message;
      } else if (event.type === 'done') {
        setBrainChip(event.brain, event.model);
        if (event.usage) showUsage(event.usage, event.totals);
        if (event.fallback) hint(`The backup model answered: ${event.fallback.from} didn't (${event.fallback.reason}).`);
      }
    }
    if (unspoken.trim()) speech.say(unspoken);
  } catch (err) {
    if (err.name !== 'AbortError') {
      bubble.classList.add('error');
      bubble.textContent = err.message;
    }
  } finally {
    if (currentTurn === turn) {
      currentTurn = null;
      if (activity === 'thinking') activity = 'idle';
    }
  }
}

// Index just past the first sentence end that leaves a chunk long enough to
// sound natural on its own, or 0 if there isn't one yet.
function sentenceEnd(text) {
  const re = /[.!?…]+["'”’)\]]*\s+/g;
  let m;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    if (end >= 24) return end;
  }
  return 0;
}

async function* readEvents(res) {
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let sep;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = chunk.split('\n').find((line) => line.startsWith('data: '));
      if (data) yield JSON.parse(data.slice(6));
    }
  }
}

// Fetches audio for each sentence right away (in parallel) but plays them in
// order. Playback runs through an analyser so the avatar's mouth can follow it.
function createSpeechQueue(onError) {
  let ctx, analyser, samples;
  let current = null;
  let generation = 0;
  let chain = Promise.resolve();

  function unlock() {
    if (!ctx) {
      ctx = new AudioContext();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.connect(ctx.destination);
      samples = new Float32Array(analyser.fftSize);
    }
    ctx.resume();
  }

  function say(text) {
    const gen = generation;
    const audio = fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
      .then(async (r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error((await r.json()).error))))
      .then((buf) => ctx.decodeAudioData(buf));
    audio.catch(() => {}); // reported when its turn comes in the chain
    chain = chain.then(async () => {
      if (gen !== generation) return;
      let buffer;
      try {
        buffer = await audio;
      } catch (err) {
        onError(err);
        return;
      }
      if (gen === generation) await play(buffer);
    });
  }

  function play(buffer) {
    return new Promise((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser);
      source.onended = () => {
        if (current === source) current = null;
        resolve();
      };
      current = source;
      source.start();
    });
  }

  function stop() {
    generation++;
    current?.stop();
    current = null;
  }

  // 0..1 loudness of whatever is playing right now.
  function level() {
    if (!current) return 0;
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const s of samples) sum += s * s;
    const rms = Math.sqrt(sum / samples.length);
    return Math.max(0, Math.min(1, rms * 4 - 0.03));
  }

  // Speaks only if sound is already allowed; browsers block it until you've clicked.
  function sayIfAllowed(text) {
    if (ctx?.state === 'running') say(text);
  }

  return { unlock, say, sayIfAllowed, stop, level };
}

// Browser speech recognition (Chrome and Safari). Click to talk; it sends
// when you stop speaking.
function setupMic() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    els.mic.hidden = true;
    hint('Voice input needs Chrome or Safari. You can type instead.');
    return;
  }
  const rec = new Recognition();
  rec.lang = 'en-US';
  rec.interimResults = true;
  let listening = false;
  let heard = '';

  rec.onresult = (e) => {
    heard = Array.from(e.results, (r) => r[0].transcript).join('');
    els.input.value = heard;
  };
  rec.onerror = (e) => {
    hint(e.error === 'not-allowed'
      ? 'Microphone access was blocked. Allow it in the browser to talk, or type instead.'
      : `Voice input stopped (${e.error}). You can type instead.`);
  };
  rec.onend = () => {
    listening = false;
    if (activity === 'listening') activity = 'idle';
    els.mic.classList.remove('on');
    if (heard.trim()) {
      els.input.value = '';
      send(heard);
    } else if (els.hint.textContent === 'Listening…') {
      hint('');
    }
    heard = '';
  };
  els.mic.addEventListener('click', () => {
    if (listening) return rec.stop();
    interrupt();
    speech.unlock();
    heard = '';
    rec.start();
    activity = 'listening';
    listening = true;
    els.mic.classList.add('on');
    hint('Listening…');
  });
}
