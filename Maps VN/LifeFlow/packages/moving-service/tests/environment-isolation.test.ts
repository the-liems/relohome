import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAhaMoveConfig, getMovingRuntimeConfig } from '../src/config.js'

afterEach(() => vi.unstubAllEnvs())

describe('process-only configuration', () => {
  it('ignores cwd files and the retired override, preserving injected values', () => {
    const root = mkdtempSync(join(tmpdir(), 'env-isolation-'))
    const cwd = process.cwd()
    try {
      writeFileSync(join(root, '.env'), 'DATABASE_URL=postgresql://wrong/root\n')
      const workspace = join(root, 'workspace')
      mkdirSync(workspace)
      writeFileSync(join(workspace, '.env'), 'DATABASE_URL=postgresql://wrong/workspace\n')
      vi.stubEnv('LIFEFLOW_ENV_FILE', join(root, '.env'))
      // Another service's generic URL inherited from the shell is never used.
      vi.stubEnv('DATABASE_URL', 'sqlite:///backend.db')
      vi.stubEnv('MOVING_DATABASE_URL', '')
      vi.stubEnv('POSTGRES_HOST', '127.0.0.1')
      vi.stubEnv('POSTGRES_PORT', '5433')
      vi.stubEnv('POSTGRES_DB', 'test')
      vi.stubEnv('POSTGRES_APP_USER', 'injected')
      vi.stubEnv('POSTGRES_APP_PASSWORD', 'secret')
      vi.stubEnv('AHAMOVE_ENV', 'staging')
      vi.stubEnv('AHAMOVE_USER_TOKEN', 'test-provider-token')
      for (const directory of [root, workspace]) {
        process.chdir(directory)
        expect(getMovingRuntimeConfig().databaseUrl).toBe('postgresql://injected:secret@127.0.0.1:5433/test')
      }
      vi.stubEnv('POSTGRES_APP_PASSWORD', '')
      expect(() => getMovingRuntimeConfig()).toThrow('POSTGRES_APP_PASSWORD')
    } finally {
      process.chdir(cwd)
      rmSync(root, { recursive: true, force: true })
    }
  })
  it('reads provider settings without database configuration', () => {
    vi.stubEnv('MOVING_DATABASE_URL', '')
    vi.stubEnv('POSTGRES_APP_USER', '')
    vi.stubEnv('POSTGRES_APP_PASSWORD', '')
    vi.stubEnv('AHAMOVE_ENV', 'staging')
    vi.stubEnv('AHAMOVE_USER_TOKEN', 'test-provider-token')
    const config = getAhaMoveConfig()
    expect(config.token).toBe('test-provider-token')
    expect('databaseUrl' in config).toBe(false)
    expect(() => getMovingRuntimeConfig()).toThrow('POSTGRES_APP_USER')
  })
})
