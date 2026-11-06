#!/usr/bin/env node
// First-time setup: npm run setup
// Asks a few questions, tests the API key, and writes .env. Safe to run again to
// change settings; anything you don't change stays as it is. Needs no packages.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { readEnvFile, updateEnvFile } from '../env-file.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV = path.join(ROOT, '.env');
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const ok = (s) => console.log(`  \x1b[32m✓\x1b[0m ${s}`);
const warn = (s) => console.log(`  \x1b[33m!\x1b[0m ${s}`);
const fail = (s) => console.log(`  \x1b[31m✗\x1b[0m ${s}`);

// ---- Questions (typed keys are hidden) ----------------------------------------
const tty = Boolean(process.stdin.isTTY);
// With answers piped in (scripts, tests) they're read all at once instead.
const rl = tty ? createInterface({ input: process.stdin, output: process.stdout, terminal: true }) : null;
let hidden = false;
if (rl) {
  rl._writeToOutput = (text) => {
    if (!hidden) return process.stdout.write(text);
    if (/[\r\n]/.test(text)) process.stdout.write('\n');
  };
}
const lines = tty ? null : readPipedLines();
async function ask(question, fallback = '') {
  const prompt = `${question}${fallback ? ` [${fallback}]` : ''}: `;
  const answer = lines ? (process.stdout.write(`${prompt}\n`), lines.shift() ?? '') : await rl.question(prompt);
  return answer.trim() || fallback;
}
async function askSecret(question) {
  if (lines) {
    process.stdout.write(`${question}: (hidden)\n`);
    return (lines.shift() ?? '').trim();
  }
  process.stdout.write(`${question} (typing is hidden, paste and press Enter): `);
  hidden = true;
  const answer = await rl.question('');
  hidden = false;
  return answer.trim();
}
async function choose(question, options, fallback) {
  for (;;) {
    const answer = (await ask(`${question} (${options.join('/')})`, fallback)).toLowerCase();
    if (options.includes(answer)) return answer;
    console.log(`  Please type one of: ${options.join(', ')}`);
  }
}
const yes = async (question, fallback = 'y') => (await choose(question, ['y', 'n'], fallback)) === 'y';
function readPipedLines() {
  try {
    return readFileSync(0, 'utf8').split(/\r?\n/);
  } catch {
    return [];
  }
}

// ---- .env reading and writing (keeps the comments in .env.example) -------------
const readEnv = () => readEnvFile(ENV, path.join(ROOT, '.env.example'));
const writeEnv = (text, changes) => updateEnvFile(ENV, changes, { text });

// ---- Checking keys (a free request that lists models) ---------------------------
async function testKey(provider, key) {
  const url = provider === 'openai' ? 'https://api.openai.com/v1/models' : 'https://api.anthropic.com/v1/models';
  const headers = provider === 'openai' ? { Authorization: `Bearer ${key}` } : { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) return { ok: false, why: 'the key was rejected. Check you copied all of it.' };
    if (res.status === 429) return { ok: false, why: 'the account is rate-limited or out of credit. Add credit, then try again.' };
    return { ok: false, why: `the service answered ${res.status}.` };
  } catch (err) {
    return { ok: false, why: `couldn't reach the service (${err.message}). Check the internet connection.` };
  }
}

// The voices on an ElevenLabs account, yours first.
async function elevenVoices(key) {
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(15000) });
    if (res.status === 401) return { voices: [], why: 'the key was rejected (check you copied all of it, and that it may read voices).' };
    if (!res.ok) return { voices: [], why: `ElevenLabs answered ${res.status}.` };
    const mine = (v) => ['cloned', 'professional', 'generated'].includes(v.category);
    const voices = ((await res.json()).voices ?? []).map((v) => ({ id: v.voice_id, name: v.name, mine: mine(v) }));
    return { voices: voices.sort((a, b) => Number(!a.mine) - Number(!b.mine) || a.name.localeCompare(b.name)) };
  } catch (err) {
    return { voices: [], why: `couldn't reach ElevenLabs (${err.message}).` };
  }
}

// ---- The steps -----------------------------------------------------------------
console.log(`\n${bold('Digital clone setup')}\nPress Enter to keep the value in [brackets].\n`);

console.log(bold('1. Node.js'));
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 12)) {
  fail(`Node ${process.versions.node} is too old. Install the LTS version from https://nodejs.org, then run npm run setup again.`);
  process.exit(1);
}
ok(`Node ${process.versions.node}`);

console.log(bold('\n2. Packages'));
if (existsSync(path.join(ROOT, 'node_modules', 'openai')) && existsSync(path.join(ROOT, 'node_modules', '@anthropic-ai', 'sdk'))) ok('Already installed');
else {
  console.log('  Installing (about a minute)...');
  const npm = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install'], { cwd: ROOT, stdio: 'inherit' });
  if (npm.status !== 0) {
    fail('npm install failed. Check the internet connection, then run npm run setup again.');
    process.exit(1);
  }
  ok('Installed');
}

const { text, values } = readEnv();
const changes = {};

console.log(bold('\n3. The clone'));
changes.CLONE_NAME = await ask("Clone's name, shown on the page", values.CLONE_NAME || values.TWIN_NAME || 'Clone');

console.log(bold('\n4. The brain (an API key, or your ChatGPT sign-in)'));
console.log('  openai: GPT. Get a key at https://platform.openai.com/api-keys (billed separately from ChatGPT).');
console.log('  claude: Claude. Get a key at https://platform.claude.com (Settings, API keys).');
console.log('  chatgpt: GPT on your ChatGPT plan instead of API credits, through OpenAI\'s Codex tool. Slower (about 5 s a reply).');
const brain = await choose('Which brain', ['openai', 'claude', 'chatgpt'], ['claude', 'chatgpt'].includes(values.BRAIN) ? values.BRAIN : 'openai');
changes.BRAIN = brain;
if (brain === 'chatgpt') {
  // Codex signs in with your ChatGPT account; an OpenAI API key is still useful as a backup.
  for (;;) {
    // Codex prints its sign-in status on stderr, so both streams are read.
    const run = spawnSync('codex', ['login', 'status'], { encoding: 'utf8' });
    const status = run.error?.code === 'ENOENT' ? 'not installed' : `${run.stdout ?? ''}${run.stderr ?? ''}`;
    if (/logged in/i.test(status) && /chatgpt/i.test(status)) {
      ok('Codex is signed in with ChatGPT');
      break;
    }
    warn(status === 'not installed' ? 'Codex is not installed.' : 'Codex is not signed in with ChatGPT.');
    console.log('  In another Terminal window, run:');
    if (status === 'not installed') console.log('    npm install -g @openai/codex');
    console.log('    codex login        (choose "Sign in with ChatGPT")');
    if (!(await yes('Done? Check again', 'y'))) break;
  }
  console.log('  An OpenAI API key is optional but recommended: it is the backup when ChatGPT is slow or at its limit, and it powers recall by meaning (a few cents a month).');
}
const keyName = brain === 'claude' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
let key = values[keyName];
if (key && !(await yes(`A ${brain} key is already saved. Keep it?`))) key = '';
while (!key) {
  key = await askSecret(`Paste your ${brain === 'claude' ? 'Anthropic' : 'OpenAI'} API key${brain === 'chatgpt' ? ' (Enter to skip)' : ''}`);
  if (!key) {
    if (brain === 'chatgpt') break;
    if (await yes('No key entered. Continue without one (the clone only echoes you in demo mode)?', 'n')) break;
    continue;
  }
}
if (key) {
  process.stdout.write('  Testing the key... ');
  const result = await testKey(brain === 'claude' ? 'claude' : 'openai', key);
  console.log(result.ok ? 'works.' : `didn't work: ${result.why}`);
  if (!result.ok && !(await yes('Save it anyway?', 'n'))) key = values[keyName] ?? '';
  changes[keyName] = key;
}
if (brain !== 'claude' && key) ok(`Backup model: ${values.FALLBACK_MODEL || 'gpt-5.4-mini'} answers if the main one fails (change FALLBACK_MODEL in .env).`);
else if (!values.OPENAI_API_KEY) warn('Without an OpenAI key there is no backup model and recall matches words instead of meaning. You can add OPENAI_API_KEY to .env later.');

console.log(bold('\n5. Voice'));
const mac = process.platform === 'darwin';
if (mac) console.log("  Without ElevenLabs, the clone uses this Mac's built-in voice.");
else warn("This isn't a Mac, so the built-in voice won't work. Use ElevenLabs, or the clone will only show text.");
if (await yes('Set up an ElevenLabs cloned voice now?', values.ELEVENLABS_API_KEY ? 'y' : 'n')) {
  console.log('  Make the voice at https://elevenlabs.io under Voices (the person should record and agree to it themselves).');
  console.log('  You can also do all of this later from the Voice chip on the clone\'s page.');
  const eleven = (await askSecret('Paste your ElevenLabs API key (Enter keeps the saved one)')) || values.ELEVENLABS_API_KEY || '';
  changes.ELEVENLABS_API_KEY = eleven;
  const voices = eleven ? await elevenVoices(eleven) : { voices: [] };
  if (voices.why) warn(`Couldn't list your voices: ${voices.why}`);
  if (voices.voices.length) {
    voices.voices.forEach((v, i) => console.log(`   ${String(i + 1).padStart(2)}. ${v.name}${v.mine ? '  (yours)' : ''}`));
    const saved = voices.voices.findIndex((v) => v.id === values.ELEVENLABS_VOICE_ID);
    const pick = Number(await ask('Which voice? (number)', saved >= 0 ? String(saved + 1) : '1'));
    const voice = voices.voices[pick - 1] ?? voices.voices[0];
    changes.ELEVENLABS_VOICE_ID = voice.id;
    changes.ELEVENLABS_VOICE_NAME = voice.name;
    ok(`Voice: ${voice.name}`);
  } else changes.ELEVENLABS_VOICE_ID = await ask('Voice ID (from the voice on elevenlabs.io)', values.ELEVENLABS_VOICE_ID || '');
}

console.log(bold('\n6. Persona'));
const personaDir = path.resolve(ROOT, values.PERSONA_DIR || 'persona');
const notes = existsSync(personaDir) ? readdirSync(personaDir).filter((f) => f.endsWith('.md') && f !== 'README.md') : [];
if (notes.length) ok(`${notes.length} persona notes found in ${path.relative(ROOT, personaDir) || '.'}/`);
else {
  mkdirSync(personaDir, { recursive: true });
  const template = path.join(ROOT, 'persona-template');
  for (const f of readdirSync(template)) copyFileSync(path.join(template, f), path.join(personaDir, f));
  ok(`Started ${path.relative(ROOT, personaDir)}/ from the template. Next: on the Mind page, Build from everything: add their chats, writing and answers, and it builds the persona from them.`);
}

writeEnv(text, changes);
rl?.close();
console.log(`\n${bold('Done.')} Settings saved to .env (only you can read it).\n`);
const port = values.PORT || '4747';
console.log(`Start the clone:   ${bold('npm start')}   then open ${bold(`http://localhost:${port}`)}`);
console.log(`Edit who it is:   the ${bold('Mind')} button on the page, or ${bold(`http://localhost:${port}/mind`)}`);
console.log(`Check everything: ${bold('npm run check')}\n`);
if (mac) {
  try {
    execFileSync('which', ['say'], { stdio: 'ignore' });
  } catch {
    warn("The Mac voice command (say) wasn't found.");
  }
}
