// Live tests explicitly opt in; ordinary test commands never read local configuration.
// Vendor credentials come from .env.test, read as data: pytest receives the file path
// and the running stack as options; TypeScript suites receive the values explicitly.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readEnvTest } from './env-test.mjs';
const root = resolve(import.meta.dirname, '..');
if (process.env.RELOHOME_LIVE_CHECKS !== '1') {
  console.error('Set RELOHOME_LIVE_CHECKS=1 plus suite-specific flags. See docs/runbooks/local-mvp.md.');
  process.exit(1);
}
const suite = process.argv[2];
const args = process.argv.slice(3);
let envTest = resolve(root, '.env.test');
const index = args.indexOf('--env-test');
if (index !== -1) {
  if (!args[index + 1]) throw new Error('--env-test requires a path');
  envTest = resolve(args[index + 1]);
  args.splice(index, 2);
}
const commands = {
  python: [resolve(root, 'scripts/python.mjs'), '-m', 'pytest', '--env-test', envTest,
    ...(args.length ? args : ['tests/test_llm_agents', '-v'])],
  moving: [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run',
    'packages/moving-service/tests/live.staging.test.ts',
    'apps/moving-mcp/tests/live.staging.test.ts', ...args],
  browser: [resolve(root, 'node_modules/@playwright/test/cli.js'), 'test', ...args],
};
if (!commands[suite]) throw new Error('Choose python, moving or browser.');
const env = suite === 'python' ? process.env : { ...process.env, ...readEnvTest(envTest) };
const result = spawnSync(process.execPath, commands[suite],
  { cwd: suite === 'browser' ? resolve(root, 'apps/web') : root, env, stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
