import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getApplicationRuntimeConfig, getRuntimeConfig } from '../src/config.js'

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
      vi.stubEnv('DATABASE_URL', '')
      vi.stubEnv('LOCATION_DATABASE_URL', '')
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
        expect(getApplicationRuntimeConfig().databaseUrl).toBe('postgresql://injected:secret@127.0.0.1:5433/test')
      }
      vi.stubEnv('POSTGRES_APP_PASSWORD', '')
      expect(() => getApplicationRuntimeConfig()).toThrow('POSTGRES_APP_PASSWORD')
    } finally {
      process.chdir(cwd)
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('prefers Location names over generic inherited URLs and never falls back silently', () => {
    for (const [name, value] of Object.entries({
      POSTGRES_APP_USER: 'app', POSTGRES_APP_PASSWORD: 'app-secret',
      POSTGRES_ADMIN_USER: 'admin', POSTGRES_ADMIN_PASSWORD: 'admin-secret',
      POSTGRES_INGEST_USER: 'ingest', POSTGRES_INGEST_PASSWORD: 'ingest-secret',
      DATABASE_URL: 'sqlite:///backend.db',
      ADMIN_DATABASE_URL: 'postgresql://generic/admin',
      INGEST_DATABASE_URL: 'postgresql://generic/ingest',
      LOCATION_DATABASE_URL: 'postgresql://configured-host/location?sslmode=require',
      LOCATION_ADMIN_DATABASE_URL: 'postgresql://configured-host/admin?sslmode=require',
      LOCATION_INGEST_DATABASE_URL: 'postgresql://configured-host/ingest?sslmode=require',
    })) vi.stubEnv(name, value)
    const config = getRuntimeConfig()
    expect(config.databaseUrl).toBe('postgresql://configured-host/location?sslmode=require')
    expect(config.adminDatabaseUrl).toBe('postgresql://configured-host/admin?sslmode=require')
    expect(config.ingestDatabaseUrl).toBe('postgresql://configured-host/ingest?sslmode=require')
    vi.stubEnv('LOCATION_DATABASE_URL', '')
    expect(getApplicationRuntimeConfig().databaseUrl).toBe('sqlite:///backend.db')
  })
})


describe('native env-file entrypoints', () => {
  it('tsx loads the named file and preserves shell variables and backend isolation', () => {
    const root = mkdtempSync(join(tmpdir(), 'tsx-env-'))
    const config = join(root, 'custom.env')
    const cli = resolve(import.meta.dirname, '../../../../../node_modules/tsx/dist/cli.mjs')
    try {
      writeFileSync(config, 'ENV_FILE_TEST=file-value\nDATABASE_URL=sqlite:///backend.db\nSIU_GATEWAY_URL=http://localhost:8600\n')
      const result = spawnSync(process.execPath, [cli, `--env-file=${config}`, '-e',
        'console.log(JSON.stringify([process.env.ENV_FILE_TEST, process.env.SIU_GATEWAY_URL, process.env.DOCKER_HOST]))'], {
        cwd: root,
        env: { ...process.env, ENV_FILE_TEST: 'shell-value', DOCKER_HOST: 'unix:///custom/docker.sock' },
        encoding: 'utf8',
      })
      expect(result.status, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual(['shell-value', 'http://localhost:8600', 'unix:///custom/docker.sock'])
      const missing = spawnSync(process.execPath, [cli, `--env-file=${join(root, 'missing.env')}`, '-e',
        'console.log("should-not-start")'], { cwd: root, encoding: 'utf8' })
      expect(missing.status).not.toBe(0)
      expect(missing.stdout).not.toContain('should-not-start')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
