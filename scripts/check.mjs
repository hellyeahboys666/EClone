#!/usr/bin/env node
// Health check: npm run check   (add -- --offline to skip testing the keys)
// Goes through everything the clone needs and says how to fix what's missing.
// Prints counts only, never keys, persona text or memories.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const offline = process.argv.includes('--offline');
let problems = 0;
const ok = (s) => console.log(`  \x1b[32m✓\x1b[0m ${s}`);
const warn = (s) => console.log(`  \x1b[33m!\x1b[0m ${s}`);
const fail = (s, fix) => {
  problems++;
  console.log(`  \x1b[31m✗\x1b[0m ${s}${fix ? `\n      Fix: ${fix}` : ''}`);
};
const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

console.log('\nChecking the digital clone...\n');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major > 20 || (major === 20 && minor >= 12)) ok(`Node ${process.versions.node}`);
else fail(`Node ${process.versions.node} is too old (needs 20.12 or newer)`, 'install the LTS version from https://nodejs.org');

if (existsSync(path.join(ROOT, 'node_modules', 'openai')) && existsSync(path.join(ROOT, 'node_modules', '@anthropic-ai', 'sdk'))) ok('Packages installed');
else fail('Packages not installed', 'npm install');

const envFile = path.join(ROOT, '.env');
const env = {};
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  const mode = statSync(envFile).mode & 0o777;
  ok(`.env found${mode & 0o077 ? ' (readable by other users on this Mac; chmod 600 .env makes it private)' : ''}`);
} else fail('No .env settings file', 'npm run setup');

const brain = ['openai', 'chatgpt'].includes(env.BRAIN) ? env.BRAIN : 'claude';
const keyName = brain === 'claude' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
if (brain === 'chatgpt') {
  // Codex prints its sign-in status on stderr, so both streams are read.
  const run = spawnSync(process.env.CODEX_BIN || env.CODEX_BIN || 'codex', ['login', 'status'], { encoding: 'utf8' });
  const status = run.error?.code === 'ENOENT' ? 'not installed' : `${run.stdout ?? ''}${run.stderr ?? ''}`;
  if (/logged in/i.test(status) && /chatgpt/i.test(status)) ok(`Brain: ChatGPT plan through Codex (${env.CODEX_MODEL || 'gpt-6-sol'})`);
  else if (status === 'not installed') fail('Brain is chatgpt, but Codex is not installed', 'npm install -g @openai/codex, then codex login');
  else fail('Brain is chatgpt, but Codex is not signed in with ChatGPT', 'codex login (choose Sign in with ChatGPT)');
}
if (!existsSync(envFile) || brain === 'chatgpt') {
  // Nothing to check until setup has written .env.
} else if (!env[keyName] && !(brain === 'claude' && env.ANTHROPIC_AUTH_TOKEN)) {
  fail(`Brain is ${brain}, but ${keyName} is empty, so the clone is in demo mode`, 'npm run setup');
} else if (offline) ok(`Brain: ${brain} (${brain === 'openai' ? env.OPENAI_MODEL || 'gpt-5.4' : env.CLAUDE_MODEL || 'claude-sonnet-5-5'}), key not tested (--offline)`);
else {
  const url = brain === 'openai' ? 'https://api.openai.com/v1/models' : 'https://api.anthropic.com/v1/models';
  const headers = brain === 'openai' ? { Authorization: `Bearer ${env[keyName]}` } : { 'x-api-key': env[keyName], 'anthropic-version': '2023-06-01' };
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (res.ok) ok(`Brain: ${brain}, key works`);
    else if (res.status === 401 || res.status === 403) fail(`The ${brain} key was rejected`, 'npm run setup and paste the key again');
    else if (res.status === 429) fail(`The ${brain} account is rate-limited or out of credit`, 'add credit on the provider\'s website');
    else warn(`The ${brain} service answered ${res.status}; try again later`);
  } catch (err) {
    warn(`Couldn't reach ${brain} (${err.message}); check the internet connection`);
  }
}

const backup = env.FALLBACK_MODEL || 'gpt-5.4-mini';
if (!existsSync(envFile)) {
  // (as above)
} else if (backup === 'none') warn('Backup model is off');
else if (backup.startsWith('claude') ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY) ok(`Backup model: ${backup}`);
else warn(`Backup model ${backup} needs ${backup.startsWith('claude') ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} in .env, so there is no backup`);
if (existsSync(envFile) && !env.OPENAI_API_KEY) warn('No OpenAI key: recall matches words instead of meaning');

if (env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID) ok('Voice: ElevenLabs');
else if (process.platform === 'darwin') {
  try {
    execFileSync('which', ['say'], { stdio: 'ignore' });
    ok("Voice: this Mac's built-in voice");
  } catch {
    fail("No voice: the Mac's say command is missing", 'set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env');
  }
} else fail("No voice: the built-in voice only works on a Mac", 'set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env (npm run setup)');

const personaDir = path.resolve(ROOT, env.PERSONA_DIR || 'persona');
const notes = existsSync(personaDir) ? readdirSync(personaDir).filter((f) => f.endsWith('.md') && f !== 'README.md') : [];
if (!notes.length) fail('No persona notes, so the clone doesn\'t know who it is', 'npm run setup (starts from the template), then fill them in on the Mind page');
else {
  const unfinished = notes.filter((f) => readFileSync(path.join(personaDir, f), 'utf8').includes('(replace this)')).length;
  if (unfinished) warn(`${notes.length} persona notes, ${unfinished} still with template text "(replace this)"; fill them in on the Mind page`);
  else ok(`${notes.length} persona notes`);
}

const avatars = existsSync(path.join(ROOT, 'avatar')) ? readdirSync(path.join(ROOT, 'avatar')).filter((f) => /\.(vrm|glb)$/i.test(f)).sort() : [];
if (avatars.length) ok(`Avatar: ${avatars[0]}`);
else warn('Avatar: the sample one (put a .vrm or .glb file in avatar/ to use your own)');

const memoryDir = path.resolve(ROOT, env.MEMORY_DIR || 'memory');
const memories = readJson(path.join(memoryDir, 'memories.json'));
const conversation = readJson(path.join(memoryDir, 'conversation.json'));
if (!existsSync(memoryDir)) ok('Memory: empty (it starts when you first talk)');
else ok(`Memory: ${memories?.length ?? 0} memories, ${conversation?.messages?.length ?? 0} messages in the current chat`);

const port = env.PORT || '4747';
try {
  const res = await fetch(`http://localhost:${port}/api/config`, { signal: AbortSignal.timeout(2000) });
  if (res.ok) ok(`The clone is running: http://localhost:${port}`);
  else warn(`Something else answers on port ${port}; set PORT in .env to another number`);
} catch {
  ok(`Not running right now. Start it with npm start, then open http://localhost:${port}`);
}

console.log(problems ? `\n${problems} thing${problems > 1 ? 's' : ''} to fix (see above).\n` : '\nAll good.\n');
process.exitCode = problems ? 1 : 0;
