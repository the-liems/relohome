import { createRequire } from "node:module";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, "public/maplibre");
await mkdir(target, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  await copyFile(
    resolve(dirname(createRequire(import.meta.url).resolve("maplibre-gl/package.json")), "dist", file),
    resolve(target, file),
  );
}
