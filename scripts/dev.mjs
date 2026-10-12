// Preserve workspace cwd while locating Python and the launcher from this file.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const windows = process.platform === 'win32';
const venv = resolve(root, '.venv', windows ? 'Scripts/python.exe' : 'bin/python');
const python = process.env.PYTHON || (process.env.VIRTUAL_ENV ? (windows ? 'python' : 'python3') :
  existsSync(venv) ? venv : windows ? 'python' : 'python3');
const child = spawn(python, [resolve(root, 'scripts/dev.py'), ...process.argv.slice(2)], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); });
