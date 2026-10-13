// Verify both the copied public assets and what Vite actually ships.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
for (const app of ['apps/web', 'examples/map-app']) {
  const require = createRequire(resolve(root, app, 'package.json'));
  const dist = resolve(dirname(require.resolve('maplibre-gl/package.json')), 'dist');
  for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
    const expected = await readFile(resolve(dist, file));
    for (const directory of ['public', 'dist']) {
      const target = resolve(root, app, directory, 'maplibre', file);
      if (!expected.equals(await readFile(target))) throw new Error(`Stale MapLibre asset: ${target}`);
    }
  }
  console.log(`${app}: installed MapLibre worker/shared assets match public and build output`);
}
