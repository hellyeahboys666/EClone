// The conversation side: text and voice input, streaming replies from the
// server, and a speech queue that plays each sentence as soon as it's ready.
import { createStage } from './scene.js';
import { createHousePanel } from './house-panel.js';

const els = {
  canvas: document.getElementById('scene'),
  name: document.getElementById('twin-name'),
  brainChip: document.getElementById('brain-chip'),
  voiceChip: document.getElementById('voice-chip'),
  statusChip: document.getElementById('status-chip'),
  moodChip: document.getElementById('mood-chip'),
  tokenChip: document.getElementById('token-chip'),
  newChat: document.getElementById('new-chat'),
  houseButton: document.getElementById('house-button'),
  viewRoom: document.getElementById('view-room'),
  viewTwin: document.getElementById('view-twin'),
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
let lastCaption = null; // the twin's latest line, while it may still be saying it
let pendingCut = null; // what it had said when you clicked the mic to talk over it
let twinAway = false;
let sends = 0;
let mic = { cancel() {} };
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
    .then(() => {
      checkSchedule();
      setInterval(checkSchedule, 60_000);
    })
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
  // Camera: look down on the whole room, or go back to facing the twin.
  els.viewRoom.addEventListener('click', () => stage.view('room'));
  els.viewTwin.addEventListener('click', () => stage.view('twin'));
  els.canvas.addEventListener('viewchange', (event) => {
    els.viewRoom.hidden = event.detail.mode === 'room';
    els.viewTwin.hidden = event.detail.mode !== 'room';
  });

  createHousePanel({ button: els.houseButton, panel: els.housePanel, initial: config.house, stage, onChange: stage.setHouse, onSettled: reactToHouse });
  setPresent = stage.setPresent;
  stage.loaded
    .then((avatar) => {
      els.loading.hidden = true;
      if (config.sampleAvatar) hint('Using a sample avatar. Put your own .vrm or .glb file in the avatar folder to replace it.');
      // A .glb character may lack a standard skeleton or face shape keys.
      const lacks = {
        skeleton: 'standard skeleton, so it stands still',
        mouth: "mouth shape keys, so its mouth won't move",
        blink: "blink shape keys, so it won't blink",
      };
      const missing = (avatar.missing ?? []).map((m) => lacks[m]);
      if (missing.length) hint(`This avatar has no ${missing.join(', and no ')}.`);
    })
    .catch((err) => (els.loading.textContent = `Avatar failed to load: ${err.message}`));

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = els.input.value;
    els.input.value = '';
    send(text);
  });
  mic = setupMic();
  els.input.addEventListener('input', watchDraft);
}

function setBrainChip(brain, model) {
  els.brainChip.textContent = brain === 'demo' ? 'Brain: demo mode (no API key)' : brain === 'chatgpt' ? `Brain: ${model} · ChatGPT plan` : `Brain: ${model}`;
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
  for (const m of messages) {
    if (m.silent) addBubble('twin quiet', '(no reply)');
    else addBubble(m.role === 'user' ? 'user' : 'twin', m.content);
  }
}

// After a break, the twin may say something first ("so how'd the test go?"). The
// server decides; most of the time it waits for you.
async function maybeSpeakFirst() {
  const res = await fetch('/api/opener', { method: 'POST' });
  const { line, totals } = await res.json();
  if (!line || currentTurn) return;
  const caption = createCaption(addBubble('twin', ''));
  if (totals) showUsage(null, totals);
  caption.say(line);
}

// The twin's schedule, checked every minute: what it's doing (the status chip),
// whether it's home (the avatar is gone while it's out), and a line when it's
// about to leave for something ("heading to work, talk later").
let setPresent = () => {};
let lastStatus = '';
async function checkSchedule() {
  const res = await fetch('/api/tick', { method: 'POST' }).catch(() => null);
  if (!res?.ok) return;
  const { scheduled, status, line, mood: felt, totals } = await res.json();
  els.statusChip.hidden = !scheduled;
  const label = status ? `${status.where === 'away' ? 'Out' : status.busy ? 'Busy' : 'Now'}: ${status.name} · until ${status.until}` : 'Free';
  els.statusChip.textContent = label;
  els.statusChip.title = status?.note ? `${status.name}: ${status.note}` : status ? `${status.where === 'away' ? 'Out' : 'At home'}, ${status.busy ? 'busy' : 'free to chat'}` : 'Nothing on the schedule right now.';
  setPresent(status?.where !== 'away');
  if (label !== lastStatus && status?.where === 'away') hint(`${els.name.textContent} is out (${status.name}) until ${status.until}. You can still message.`);
  else if (label !== lastStatus && lastStatus.startsWith('Out')) hint('');
  lastStatus = label;
  twinAway = status?.where === 'away';
  if (line && !currentTurn) {
    if (felt) {
      // It just came home and noticed something new.
      mood = felt;
      showMood();
    }
    const caption = createCaption(addBubble('twin', ''));
    if (totals) showUsage(null, totals);
    caption.say(line);
  }
}

// After you change the house, the twin says what it thinks of it, by its own taste.
async function reactToHouse() {
  if (currentTurn) return; // it'll notice in its next reply instead
  const res = await fetch('/api/house-react', { method: 'POST' }).catch(() => null);
  if (!res?.ok) return;
  const { line, mood: felt, totals } = await res.json();
  if (!line || currentTurn) return;
  if (felt) {
    mood = felt;
    showMood();
  }
  if (totals) showUsage(null, totals);
  createCaption(addBubble('twin', '')).say(line);
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

// Billed tokens only: 'plan' is the ChatGPT plan through Codex, which isn't billed.
function tokens(bucket) {
  return Object.entries(bucket ?? {}).reduce((sum, [kind, b]) => (kind === 'plan' ? sum : sum + (b?.input ?? 0) + (b?.output ?? 0)), 0);
}

function planTokens(bucket) {
  const b = bucket?.plan;
  return b ? (b.input ?? 0) + (b.output ?? 0) : 0;
}

function short(n) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// Tokens chip: the last reply and today's total, with a breakdown on hover.
function showUsage(last, totals) {
  const today = tokens(totals?.today);
  const lastText = last?.plan ? 'ChatGPT plan' : last ? `${short(last.input + last.output)} last` : '';
  els.tokenChip.textContent = last ? `Tokens: ${lastText} · ${short(today)} today` : `Tokens: ${short(today)} today`;
  const lines = [];
  if (last) {
    lines.push(`Last reply: ${last.input.toLocaleString()} in (${last.cached.toLocaleString()} cached), ${last.output.toLocaleString()} out${last.plan ? ', on your ChatGPT plan (not billed)' : ''}`);
  }
  const memoryToday = tokens({ memory: totals?.today?.memory });
  lines.push(`Today: ${today.toLocaleString()} (memory upkeep ${memoryToday.toLocaleString()})`);
  lines.push(`All time: ${tokens(totals?.total).toLocaleString()}`);
  if (planTokens(totals?.total)) lines.push(`On your ChatGPT plan, not billed: ${planTokens(totals?.today).toLocaleString()} today, ${planTokens(totals?.total).toLocaleString()} all time`);
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

// You talk over the twin: it stops mid-sentence, its bubble keeps only the words it
// got out (ending in a dash), and the server is told how far it got. Returns those
// words, or null if it wasn't saying anything.
function cutTwinOff() {
  const caption = lastCaption;
  if (!caption?.talking()) return null;
  const said = caption.said().trim();
  caption.stop();
  speech.stop();
  if (said) {
    caption.bubble.textContent = `${said.replace(/[\s—–-]+$/, '')}—`;
    caption.bubble.classList.add('cut');
  } else {
    caption.bubble.remove();
  }
  return said;
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
  const cutOff = pendingCut ?? cutTwinOff();
  pendingCut = null;
  sends += 1;
  clearTimeout(draftCheck.timer);
  interrupt();
  speech.unlock();
  hint('');
  addBubble('user', text);

  const bubble = addBubble('twin', '');
  const caption = createCaption(bubble);
  caption.streaming = true;
  const turn = new AbortController();
  currentTurn = turn;
  activity = 'thinking';
  let reply = '';
  let unspoken = '';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, ...(cutOff !== null && { cutOff }) }),
      signal: turn.signal,
    });
    if (!res.ok) throw new Error((await res.json()).error ?? `Server error ${res.status}`);

    for await (const event of readEvents(res)) {
      if (event.type === 'text') {
        // The words show up as they're spoken (see createCaption), not as they arrive.
        reply += event.text;
        unspoken += event.text;
        let cut;
        while ((cut = sentenceEnd(unspoken)) > 0) {
          caption.say(unspoken.slice(0, cut));
          unspoken = unspoken.slice(cut);
        }
      } else if (event.type === 'mood') {
        mood = event;
        showMood();
      } else if (event.type === 'silent') {
        // It chose not to answer.
        caption.stop();
        bubble.classList.add('quiet');
        bubble.textContent = '(no reply)';
        activity = 'idle';
      } else if (event.type === 'refusal') {
        hint('Claude declined to answer that one.');
      } else if (event.type === 'error') {
        caption.stop();
        bubble.classList.add('error');
        bubble.textContent = event.message;
      } else if (event.type === 'done') {
        setBrainChip(event.brain, event.model);
        if (event.usage) showUsage(event.usage, event.totals);
        if (event.fallback) hint(`The backup model answered: ${event.fallback.from} didn't (${event.fallback.reason}).`);
      }
    }
    if (unspoken.trim()) caption.say(unspoken);
    caption.streaming = false;
  } catch (err) {
    caption.streaming = false;
    if (err.name !== 'AbortError') {
      caption.stop();
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

// Subtitles for the twin: a reply's words appear in its bubble as the voice says
// them, not all at once. Each sentence's words are spread over its audio, longer
// words taking a little longer. Without sound they appear at a speaking pace.
const WORDS_PER_SECOND = 2.8;

function createCaption(bubble) {
  let shown = ''; // everything that's been (or is being) said so far
  let queued = ''; // everything it has been given to say
  let stopped = false;
  let latest = 0; // a newer sentence takes over from one still finishing

  function reveal(text, seconds, isCurrent) {
    const id = ++latest;
    const tokens = text.match(/\S+\s*/g) ?? [];
    const weights = tokens.map((t) => t.trim().length + 2);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    // When each word starts, as a fraction of the sentence.
    let at = 0;
    const starts = weights.map((w) => ((at += w) - w) / total);
    const base = shown;
    shown = base + tokens.join('');
    const began = performance.now();
    return new Promise((resolve) => {
      function frame() {
        if (stopped || !isCurrent() || id !== latest) return resolve();
        const progress = (performance.now() - began) / (seconds * 1000);
        const count = starts.filter((t) => t <= progress).length;
        const text = base + tokens.slice(0, count).join('');
        if (text !== bubble.textContent) {
          bubble.textContent = text;
          els.log.scrollTop = els.log.scrollHeight;
        }
        if (count < tokens.length || progress < 1) return requestAnimationFrame(frame);
        resolve();
      }
      frame();
    });
  }

  const caption = {
    bubble,
    streaming: false, // more of the reply may still be coming
    // Whether it's still saying this (so talking now would cut it off).
    talking() {
      return !stopped && bubble.isConnected && (caption.streaming || bubble.textContent.trim().length < queued.trim().length);
    },
    // The words it has got out so far.
    said() {
      return bubble.textContent;
    },
    // Speaks a piece of the reply and shows its words in time with the voice.
    say(text) {
      queued += text;
      speech.say(text, {
        start: (seconds, isCurrent) => {
          if (activity === 'thinking') activity = 'idle';
          reveal(text, seconds, isCurrent);
        },
        silent: (isCurrent) => {
          if (activity === 'thinking') activity = 'idle';
          const words = (text.match(/\S+/g) ?? []).length;
          return reveal(text, Math.max(0.4, words / WORDS_PER_SECOND), isCurrent);
        },
      });
    },
    // An error replaces the bubble's text; nothing more gets revealed after it.
    stop() {
      stopped = true;
    },
  };
  lastCaption = caption;
  return caption;
}

// ---- The twin cutting in while you're still typing or talking -----------------
// Whenever you pause, or have added a few words, the server gets what you've said so
// far and the twin decides whether it would cut you off (usually it lets you finish).
// If it does, your unfinished message ends in a dash and the twin's line follows.
const draftCheck = { timer: null, busy: false, checked: '', lastAt: 0 };
const wordCount = (text) => (text.match(/\S+/g) ?? []).length;

function watchDraft() {
  clearTimeout(draftCheck.timer);
  speech.unlock(); // typing counts as a click, so its voice can play if it cuts in
  const text = els.input.value.trim();
  if (wordCount(text) < 4 || currentTurn || lastCaption?.talking() || twinAway) return;
  if (wordCount(text) - wordCount(draftCheck.checked) >= 7 && Date.now() - draftCheck.lastAt > 4000) return void checkDraft();
  draftCheck.timer = setTimeout(checkDraft, 1400);
}

async function checkDraft() {
  // Only whole words: a half-typed word isn't something it has heard yet.
  const typed = els.input.value;
  const draft = (/[\s.,!?;:]$/.test(typed) ? typed : typed.replace(/\S+$/, '')).trim();
  if (draftCheck.busy || wordCount(draft) < 4 || draft === draftCheck.checked || currentTurn || lastCaption?.talking()) return;
  draftCheck.busy = true;
  draftCheck.checked = draft;
  draftCheck.lastAt = Date.now();
  const before = sends;
  const still = () => sends === before && !currentTurn && els.input.value.trim();
  try {
    const r = await (await fetch('/api/interject', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft }) })).json();
    if (!r.interrupt || !still()) return;
    const ok = await fetch('/api/interject/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: r.token }) });
    if (!ok.ok || !still()) return;
    mic.cancel();
    els.input.value = '';
    draftCheck.checked = '';
    addBubble('user cut', `${draft.replace(/[\s—–-]+$/, '')}—`);
    if (r.mood) {
      mood = r.mood;
      showMood();
    }
    if (r.totals) showUsage(null, r.totals);
    createCaption(addBubble('twin', '')).say(r.line);
  } catch {
    // A failed check just means it lets you finish.
  } finally {
    draftCheck.busy = false;
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

  // Queues a sentence. `hooks.start(seconds, isCurrent)` runs as its audio begins, and
  // `hooks.silent(isCurrent)` (which should wait about as long as saying it would take)
  // runs instead when there's no sound: not allowed yet, or the voice failed.
  function say(text, hooks = {}) {
    const gen = generation;
    const isCurrent = () => gen === generation;
    const audible = ctx?.state === 'running';
    const audio = audible
      ? fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        })
          .then(async (r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error((await r.json()).error))))
          .then((buf) => ctx.decodeAudioData(buf))
      : Promise.resolve(null);
    audio.catch(() => {}); // reported when its turn comes in the chain
    chain = chain.then(async () => {
      if (!isCurrent()) return;
      let buffer = null;
      try {
        buffer = await audio;
      } catch (err) {
        onError(err);
      }
      if (!isCurrent()) return;
      if (!buffer) return hooks.silent?.(isCurrent);
      hooks.start?.(buffer.duration, isCurrent);
      await play(buffer);
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

  return { unlock, say, stop, level };
}

// Browser speech recognition (Chrome and Safari). Click to talk; it sends
// when you stop speaking.
function setupMic() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    els.mic.hidden = true;
    hint('Voice input needs Chrome or Safari. You can type instead.');
    return { cancel() {} };
  }
  const rec = new Recognition();
  rec.lang = 'en-US';
  rec.interimResults = true;
  let listening = false;
  let heard = '';

  rec.onresult = (e) => {
    heard = Array.from(e.results, (r) => r[0].transcript).join('');
    els.input.value = heard;
    watchDraft(); // it can cut you off mid-sentence here too
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
    } else {
      pendingCut = null;
      if (els.hint.textContent === 'Listening…') hint('');
    }
    heard = '';
  };
  els.mic.addEventListener('click', () => {
    if (listening) return rec.stop();
    pendingCut = cutTwinOff(); // talking over it
    interrupt();
    speech.unlock();
    heard = '';
    rec.start();
    activity = 'listening';
    listening = true;
    els.mic.classList.add('on');
    hint('Listening…');
  });
  // The twin cut you off: stop listening and drop what was heard.
  return {
    cancel() {
      if (!listening) return;
      heard = '';
      rec.abort();
    },
  };
}
