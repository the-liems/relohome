// Extra acknowledgement; each existing suite still requires its own provider flags.
import { spawnSync } from 'node:child_process';
if (process.env.RELOHOME_LIVE_CHECKS !== '1') {
  console.error('Set RELOHOME_LIVE_CHECKS=1 plus the suite-specific flags/credentials. See docs/runbooks/root-tooling.md.');
  process.exit(1);
}
const suites = {
  python: ['node', ['scripts/python.mjs', '-m', 'pytest', 'tests/test_llm_agents', '-v']],
  moving: ['npm', ['--prefix', 'Maps VN/LifeFlow', 'run', 'test:moving:live']],
  browser: ['npm', ['exec', '--workspace', 'Frontend', '--', 'playwright', 'test', ...process.argv.slice(3)]],
};
const command = suites[process.argv[2]];
if (!command) throw new Error('Choose python, moving, or browser (with --config playwright.<suite>.config.ts).');
const result = spawnSync(command[0], command[1], { stdio: 'inherit', shell: process.platform === 'win32' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
