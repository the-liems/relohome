import { createRequire } from "node:module";
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = resolve(dirname(createRequire(import.meta.url).resolve('maplibre-gl/package.json')), 'dist')
const targetDir = resolve(projectRoot, 'public/maplibre')

await mkdir(targetDir, { recursive: true })
await Promise.all([
  copyFile(
    resolve(sourceDir, 'maplibre-gl-worker.mjs'),
    resolve(targetDir, 'maplibre-gl-worker.mjs'),
  ),
  copyFile(
    resolve(sourceDir, 'maplibre-gl-shared.mjs'),
    resolve(targetDir, 'maplibre-gl-shared.mjs'),
  ),
])

console.log('Prepared MapLibre worker assets.')
