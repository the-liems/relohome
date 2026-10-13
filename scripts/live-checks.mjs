// Live tests explicitly opt in; ordinary test:python never reads development files.
// The selected file is passed to Node with --env-file; test code reads only process env.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
if (process.env.RELOHOME_LIVE_CHECKS !== '1') {
  console.error('Set RELOHOME_LIVE_CHECKS=1 plus suite-specific flags. See docs/runbooks/local-mvp.md.');
  process.exit(1);
}
const suite = process.argv[2];
const args = process.argv.slice(3);
let envFile = resolve(root, '.env.local');
const index = args.indexOf('--env-file');
if (index !== -1) {
  if (!args[index + 1]) throw new Error('--env-file requires a path');
  envFile = resolve(args[index + 1]);
  args.splice(index, 2);
}
const commands = {
  python: [resolve(root, 'scripts/python.mjs'), '-m', 'pytest', ...(args.length ? args : ['tests/test_llm_agents', '-v'])],
  moving: [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run',
    'Maps VN/LifeFlow/packages/moving-service/tests/live.staging.test.ts',
    'Maps VN/LifeFlow/moving-mcp-server/tests/live.staging.test.ts', ...args],
  browser: [resolve(root, 'node_modules/@playwright/test/cli.js'), 'test', ...args],
};
if (!commands[suite]) throw new Error('Choose python, moving or browser.');
const result = spawnSync(process.execPath, ['--env-file=' + envFile, ...commands[suite]],
  { cwd: suite === 'browser' ? resolve(root, 'Frontend') : root, stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
