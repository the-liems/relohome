// Real PostgreSQL alternative for live integration verification without Docker.
// Creates a fresh isolated cluster, runs migrations twice, verifies actual HTTP
// and provider calls, then stops PostgreSQL. Data is retained in the printed temp
// directory for inspection; no existing local database is changed.
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { readEnvTest } from '../env-test.mjs'

const bin = process.env.MOVING_TEST_POSTGRES_BIN
if (!bin) throw new Error('Set MOVING_TEST_POSTGRES_BIN to the directory containing initdb and pg_ctl.')
const root = resolve(import.meta.dirname, '../..')
const location = await mkdtemp(join(tmpdir(), 'lifeflow-moving-pg-'))
const data = join(location, 'data')
const secret = randomBytes(24).toString('hex')
const appSecret = randomBytes(24).toString('hex')
const pwfile = join(location, 'admin-password')
await writeFile(pwfile, secret, { mode: 0o600 })
const suffix = process.platform === 'win32' ? '.exe' : ''
const probe = createServer()
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
const port = probe.address().port
await new Promise((resolve) => probe.close(resolve))
// AhaMove credentials and operator inputs come from the ignored root .env.test;
// the isolated database is created here and passed explicitly to every child.
const env = { ...process.env, ...readEnvTest(resolve(root, '.env.test')),
  MOVING_DATABASE_ADMIN_URL: `postgresql://moving_admin:${secret}@127.0.0.1:${port}/postgres`,
  MOVING_DATABASE_URL: `postgresql://moving_app:${appSecret}@127.0.0.1:${port}/postgres`,
  MOVING_DB_APP_USER: 'moving_app', MOVING_DB_APP_PASSWORD: appSecret,
  AHAMOVE_WEBHOOK_SECRET: randomBytes(32).toString('hex'),
  AHAMOVE_ENV: 'staging', AHAMOVE_WRITE_ENABLED: 'false', AHAMOVE_RATING_ENABLED: 'false',
  RUN_AHAMOVE_STAGING_INTEGRATION: '1', MOVING_TEST_REQUIRE_READY: '1',
  MOVING_TEST_ISOLATED_DB: '1',
}
function run(command, args, extra = {}) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit', ...extra })
  if (result.error || result.status !== 0) throw new Error(`Verification command failed: ${command}`)
}
let started = false
try {
  run(join(bin, `initdb${suffix}`), ['-D', data, '-U', 'moving_admin', '--auth=scram-sha-256', `--pwfile=${pwfile}`, '--encoding=UTF8', '--locale=C'])
  run(join(bin, `pg_ctl${suffix}`), ['-D', data, '-l', join(location, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'])
  started = true
  run(process.execPath, ['packages/moving-service/dist/migrate.js'])
  run(process.execPath, ['packages/moving-service/dist/migrate.js'])
  run(process.execPath, [resolve(createRequire(import.meta.url).resolve('vitest/package.json'), '..', 'vitest.mjs'), 'run', 'apps/moving-mcp/tests/http.live.test.ts'])
  if (process.env.MOVING_TEST_AGENT_PYTHON) {
    run(process.env.MOVING_TEST_AGENT_PYTHON, ['-m', 'pytest', 'tests/test_llm_agents/test_moving_live.py', '-q', '--tb=short',
      '--moving-database-url', env.MOVING_DATABASE_URL], {
      cwd: root, env: { ...env, RUN_LIVE_MOVING_AGENT: '1' },
    })
  }
} finally {
  if (started) run(join(bin, `pg_ctl${suffix}`), ['-D', data, '-m', 'fast', '-w', 'stop'])
  await unlink(pwfile)
  console.error(`Verification database stopped; inspection files: ${location}`)
}
