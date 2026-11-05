#!/usr/bin/env node
// Makes a clean copy of the app for someone else: npm run share
// Leaves out everything personal or rebuildable: keys (.env), persona notes,
// memories, avatars, voice samples, house settings, and installed packages.
// The other person runs npm run setup (or double-clicks Start EClone.command).
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = path.basename(ROOT);
const out = path.join(path.dirname(ROOT), `${name}-share.zip`);

const exclude = [
  '.env', 'persona/*', 'persona-backups/*', 'memory/*', 'avatar/*.vrm', 'media/*', 'reference/*', 'house.json',
  'node_modules/*', '.git/*', '.claude/*', '*.DS_Store', '*.tmp',
].map((p) => `${name}/${p}`);

if (existsSync(out)) rmSync(out);
execFileSync('zip', ['-r', '-q', out, name, '-x', ...exclude], { cwd: path.dirname(ROOT), stdio: 'inherit' });
console.log(`\nMade ${out}`);
console.log('It has the app only: no keys, persona notes, memories, avatar or house settings.');
console.log('The other person unzips it and runs npm run setup (or double-clicks "Start EClone.command").\n');
