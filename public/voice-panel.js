// The Voice panel (click the Voice chip): set up an ElevenLabs voice without
// touching .env. Paste the API key once, pick a voice from your account (clones
// first, each with a free preview), try it, and save. The twin uses it right away.
// The key is sent to this Mac's server only and never comes back to the page.
export function createVoicePanel({ button, panel, onChange, onOpen }) {
  let state = null; // from GET /api/voice
  let voices = null; // the account's voices, once listed
  let chosen = null; // { id, name }
  let filter = '';
  let busy = '';
  let message = { text: '', error: false };
  let preview = null; // the Audio playing a preview or a try
  let changingKey = false; // showing the key field although a key is saved

  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (key === 'class') el.className = value;
      else if (key in el) el[key] = value;
      else el.setAttribute(key, value === true ? '' : value);
    }
    el.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
    return el;
  }

  const keyInput = h('input', { type: 'password', id: 'voice-key', autocomplete: 'off', spellcheck: false });
  const modelSelect = h('select', { id: 'voice-model' });

  async function call(url, body) {
    const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `Error ${response.status}`);
    return response;
  }
  const say = (text, error = false) => {
    message = { text, error };
    render();
  };

  async function load() {
    state = await (await call('/api/voice')).json();
    if (state.voiceId && !chosen) chosen = { id: state.voiceId, name: state.voiceName || 'your saved voice' };
    render();
  }

  async function listVoices() {
    busy = 'list';
    say('Looking up your voices…');
    try {
      const found = await (await call('/api/voice/voices', { key: keyInput.value })).json();
      voices = found.voices;
      if (found.models.length) setModels(found.models);
      busy = '';
      if (chosen) chosen = voices.find((v) => v.id === chosen.id) ?? chosen;
      say(voices.length ? (voices.some((v) => v.mine) ? 'Your own voices are at the top.' : "No voices of your own yet, only ElevenLabs' voices. See below to make one.") : 'This account has no voices yet.');
    } catch (err) {
      busy = '';
      say(err.message, true);
    }
  }

  function play(src) {
    preview?.pause();
    preview = new Audio(src);
    preview.play().catch(() => {});
  }

  async function tryVoice() {
    busy = 'try';
    say('Speaking…');
    try {
      const blob = await (await call('/api/voice/try', { key: keyInput.value, voiceId: chosen.id, model: modelSelect.value })).blob();
      busy = '';
      play(URL.createObjectURL(blob));
      say('Like it? Save it to use it.');
    } catch (err) {
      busy = '';
      say(err.message, true);
    }
  }

  async function save(body) {
    busy = 'save';
    render();
    try {
      state = await (await call('/api/voice', body)).json();
      keyInput.value = '';
      changingKey = false;
      busy = '';
      onChange?.(state);
      say(state.using === 'elevenlabs' ? `Saved. ${state.voiceName || 'This voice'} is the twin's voice now.` : 'Switched to the Mac voice. Your ElevenLabs key is still saved.');
    } catch (err) {
      busy = '';
      say(err.message, true);
    }
  }

  function voiceRows() {
    const q = filter.toLowerCase();
    return h('ul', { class: 'voice-list' },
      voices.filter((v) => !q || `${v.name} ${v.about} ${v.kind}`.toLowerCase().includes(q)).map((v) =>
        h('li', { class: chosen?.id === v.id ? 'chosen' : '' },
          h('button', { type: 'button', class: 'voice-pick', 'aria-pressed': String(chosen?.id === v.id), onclick: () => { chosen = v; render(); } },
            h('span', { class: 'voice-name' }, v.name),
            h('span', { class: 'voice-about' }, [v.kind, v.about].filter(Boolean).join(' · '))),
          v.preview ? h('button', { type: 'button', class: 'small', title: `Hear ${v.name} (free)`, 'aria-label': `Hear ${v.name}`, onclick: () => play(v.preview) }, '▶') : null)));
  }
  function voiceList() {
    const search = voices.length > 10
      ? h('input', { type: 'search', class: 'voice-search', placeholder: 'Search voices', value: filter, oninput: (e) => { filter = e.target.value; panel.querySelector('.voice-list').replaceWith(voiceRows()); } })
      : null;
    return [search, voiceRows()];
  }

  // The model list: the account's own once known, always keeping the current pick.
  function setModels(models) {
    const keep = modelSelect.value || state.model;
    const list = models.some(([id]) => id === keep) ? models : [[keep, keep], ...models];
    modelSelect.replaceChildren(...list.map(([id, text]) => new Option(text, id, false, id === keep)));
  }

  function render() {
    if (!state) return;
    const using = state.using === 'elevenlabs';
    const known = state.models.find(([id]) => id === state.model);
    const modelName = known && known[1] !== state.model ? known[1].split(':')[0] : state.model.replace(/^eleven_/, '').replace(/_/g, ' ');
    keyInput.placeholder = state.hasKey ? 'Saved (paste a new one to replace it)' : 'Paste your ElevenLabs API key';
    if (!modelSelect.options.length) setModels(state.models);

    const showKey = !state.hasKey || changingKey;
    const listScroll = panel.querySelector('.voice-list')?.scrollTop ?? 0;
    panel.replaceChildren(
      h('div', { class: 'house-head' }, h('h2', {}, 'Voice'), h('button', { type: 'button', class: 'house-close', onclick: () => toggle(false) }, 'Close')),
      h('div', { class: 'card stack' },
        h('p', { class: 'voice-now' }, 'Speaking with: ', h('strong', {}, using ? `${state.voiceName || 'an ElevenLabs voice'} (ElevenLabs, ${modelName})` : state.macWorks ? "this Mac's built-in voice" : 'no voice (text only)')),
        using && state.macWorks ? h('button', { type: 'button', class: 'small', disabled: Boolean(busy), onclick: () => save({ use: 'mac' }) }, 'Use the Mac voice instead') : null),
      h('div', { class: 'stack voice-steps' },
        showKey
          ? [
              h('label', { htmlFor: 'voice-key', class: 'voice-step' }, '1. ElevenLabs API key'),
              keyInput,
              h('p', { class: 'house-help' }, 'On ', h('a', { href: 'https://elevenlabs.io/app/developers/api-keys', target: '_blank', rel: 'noopener' }, 'elevenlabs.io'), ', open Developers → API keys and create one. It stays on this computer, in .env.'),
            ]
          : h('div', { class: 'voice-key-saved' }, h('span', { class: 'voice-step' }, '1. API key saved ✓'), h('button', { type: 'button', class: 'small', onclick: () => { changingKey = true; render(); keyInput.focus(); } }, 'Change')),
        h('button', { type: 'button', disabled: Boolean(busy), onclick: listVoices }, busy === 'list' ? 'Looking…' : voices ? 'Refresh my voices' : 'Show my voices'),
        voices ? [h('div', { class: 'voice-step' }, '2. Pick a voice'), ...voiceList()] : null,
        voices && !voices.some((v) => v.mine)
          ? h('p', { class: 'house-help' }, 'To sound like the person, make a clone on ElevenLabs under Voices → Add a voice. They should record it and agree to it themselves. Then click Refresh my voices.')
          : null,
        chosen ? [h('label', { htmlFor: 'voice-model', class: 'voice-step' }, `${voices ? 3 : 2}. Speed and quality`), modelSelect] : null),
      // Pinned to the bottom, so Try and Save never need scrolling to.
      (chosen || message.text) && h('div', { class: 'voice-footer' },
        chosen
          ? [
              h('p', { class: 'voice-chosen' }, 'Chosen: ', h('strong', {}, chosen.name)),
              h('div', { class: 'voice-actions' },
                h('button', { type: 'button', disabled: Boolean(busy), title: 'Says one line in this voice (uses a few ElevenLabs credits)', onclick: tryVoice }, busy === 'try' ? 'Speaking…' : 'Try it'),
                h('button', { type: 'button', class: 'primary', disabled: Boolean(busy), onclick: () => save({ key: keyInput.value, voiceId: chosen.id, voiceName: chosen.name, model: modelSelect.value }) }, busy === 'save' ? 'Saving…' : 'Save and use it')),
            ]
          : null,
        h('p', { class: `house-status${message.error ? ' error' : ''}`, role: 'status' }, message.text)),
    );
    const list = panel.querySelector('.voice-list');
    if (list) list.scrollTop = listScroll;
  }

  function toggle(open = panel.hidden) {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      onOpen?.();
      if (!state) load().catch((err) => say(err.message, true));
      else render();
    } else preview?.pause();
  }
  button.addEventListener('click', () => toggle());
  return { close: () => !panel.hidden && toggle(false) };
}
