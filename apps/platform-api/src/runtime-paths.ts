import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const applicationRoot = fileURLToPath(new URL('..', import.meta.url))
const legacyRoot = fileURLToPath(new URL('../../../Maps%20VN/LifeFlow/', import.meta.url))
const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const deploymentRoot = resolve(repositoryRoot, 'deploy')
// Local SQL moved; release images continue to package it at /app/database.
const isCheckout = existsSync(resolve(deploymentRoot, 'database/migrations'))
export const resourceRoot = isCheckout
  ? deploymentRoot
  : fileURLToPath(new URL('../..', import.meta.url))
export const reportRoot = isCheckout
  ? resolve(repositoryRoot, 'eval/location')
  : resolve(resourceRoot, 'reports')

export function resolveInputPath(value: string): string {
  // npm executes workspace scripts in the app directory. Preserve relative values
  // from existing .env files as if the old platform-api directory still existed.
  const cwd = process.cwd()
  const base = isCheckout && resolve(cwd) === resolve(applicationRoot)
    ? resolve(legacyRoot, 'platform-api')
    : cwd
  return resolve(base, value)
}
