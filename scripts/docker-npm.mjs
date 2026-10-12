// Derive an image-local install manifest/lock from the authoritative root lock.
// Images retain /app/{packages,platform-api,...} and existing CMD/resource paths.
// Run only after COPY into an image build directory; never produces a tracked lock.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const prefix = 'Maps VN/LifeFlow/';
if (process.argv[2] !== '--image-build') throw new Error('Only for Docker image build stages');
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const workspaces = manifest.workspaces.filter(path => path.startsWith(prefix) && existsSync(`${path.slice(prefix.length)}/package.json`));
const paths = new Set(workspaces);
manifest.workspaces = workspaces.map(path => path.slice(prefix.length));
const packages = {};
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path) continue;
  if (entry.link) {
    if (paths.has(entry.resolved)) packages[path] = { ...entry, resolved: entry.resolved.slice(prefix.length) };
  } else if (path.startsWith('node_modules/')) {
    packages[path] = entry;
  } else if (workspaces.some(workspace => path === workspace || path.startsWith(`${workspace}/`))) {
    packages[path.slice(prefix.length)] = entry;
  }
}
lock.packages = { '': { ...lock.packages[''], workspaces: manifest.workspaces }, ...packages };
for (const [file, value] of [['package.json', manifest], ['package-lock.json', lock]]) {
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
