import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportRoot, resourceRoot, resolveInputPath } from '../src/runtime-paths.js'

const repo = fileURLToPath(new URL('../../..', import.meta.url))
afterEach(() => vi.restoreAllMocks())

describe('relocated platform resources', () => {
  it('reads the existing migration assets', () => {
    expect(resolve(resourceRoot)).toBe(resolve(repo, 'deploy'))
    expect(resolve(reportRoot)).toBe(resolve(repo, 'eval/location'))
    expect(readFileSync(resolve(resourceRoot, 'database/migrations/001_extensions_and_schemas.sql'), 'utf8'))
      .toContain('CREATE EXTENSION')
  })
  it('keeps relative importer paths anchored at the former npm workspace', () => {
    vi.spyOn(process, 'cwd').mockReturnValue(resolve(repo, 'apps/platform-api'))
    expect(resolveInputPath('../Data/housing.jsonl')).toBe(resolve(repo, 'Maps VN/LifeFlow/Data/housing.jsonl'))
    expect(resolveInputPath('/tmp/housing.jsonl')).toBe('/tmp/housing.jsonl')
  })
  it('keeps explicit launcher working directories unchanged', () => {
    vi.spyOn(process, 'cwd').mockReturnValue(resolve(repo, 'Maps VN/LifeFlow'))
    expect(resolveInputPath('../Data/housing.jsonl')).toBe(resolve(repo, 'Maps VN/Data/housing.jsonl'))
  })
})
