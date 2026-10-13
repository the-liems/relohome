// Strict reader for the ignored .env.test (vendor credentials for live tests only).
// Values are data: callers pass them explicitly to the processes they start.
import { existsSync, readFileSync } from 'node:fs';

export function readEnvTest(path) {
  if (!existsSync(path)) return {};
  const values = {};
  readFileSync(path, 'utf8').split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error(`${path}:${index + 1}: expected KEY=VALUE`);
    values[match[1]] = match[2];
  });
  return values;
}
