// The "Build from everything" tab of the Mind page: give it everything about the
// person (chats, their writing, their answers, what others say about them), let the
// AI analyze it into persona notes, review and use them, and test how accurate the
// clone is against real messages it has never seen. Talks to /api/sources.

export function createBuildTab({ h, say, onApplied }) {
  const root = h('div', { class: 'stack build' });
  let data = null; // from GET /api/sources
  let edits = {}; // draft file -> edited text
  let openDraft = null;
  let poll = null;
  const pasteText = h('textarea', { rows: 5, placeholder: 'Paste anything: a chat, something they wrote, their answers to questions, or what someone who knows them says about them.', 'aria-label': 'Pasted text' });
  const pasteKind = h('select', { 'aria-label': 'What the pasted text is' });

  async function load() {
    data = await (await fetch('/api/sources')).json();
    if (data.build && !data.build.finished) follow();
    render();
  }

  async function act(action, body = {}, done = '') {
    try {
      const res = await fetch('/api/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) });
      const next = await res.json();
      if (!res.ok) throw new Error(next.error ?? `Server error ${res.status}`);
      data = next;
      if (done) say(done);
      if (data.build && !data.build.finished) follow();
      render();
      return true;
    } catch (err) {
      say(err.message, true);
      return false;
    }
  }

  // While an analysis or test runs, check on it every second and a half.
  function follow() {
    if (poll) return;
    poll = setInterval(async () => {
      const next = await (await fetch('/api/sources').catch(() => null))?.json().catch(() => null);
      if (!next) return;
      const was = data.build;
      data = next;
      if (data.build?.finished) {
        clearInterval(poll);
        poll = null;
        if (data.build.error) say(data.build.error, true);
        else if (was?.kind === 'analyze') {
          edits = {};
          openDraft = data.analysis?.drafts[0]?.file ?? null;
          say('Done. Review the notes below, then use them.');
        } else say('Accuracy test done.');
      }
      render();
    }, 1500);
  }

  async function addFiles(files) {
    for (const file of files) {
      if (file.size > 20_000_000) {
        say(`${file.name} is too big (the limit is 20 MB). Split it, or export a shorter period.`, true);
        continue;
      }
      await act('add', { name: file.name, text: await file.text() }, `Added ${file.name}.`);
    }
  }

  const name = () => data?.name ?? 'them';
  const busy = () => Boolean(data?.build && !data.build.finished);

  function consentCard() {
    if (data.consent?.agreed) {
      return h('p', { class: 'muted' }, `✓ ${name()} agreed to this (${new Date(data.consent.at).toLocaleDateString()}). `,
        h('button', { class: 'btn small-link', type: 'button', onclick: () => confirm('Withdraw consent? Nothing new can be added or analyzed until it is given again.') && act('consent', { agreed: false }) }, 'Withdraw'));
    }
    const box = h('input', { type: 'checkbox', id: 'consent' });
    const button = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: () => act('consent', { agreed: true }, 'Thanks. Now add everything you have.') }, 'Confirm');
    box.addEventListener('change', () => (button.disabled = !box.checked));
    return h('div', { class: 'card stack consent' },
      h('strong', {}, 'First: consent'),
      h('label', { htmlFor: 'consent', class: 'row' }, box, `${name()} agreed to have a clone made, and to this material being used to build it. They know what it can do and can ask for it to be deleted.`),
      h('div', { class: 'row' }, button));
  }

  function sourcesCard() {
    const disabled = !data.consent?.agreed;
    const input = h('input', { type: 'file', multiple: true, accept: '.txt,.md,.json,.csv,.html,.htm', hidden: true, onchange: () => addFiles([...input.files]).then(() => (input.value = '')) });
    const drop = h('div', { class: `drop${disabled ? ' off' : ''}`, tabIndex: 0, onclick: () => !disabled && input.click(), onkeydown: (e) => !disabled && (e.key === 'Enter' || e.key === ' ') && input.click() },
      h('strong', {}, 'Drop files here, or click to choose'),
      h('span', { class: 'muted' }, 'Chat exports (WhatsApp .txt, Discord, Instagram or Messenger .json, Telegram, CSV), notes, essays, posts, transcripts. Up to 20 MB each.'));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (!disabled) addFiles([...e.dataTransfer.files]); });

    if (!pasteKind.options.length) for (const [k, label] of Object.entries(data.kinds)) pasteKind.add(new Option(k === 'chat' ? 'A chat (Name: message lines)' : label, k));
    const paste = h('div', { class: 'stack' }, pasteText,
      h('div', { class: 'row' }, h('label', { class: 'muted' }, 'This is'), pasteKind,
        h('button', { class: 'btn', type: 'button', disabled, onclick: async () => {
          if (await act('add', { name: `Pasted ${pasteKind.selectedOptions[0].text.toLowerCase()}`, text: pasteText.value, kind: pasteKind.value }, 'Added.')) pasteText.value = '';
        } }, 'Add')));

    const rows = data.sources.map((s) => {
      const what = s.format === 'chat'
        ? h('span', {}, `Chat · ${s.messages.toLocaleString()} messages`)
        : (() => {
            const select = h('select', { 'aria-label': `What ${s.name} is`, onchange: () => act('update', { id: s.id, kind: select.value }) });
            for (const [k, label] of Object.entries(data.kinds)) if (k !== 'chat') select.add(new Option(label, k, false, k === s.kind));
            return select;
          })();
      const who = s.format === 'chat'
        ? (() => {
            const select = h('select', { class: s.speaker ? '' : 'needs', 'aria-label': `Which speaker is ${name()} in ${s.name}`, onchange: () => act('update', { id: s.id, speaker: select.value }) });
            select.add(new Option(`Which one is ${name()}?`, '', false, !s.speaker));
            for (const p of s.speakers) select.add(new Option(`${p.name} (${p.count})`, p.name, false, p.name === s.speaker));
            return select;
          })()
        : h('span', {});
      return h('div', { class: 'source' },
        h('span', { class: 'source-name', title: s.name }, s.name),
        what, who,
        h('span', { class: 'muted' }, `${s.words.toLocaleString()} words`),
        h('button', { class: 'btn danger', type: 'button', 'aria-label': `Remove ${s.name}`, onclick: () => confirm(`Remove ${s.name}?`) && act('remove', { id: s.id }) }, 'Remove'));
    });
    const words = data.sources.reduce((n, s) => n + s.words, 0);
    return h('div', { class: `card stack${disabled ? ' off' : ''}` },
      h('strong', {}, '1. Add everything you have about them'),
      h('p', { class: 'muted' }, 'The more real material, the more accurate the clone. Best: long chats where they talk a lot (that is how it learns how they really text). Then anything they wrote, their answers to questions, and what people close to them say about them.'),
      drop, input, paste,
      rows.length ? h('div', { class: 'stack sources' }, rows, h('p', { class: 'muted' }, `${words.toLocaleString()} words from ${rows.length} source${rows.length === 1 ? '' : 's'}.`)) : null);
  }

  function progress(kind) {
    const b = data.build;
    if (!b || b.kind !== kind) return null;
    if (b.finished) return b.error ? h('p', { class: 'error-text' }, b.error) : null;
    const pct = b.total ? Math.round((100 * b.done) / b.total) : 0;
    return h('div', { class: 'stack' },
      h('p', { class: 'muted' }, `${b.step}${b.total ? ` · ${b.done} of ${b.total}` : ''}…`),
      h('div', { class: 'progress' }, h('div', { style: `width: ${pct}%` })));
  }

  function analyzeCard() {
    const missing = data.sources.filter((s) => s.format === 'chat' && !s.speaker).length;
    return h('div', { class: 'card stack' },
      h('strong', {}, '2. Analyze'),
      h('p', { class: 'muted' }, `The clone's brain reads everything and works out who ${name()} is: facts, how they talk (measured from their real messages), temper, opinions, people and stories, each backed by what they actually said. Then it writes the persona notes. A lot of material takes a few minutes.`),
      missing ? h('p', { class: 'error-text' }, `In ${missing === 1 ? 'one chat' : `${missing} chats`}, pick which speaker is ${name()}.`) : null,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', disabled: busy() || !data.sources.length || missing > 0 || !data.consent?.agreed, onclick: () => act('analyze') }, data.analysis ? 'Analyze again' : 'Analyze')),
      progress('analyze'));
  }

  function reviewCard() {
    const a = data.analysis;
    if (!a) return null;
    if (!a.drafts.some((d) => d.file === openDraft)) openDraft = a.drafts[0]?.file;
    const current = a.drafts.find((d) => d.file === openDraft);
    const editor = current ? h('textarea', { class: 'editor', value: edits[current.file] ?? current.text, 'aria-label': current.file, oninput: () => (edits[current.file] = editor.value) }) : null;
    const s = a.stats;
    return h('div', { class: 'card stack' },
      h('strong', {}, '3. Review and use'),
      h('p', { class: 'muted' }, `Analyzed ${new Date(a.builtAt).toLocaleString()}: ${a.counts.sources} sources, ${a.counts.findings} findings${a.counts.myMessages ? `, ${a.counts.myMessages.toLocaleString()} of their own messages` : ''}. ${a.appliedAt ? `In use since ${new Date(a.appliedAt).toLocaleString()}.` : 'Not in use yet.'}`),
      s ? h('p', { class: 'muted' }, `How they text: typically ${s.medianWords} words, ${s.lowercaseStart}% start lowercase, ${s.endsWithPeriod}% end with a period, ${s.emojiShare}% have an emoji${s.topPhrases.length ? `, often say ${s.topPhrases.slice(0, 4).map((p) => `"${p.text}"`).join(', ')}` : ''}.`) : null,
      h('div', { class: 'draft-tabs row' }, a.drafts.map((d) => h('button', { type: 'button', class: `btn${d.file === openDraft ? ' on' : ''}`, onclick: () => { openDraft = d.file; render(); } }, d.file, edits[d.file] !== undefined ? ' •' : ''))),
      editor,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', disabled: busy(), onclick: async () => {
          if (!confirm(`Use these ${a.drafts.length} notes as ${name()}'s persona? Notes with the same names are replaced (the current ones are backed up first in persona-backups/). Other notes stay.`)) return;
          const drafts = a.drafts.map((d) => ({ file: d.file, text: edits[d.file] ?? d.text }));
          if (await act('apply', { drafts }, 'In use now. Run the accuracy test to see how close it is.')) {
            edits = {};
            onApplied?.();
          }
        } }, a.appliedAt ? 'Use these notes again' : 'Use these notes')),
      a.gaps.length
        ? h('div', { class: 'stack gaps' },
            h('strong', {}, `To make it more accurate, ask ${name()}:`),
            h('ol', {}, a.gaps.map((q) => h('li', {}, q))),
            h('p', { class: 'muted' }, 'Paste their answers above as "Their answers to questions", then analyze again.'))
        : null);
  }

  function testCard() {
    const a = data.analysis;
    if (!a) return null;
    const latest = data.tests[0];
    return h('div', { class: 'card stack' },
      h('strong', {}, '4. Test how accurate it is'),
      a.held
        ? h('p', { class: 'muted' }, `The clone answers ${a.held} real messages it has never seen (kept out of the notes on purpose). Each answer is scored against what ${name()} really replied. It tests the notes in use now.`)
        : h('p', { class: 'muted' }, 'Add chats with them in it and analyze again: the test needs real replies to compare with.'),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', disabled: busy() || !a.held || !a.appliedAt, title: a.appliedAt ? '' : 'Use the notes first', onclick: () => act('test') }, 'Test accuracy')),
      progress('test'),
      latest
        ? h('div', { class: 'stack' },
            h('div', { class: 'scores row' },
              h('span', { class: 'score' }, h('b', {}, `${latest.style}`), '/10 sounds like them'),
              h('span', { class: 'score' }, h('b', {}, `${latest.substance}`), '/10 says what they would'),
              data.tests.length > 1 ? h('span', { class: 'muted' }, `Earlier: ${data.tests.slice(1).map((t) => `${t.style}/${t.substance}`).join(', ')}`) : null),
            latest.summary ? h('p', {}, latest.summary) : null,
            h('details', {}, h('summary', {}, 'Every answer'),
              h('div', { class: 'stack' }, latest.items.map((it) => h('div', { class: 'test-item' },
                h('div', {}, h('span', { class: 'muted' }, 'They: '), it.they),
                h('div', {}, h('span', { class: 'muted' }, 'Really: '), it.real),
                h('div', {}, h('span', { class: 'muted' }, 'Clone: '), it.clone || '(no reply)'),
                h('div', { class: 'muted' }, `${it.style}/${it.substance}${it.note ? ` · ${it.note}` : ''}`))))))
        : null);
  }

  function render() {
    if (!data) return;
    const scroll = window.scrollY;
    root.replaceChildren(...[
      h('p', { class: 'muted' }, `The most accurate clone comes from real material. Give it everything you have about ${name()}, and it builds the persona notes from that.`),
      consentCard(),
      sourcesCard(),
      analyzeCard(),
      reviewCard(),
      testCard(),
    ].filter(Boolean));
    window.scrollTo(0, scroll);
  }

  return {
    view() {
      if (!data) load().catch((err) => say(`Couldn't load: ${err.message}`, true));
      else render();
      return root;
    },
  };
}
