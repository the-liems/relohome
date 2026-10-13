// Derive an image-local install manifest/lock from the authoritative root lock.
// Images retain /app/{packages,platform-api,...} and existing CMD/resource paths.
// Run only after COPY into an image build directory; never produces a tracked lock.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const imagePath = path => ({ 'apps/platform-api': 'platform-api', 'apps/location-mcp': 'mcp-server', 'apps/moving-api': 'moving-api', 'apps/moving-mcp': 'moving-mcp-server' }[path] || path);
if (process.argv[2] !== '--image-build') throw new Error('Only for Docker image build stages');
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const workspaces = manifest.workspaces.filter(path => existsSync(`${imagePath(path)}/package.json`));
const paths = new Set(workspaces);
manifest.workspaces = workspaces.map(imagePath);
const packages = {};
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path) continue;
  if (entry.link) {
    if (paths.has(entry.resolved)) packages[path] = { ...entry, resolved: imagePath(entry.resolved) };
  } else if (path.startsWith('node_modules/')) {
    packages[path] = entry;
  } else if (workspaces.some(workspace => path === workspace || path.startsWith(`${workspace}/`))) {
    const workspace = workspaces.find(workspace => path === workspace || path.startsWith(`${workspace}/`));
    packages[imagePath(workspace) + path.slice(workspace.length)] = entry;
  }
}
lock.packages = { '': { ...lock.packages[''], workspaces: manifest.workspaces }, ...packages };
for (const [file, value] of [['package.json', manifest], ['package-lock.json', lock]]) {
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
