// Local stack entrypoint. Provider credentials stay in the user's existing .env;
// infrastructure credentials are generated once in ignored .runtime/ storage.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadMovingEnvironment } from '@lifeflow/moving-service'

const root = resolve(import.meta.dirname, '..')
process.chdir(root)
loadMovingEnvironment()
const action = process.argv[2] || 'up'
if (!['up', 'down', 'status', 'verify', 'config'].includes(action)) throw new Error('Unknown Moving stack action.')
const runtime = resolve(root, '.runtime')
const secretsFile = resolve(runtime, 'moving-secrets.json')
await mkdir(runtime, { recursive: true })
let secrets
try { secrets = JSON.parse(await readFile(secretsFile, 'utf8')) }
catch (error) {
  if (error.code !== 'ENOENT') throw error
  secrets = Object.fromEntries(['MOVING_DB_ADMIN_PASSWORD', 'MOVING_DB_APP_PASSWORD',
    'MOVING_MCP_AUTH_TOKEN', 'AHAMOVE_WEBHOOK_SECRET'].map((name) => [name, randomBytes(32).toString('hex')]))
  await writeFile(secretsFile, JSON.stringify(secrets, null, 2), { mode: 0o600, flag: 'wx' })
}
for (const [name, value] of Object.entries(secrets)) {
  if (!process.env[name] || process.env[name].startsWith('replace-with-')) process.env[name] = value
}
for (const name of ['MOVING_DB_ADMIN_PASSWORD', 'MOVING_DB_APP_PASSWORD']) {
  if (!/^[A-Za-z0-9_-]{16,}$/.test(process.env[name])) throw new Error(`${name} must be URL-safe and at least 16 characters for local Compose.`)
}
if (action === 'verify') {
  await import('./verify-moving-deployment.mjs')
} else {
  const args = {
    up: ['up', '--build', '-d', '--wait', '--wait-timeout', '180'],
    down: ['down'], status: ['ps'], config: ['config', '--quiet'],
  }[action]
  const result = spawnSync('docker', ['compose', '-f', 'compose.moving.yaml', ...args], {
    cwd: root, env: process.env, stdio: 'inherit',
  })
  if (result.error) throw new Error('Docker CLI is unavailable.')
  process.exitCode = result.status ?? 1
}
