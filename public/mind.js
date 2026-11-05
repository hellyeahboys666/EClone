// The Mind page: edit the twin's persona notes, rules and memories, and reset its
// mood or conversation. Everything goes through the server (/api/mind), so edits
// are safe while the twin is running.

import { DAYS, DAY_NAMES, NOTICE_OPTIONS, PRESETS, clock, currentActivity, nextActivity } from './schedule-config.js';

const view = document.getElementById('view');
const statusEl = document.getElementById('status');
let state = null;
let tab = 'persona';
let openNote = null;
let search = '';
let draft = null; // the schedule being edited, saved with the Save button

// Small helper for building elements: h('button', { class: 'btn', onclick }, 'Save').
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key in el && key !== 'list') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

function say(text, error = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', error);
  clearTimeout(say.timer);
  if (!error) say.timer = setTimeout(() => (statusEl.textContent = ''), 2500);
}

async function load() {
  const res = await fetch('/api/mind');
  state = await res.json();
  document.getElementById('title').textContent = `${state.name}'s mind`;
  document.title = `Mind · ${state.name}`;
  render();
}

async function change(action, body = {}, done = 'Saved. It applies on the next message.') {
  try {
    const res = await fetch('/api/mind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
    state = data;
    say(done);
    render();
    return true;
  } catch (err) {
    say(`Couldn't save: ${err.message}`, true);
    return false;
  }
}

for (const button of document.querySelectorAll('[data-tab]')) {
  button.addEventListener('click', () => {
    tab = button.dataset.tab;
    if (tab === 'schedule') draft = null; // start from what's saved
    for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b === button));
    render();
  });
}

function render() {
  if (!state) return;
  const views = { persona: personaView, rules: rulesView, memories: memoriesView, schedule: scheduleView, state: stateView };
  view.replaceChildren(views[tab]());
}

// ---- Persona notes ---------------------------------------------------------------

function personaView() {
  const notes = state.persona;
  if (!notes.some((n) => n.name === openNote)) openNote = notes.find((n) => n.name !== 'README.md')?.name ?? notes[0]?.name ?? null;
  const current = notes.find((n) => n.name === openNote);
  const list = h('div', { class: 'notes' },
    notes.map((n) => h('button', { type: 'button', 'aria-current': String(n.name === openNote), onclick: () => { openNote = n.name; render(); } },
      n.name, n.name === 'README.md' ? h('small', {}, 'Guide, not sent to the twin') : null)),
  );
  const newName = h('input', { type: 'text', placeholder: '05-music.md', 'aria-label': 'New note name' });
  const add = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    let name = newName.value.trim();
    if (name && !name.endsWith('.md')) name += '.md';
    if (notes.some((n) => n.name === name)) return say('There is already a note with that name.', true);
    if (await change('savePersona', { name, text: `# ${name.replace(/\.md$/, '').replace(/^\d+-/, '')}\n\n` }, 'Note added.')) {
      openNote = name;
      render();
    }
  } }, h('label', { class: 'muted' }, 'Add a note'), h('div', { class: 'row' }, newName, h('button', { class: 'btn', type: 'submit' }, 'Add')));

  const side = h('div', { class: 'stack' }, list, add);
  if (!current) return h('div', { class: 'split' }, side, h('div', { class: 'card' }, h('p', { class: 'muted' }, 'No notes yet. Add one on the left, or run npm run setup to start from the template.')));

  const editor = h('textarea', { class: 'editor', value: current.text, spellcheck: true, 'aria-label': current.name });
  const save = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: () => change('savePersona', { name: current.name, text: editor.value }) }, 'Save');
  editor.addEventListener('input', () => (save.disabled = editor.value === current.text));
  const remove = h('button', { class: 'btn danger', type: 'button', onclick: () => {
    if (confirm(`Delete ${current.name}? The twin will stop knowing what's in it.`)) change('deletePersona', { name: current.name }, 'Note deleted.');
  } }, 'Delete note');
  return h('div', { class: 'split' }, side, h('div', { class: 'stack' },
    h('p', { class: 'muted' }, current.name === 'README.md'
      ? 'This guide explains what to write. It is not sent to the twin.'
      : 'Write in the first person, the way they would describe themselves. Facts, how they talk, opinions, people, stories.'),
    editor,
    h('div', { class: 'row' }, save, remove),
  ));
}

// ---- Rules -------------------------------------------------------------------------

function rulesView() {
  const editor = h('textarea', { class: 'editor', value: state.rules, spellcheck: true, 'aria-label': 'rules.md' });
  const save = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: () => change('saveRules', { text: editor.value }) }, 'Save');
  editor.addEventListener('input', () => (save.disabled = editor.value === state.rules));
  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'How any twin behaves: how to talk, time and memory, feelings, honesty. These rules come before the persona notes.'),
    editor,
    h('div', { class: 'row' }, save),
  );
}

// ---- Memories ----------------------------------------------------------------------

function memoriesView() {
  const all = [...state.memories].sort((a, b) => b.date.localeCompare(a.date) || b.lastRecalled - a.lastRecalled);
  const shown = search ? all.filter((m) => m.text.toLowerCase().includes(search.toLowerCase())) : all;

  const find = h('input', { type: 'search', placeholder: 'Search memories', value: search, 'aria-label': 'Search memories' });
  find.addEventListener('input', () => {
    search = find.value;
    const at = find.selectionStart;
    render();
    const again = view.querySelector('input[type="search"]');
    again.focus();
    again.setSelectionRange(at, at);
  });

  const text = h('textarea', { placeholder: 'Sam told me they start a new job on Monday, December 7.', rows: 2, 'aria-label': 'New memory' });
  const importance = importancePicker(5);
  const date = h('input', { type: 'date', value: new Date().toLocaleDateString('en-CA'), 'aria-label': 'Date' });
  const add = h('form', { class: 'card stack', onsubmit: async (e) => {
    e.preventDefault();
    if (await change('addMemory', { text: text.value, importance: importance.value, date: date.value }, 'Memory added.')) text.value = '';
  } },
  h('strong', {}, 'Add a memory'),
  h('p', { class: 'muted' }, 'Write it the way the twin would remember it, in the first person.'),
  text,
  h('div', { class: 'row' }, h('label', { class: 'muted' }, 'Importance'), importance, date, h('button', { class: 'btn', type: 'submit' }, 'Add')));

  const items = shown.map((m) => {
    const editor = h('textarea', { value: m.text, rows: 2, 'aria-label': `Memory from ${m.date}` });
    const imp = importancePicker(m.importance);
    const save = h('button', { class: 'btn', type: 'button', disabled: true, onclick: () => change('updateMemory', { id: m.id, text: editor.value, importance: imp.value }, 'Memory updated.') }, 'Save');
    const dirty = () => (save.disabled = editor.value === m.text && Number(imp.value) === m.importance);
    editor.addEventListener('input', dirty);
    imp.addEventListener('change', dirty);
    return h('div', { class: 'card memory' },
      h('div', { class: 'meta' },
        h('span', {}, m.date),
        h('span', { class: `badge ${m.kind}` }, m.kind === 'impression' ? 'impression' : 'memory'),
        h('span', {}, m.recalls ? `recalled ${m.recalls}×` : 'not recalled yet')),
      editor,
      h('div', { class: 'side' }, imp, save, h('button', { class: 'btn danger', type: 'button', onclick: () => {
        if (confirm('Forget this memory?')) change('deleteMemory', { id: m.id }, 'Forgotten.');
      } }, 'Forget')),
    );
  });

  const forget = h('button', { class: 'btn danger', type: 'button', disabled: !all.length, onclick: () => {
    if (confirm(`Forget all ${all.length} memories? This can't be undone. The current chat stays.`)) change('forgetAll', {}, 'All memories forgotten.');
  } }, 'Forget everything');

  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, `${all.length} memories. Importance 9–10 means always on its mind (like a name); small ones fade and turn fuzzy over time. Impressions are hunches it formed by itself.`),
    add,
    h('div', { class: 'row' }, find, search ? h('span', { class: 'muted' }, `${shown.length} match`) : null),
    items.length ? items : h('p', { class: 'muted' }, search ? 'No memories match.' : 'No memories yet. They form as you talk.'),
    h('div', { class: 'row' }, forget),
  );
}

function importancePicker(value) {
  const select = h('select', { class: 'importance', 'aria-label': 'Importance from 1 to 10' });
  for (let i = 1; i <= 10; i++) select.add(new Option(String(i), String(i), false, i === value));
  return select;
}

// ---- Schedule ------------------------------------------------------------------------

function scheduleView() {
  draft ??= structuredClone(state.schedule);
  const name = state.name;
  const now = currentActivity(draft);
  const next = nextActivity(draft);
  const status = now
    ? `Right now ${name} is ${now.activity.where === 'away' ? 'out at' : 'at home,'} ${now.activity.name} until ${clock(now.end)}.`
    : `Right now ${name} is free.`;
  const when = (d) => (d.toDateString() === new Date().toDateString() ? 'today' : d.toDateString() === new Date(Date.now() + 86_400_000).toDateString() ? 'tomorrow' : d.toLocaleDateString('en-US', { weekday: 'long' }));
  const upcoming = next ? ` Next: ${next.activity.name} at ${clock(next.start)} ${when(next.start)}.` : '';

  const save = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
    if (await change('saveSchedule', { schedule: draft }, 'Schedule saved. The twin follows it from now on.')) draft = structuredClone(state.schedule), render();
  } }, 'Save schedule');
  const presets = h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Add:'),
    PRESETS.map((p) => h('button', { class: 'btn', type: 'button', onclick: () => { draft.activities.push({ ...structuredClone(p), id: newId() }); render(); } }, p.name)),
    h('button', { class: 'btn', type: 'button', onclick: () => { draft.activities.push({ id: newId(), name: 'Something', note: '', days: ['sat'], start: '10:00', end: '12:00', where: 'home', busy: false, notice: 0 }); render(); } }, 'Other'));

  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, `What ${name} does during the week, using this computer's clock. While busy, replies are short (like "at work, talk later"). While out, the avatar isn't in the house. Before going out, ${name} can say it's leaving, while the page is open.`),
    h('div', { class: 'card' }, h('p', {}, status + upcoming)),
    presets,
    draft.activities.length ? draft.activities.map(activityCard) : h('p', { class: 'muted' }, 'No schedule yet, so the twin is always free. Add something above.'),
    h('div', { class: 'row' }, save, h('span', { class: 'muted' }, 'Changes here take effect when you save.')),
  );
}

function activityCard(a) {
  const field = (label, input) => h('label', { class: 'field' }, h('span', { class: 'muted' }, label), input);
  const nameIn = h('input', { type: 'text', value: a.name, 'aria-label': 'Activity name', oninput: (e) => (a.name = e.target.value) });
  const noteIn = h('input', { type: 'text', value: a.note, placeholder: 'at the bike shop', oninput: (e) => (a.note = e.target.value) });
  const days = h('div', { class: 'days' }, DAYS.map((d) => {
    const box = h('input', { type: 'checkbox', checked: a.days.includes(d), onchange: (e) => {
      a.days = e.target.checked ? [...a.days, d] : a.days.filter((x) => x !== d);
    } });
    return h('label', { class: 'day' }, box, DAY_NAMES[d]);
  }));
  const start = h('input', { type: 'time', value: a.start, onchange: (e) => (a.start = e.target.value) });
  const end = h('input', { type: 'time', value: a.end, onchange: (e) => (a.end = e.target.value) });
  const where = h('select', { onchange: (e) => { a.where = e.target.value; render(); } });
  where.add(new Option('At home', 'home', false, a.where === 'home'));
  where.add(new Option('Out (not in the house)', 'away', false, a.where === 'away'));
  const busy = h('input', { type: 'checkbox', checked: a.busy, onchange: (e) => (a.busy = e.target.checked) });
  const notice = h('select', { disabled: a.where !== 'away', onchange: (e) => (a.notice = Number(e.target.value)) });
  for (const n of NOTICE_OPTIONS) notice.add(new Option(n ? `${n} min before` : "Don't announce", String(n), false, a.notice === n));
  return h('div', { class: 'card stack activity' },
    h('div', { class: 'row' }, field('Activity', nameIn), field('Where or what (optional)', noteIn)),
    h('div', { class: 'row' }, field('Days', days)),
    h('div', { class: 'row' }, field('From', start), field('To', end), field('Where', where),
      h('label', { class: 'field inline' }, busy, h('span', {}, 'Busy (short replies)')),
      field('Say it is leaving', notice)),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, a.end <= a.start ? 'Ends the next morning.' : ''),
      h('button', { class: 'btn danger', type: 'button', onclick: () => { draft.activities = draft.activities.filter((x) => x !== a); render(); } }, 'Remove')),
  );
}

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

// ---- Mood and conversation ---------------------------------------------------------

function stateView() {
  const m = state.mood;
  const hours = (Date.now() - m.at) / 3_600_000;
  const level = m.intensity * 0.5 ** (hours / (m.halfLifeHours || 2));
  const feeling = m.feeling === 'calm' || level < 1.5 ? 'calm' : `${m.feeling}, about ${Math.round(level)}/10${m.reason ? ` (${m.reason})` : ''}`;
  return h('div', { class: 'stack' },
    h('div', { class: 'card stack' },
      h('strong', {}, 'Mood'),
      h('p', {}, `Right now: ${feeling}.`),
      h('p', { class: 'muted' }, 'Feelings fade by half every two hours on their own.'),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => change('resetMood', {}, 'Back to calm.') }, 'Reset to calm')),
    ),
    h('div', { class: 'card stack' },
      h('strong', {}, 'Current chat'),
      h('p', {}, `${state.conversation} messages in the current chat.`),
      h('p', { class: 'muted' }, 'New chat on the main page saves what mattered to memory first. Clearing here throws the chat away without remembering it.'),
      h('div', { class: 'row' }, h('button', { class: 'btn danger', type: 'button', disabled: !state.conversation, onclick: () => {
        if (confirm('Clear the current chat without remembering it?')) change('clearConversation', {}, 'Chat cleared.');
      } }, 'Clear without remembering')),
    ),
  );
}

load().catch((err) => say(`Couldn't load: ${err.message}`, true));
