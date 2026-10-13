// From repository root: node --env-file=.env.local; Compose inherits the native environment.
import { devNull } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '../..')
process.chdir(root)
const action = process.argv[2] || 'up'
if (!['up', 'down', 'status', 'verify', 'config'].includes(action)) throw new Error('Unknown Moving stack action.')
for (const name of ['MOVING_DB_ADMIN_PASSWORD', 'MOVING_DB_APP_PASSWORD']) {
  if (!/^[A-Za-z0-9_-]{16,}$/.test(process.env[name] || '')) throw new Error(`${name} must be URL-safe and at least 16 characters for local Compose.`)
}
if (action === 'verify') {
  await import('./verify-moving-deployment.mjs')
} else {
  const args = {
    up: ['up', '--build', '-d', '--wait', '--wait-timeout', '180'],
    down: ['down'], status: ['ps'], config: ['config', '--quiet'],
  }[action]
  const result = spawnSync('docker', ['compose', '--env-file', devNull, '-f', 'deploy/moving/compose.moving.yaml', ...args], {
    cwd: root, env: process.env, stdio: 'inherit',
  })
  if (result.error) throw new Error('Docker CLI is unavailable.')
  process.exitCode = result.status ?? 1
}
