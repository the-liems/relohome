// Use an activated environment, PYTHON override, or the documented root venv.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const windows = process.platform === 'win32';
const venv = resolve(root, '.venv', windows ? 'Scripts/python.exe' : 'bin/python');
const fallback = windows ? 'python' : 'python3';
const python = process.env.PYTHON || (
  process.env.VIRTUAL_ENV ? fallback : existsSync(venv) ? venv : fallback
);
const result = spawnSync(python, process.argv.slice(2), { cwd: root, stdio: 'inherit', env: { ...process.env, RELOHOME_RUNTIME_ROOT: process.env.RELOHOME_RUNTIME_ROOT || root } });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
