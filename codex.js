// The "sign in with ChatGPT" brain (BRAIN=chatgpt). The twin's messages go through
// Codex, OpenAI's own command-line tool, signed in with your ChatGPT account, so they
// use your ChatGPT plan instead of API credits. It's slower than the API: a few
// seconds per reply, and the reply arrives all at once instead of word by word.
//
// Codex is a coding agent, so it's kept on a short leash: it runs in an empty folder
// (it never sees this project's files), with a read-only sandbox, no saved sessions,
// no tool servers, and short instructions that say it has no tools.
import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const PLACES = ['codex', path.join(os.homedir(), '.local', 'bin', 'codex'), '/opt/homebrew/bin/codex', '/usr/local/bin/codex'];
const TIME_LIMIT_MS = 120_000; // a call that takes longer than this has hung

export function createCodex({ bin, model, effort, baseUrl }) {
  const workdir = mkdtempSync(path.join(os.tmpdir(), 'eclone-codex-'));
  const instructions = path.join(workdir, 'instructions.txt');
  writeFileSync(
    instructions,
    'You are the text engine of a character chat app. You have no tools: never run commands, read files or browse. ' +
      'Follow the request in the message exactly and output only the text it asks for.\n',
  );
  // API keys stay out of Codex, so it can only use the ChatGPT sign-in (never API credits).
  const env = { ...process.env };
  for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) delete env[key];
  let command = bin || 'codex';
  let calls = 0;

  // Is Codex installed and signed in with ChatGPT? Finds it in the usual places.
  async function status() {
    for (const candidate of bin ? [bin] : PLACES) {
      try {
        const { stdout, stderr } = await promisify(execFile)(candidate, ['login', 'status'], { env, timeout: 15_000 });
        command = candidate;
        const text = `${stdout}\n${stderr}`;
        return { installed: true, signedIn: /logged in/i.test(text) && /chatgpt/i.test(text), detail: firstLine(text) };
      } catch (err) {
        if (err.code === 'ENOENT') continue;
        command = candidate;
        return { installed: true, signedIn: false, detail: firstLine(`${err.stdout ?? ''}\n${err.stderr ?? err.message}`) };
      }
    }
    return { installed: false, signedIn: false, detail: 'Codex is not installed' };
  }

  // One Codex run: the prompt goes in on stdin, its final message comes back.
  function run(prompt, { schema, signal } = {}) {
    return new Promise((resolve, reject) => {
      const args = [
        'exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '--json', '-m', model,
        '-c', `model_reasoning_effort="${effort}"`, '-c', 'mcp_servers={}', '-c', `model_instructions_file="${instructions}"`,
      ];
      if (baseUrl) args.push('-c', `openai_base_url="${baseUrl}"`);
      if (schema) {
        const file = path.join(workdir, `schema-${process.pid}-${calls++}.json`);
        writeFileSync(file, JSON.stringify(schema));
        args.push('--output-schema', file);
      }
      args.push('-');
      const child = spawn(command, args, { cwd: workdir, env, stdio: ['pipe', 'pipe', 'pipe'] });
      let buffer = '';
      let errors = '';
      let text = '';
      let usage = null;
      let failure = null;
      let timedOut = false;
      const stop = () => child.kill('SIGTERM');
      const timer = setTimeout(() => {
        timedOut = true;
        stop();
      }, TIME_LIMIT_MS);
      signal?.addEventListener('abort', stop, { once: true });

      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event.type === 'item.completed' && event.item?.type === 'agent_message') text = event.item.text ?? '';
          else if (event.type === 'turn.completed') usage = event.usage;
          else if (event.type === 'turn.failed' || event.type === 'error') failure = event.error?.message ?? event.message ?? JSON.stringify(event).slice(0, 300);
        }
      });
      child.stderr.on('data', (chunk) => {
        errors = (errors + chunk).slice(-8000);
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err.code === 'ENOENT' ? new Error('Codex is not installed. Install it with: npm install -g @openai/codex') : err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
        if (signal?.aborted) return reject(Object.assign(new Error('Stopped.'), { name: 'AbortError' }));
        if (text) {
          // Tokens on the ChatGPT plan aren't billed; "plan" keeps them apart from API usage.
          return resolve({ text, usage: usage && { input: usage.input_tokens ?? 0, cached: usage.cached_input_tokens ?? 0, output: usage.output_tokens ?? 0, plan: true } });
        }
        const why = timedOut ? `no answer after ${TIME_LIMIT_MS / 1000} s` : failure ?? lastError(errors) ?? `it stopped (exit ${code})`;
        reject(new Error(`ChatGPT (Codex) didn't answer: ${why}`));
      });
      child.stdin.end(prompt);
    });
  }

  // A reply in the conversation. Same shape as the other brains' stream functions,
  // except the text arrives in one piece.
  async function reply(system, history, send, signal) {
    const transcript = history.map((t) => `${t.role === 'user' ? 'Them' : 'You'}: ${t.content}`).join('\n\n');
    const prompt =
      `<instructions>\n${system.join('\n\n')}\n</instructions>\n\n<conversation>\n${transcript}\n</conversation>\n\n` +
      'Write your next reply to their latest message, as yourself, following the instructions above. ' +
      'Output only the reply, starting with the hidden mood tag.';
    const { text, usage } = await run(prompt, { signal });
    send({ type: 'text', text });
    return { model, refused: false, usage };
  }

  // A one-off answer as JSON matching `schema` (forming memories, deciding to speak first).
  async function json(system, prompt, schema) {
    const { text, usage } = await run(`<instructions>\n${system}\n</instructions>\n\n${prompt}`, { schema });
    const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    return { data: JSON.parse(clean), usage };
  }

  return { status, reply, json };
}

function firstLine(text) {
  return text.trim().split('\n').find((l) => l.trim()) ?? '';
}

// The most useful line of Codex's error output, if any.
function lastError(text) {
  const lines = text.trim().split('\n').filter((l) => /error/i.test(l));
  return lines.length ? lines.at(-1).replace(/^.*?ERROR[:\s]*/i, '').slice(0, 300) : null;
}
