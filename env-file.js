// Reading and changing .env without losing its comments or other settings. Used by
// the setup wizard and by the server (the Voice panel saves its settings here).
// No packages, so the setup wizard can use it before `npm install`.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

// The text of .env (or of the example, when there's no .env yet) and its values.
export function readEnvFile(file, fallback) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : fallback && existsSync(fallback) ? readFileSync(fallback, 'utf8') : '';
  const values = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) values[m[1]] = m[2].trim();
  }
  return { text, values };
}

// Sets each KEY=value in place (or adds it at the end), then saves the file so only
// you can read it. Line breaks are dropped from values so one can't add other settings.
export function updateEnvFile(file, changes, { text, fallback } = {}) {
  let out = text ?? readEnvFile(file, fallback).text;
  for (const [key, raw] of Object.entries(changes)) {
    if (!/^[A-Z0-9_]+$/.test(key)) throw new Error(`Not a setting name: ${key}`);
    const line = `${key}=${String(raw ?? '').replace(/[\r\n]/g, '').trim()}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    out = pattern.test(out) ? out.replace(pattern, () => line) : `${out.trimEnd()}\n${line}\n`;
  }
  writeFileSync(file, out);
  chmodSync(file, 0o600);
}
