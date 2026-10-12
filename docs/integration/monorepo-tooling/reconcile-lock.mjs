// One-time #110 replay: run from the repository root at this tooling revision.
// Emits a seed lock to stdout; npm 11 normalizes it without fetching new versions.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const base = process.argv[2] || 'bf35392';
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const prefix = 'Maps VN/LifeFlow';
const sources = [prefix, 'Frontend', `${prefix}/map-app`];
const packages = {
  '': Object.fromEntries(Object.entries(manifest).filter(([key]) =>
    ['name', 'version', 'workspaces', 'engines'].includes(key))),
};
for (const source of sources) {
  const lock = JSON.parse(execFileSync('git', ['show', `${base}:${source}/package-lock.json`], { encoding: 'utf8' }));
  for (const [path, original] of Object.entries(lock.packages)) {
    let target;
    let entry = original;
    if (!path) {
      if (source === prefix) continue; // old scripts-only workspace root
      target = source;
    } else if (entry.link) {
      target = path;
      entry = { ...entry, resolved: `${source}/${entry.resolved}` };
    } else if (path.startsWith('node_modules/')) {
      target = path;
      if (packages[target] && packages[target].version !== entry.version) target = `${source}/${path}`;
    } else {
      target = `${source}/${path}`;
    }
    packages[target] ??= entry;
  }
}
for (const workspace of manifest.workspaces) {
  const child = JSON.parse(readFileSync(`${workspace}/package.json`, 'utf8'));
  packages[`node_modules/${child.name}`] = { resolved: workspace, link: true };
}
console.log(JSON.stringify({
  name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages,
}, null, 2));
