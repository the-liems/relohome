import { afterEach, describe, expect, it, vi } from 'vitest'
import { content } from '../src/privacy.js'

afterEach(() => vi.unstubAllEnvs())
describe('telemetry privacy', () => {
  it('omits free-text identity and addresses by default', () => {
    vi.stubEnv('OBSERVABILITY_CONTENT_MODE', undefined)
    const payload = { input: 'SYNTHETIC_NAME lives at 123 SYNTHETIC_ADDRESS', pickup_address: 'SYNTHETIC_ADDRESS' }
    expect(content(payload)).toBeUndefined()
  })
  it.each(['APP_ENV', 'OTEL_DEPLOYMENT_ENVIRONMENT'])('production %s overrides every legacy payload mode', key => {
    vi.stubEnv(key, ' Production ')
    const payload = { input: 'SYNTHETIC_NAME lives at 123 SYNTHETIC_ADDRESS' }
    for (const mode of ['metadata', 'redacted', 'raw', 'invalid']) {
      vi.stubEnv('OBSERVABILITY_CONTENT_MODE', mode)
      expect(content(payload)).toBeUndefined()
    }
  })
  it.each(['redacted', 'raw'])('always strips secrets in %s mode without changing inputs', mode => {
    vi.stubEnv('OBSERVABILITY_CONTENT_MODE', mode)
    const input = { apiKey: 'private-key', contact: { name: 'Private Person', email: 'person@example.com' },
      input: '{"password":"nested-secret"}', text: 'Bearer another-secret https://user:pass@example.com/path?token=secret' }
    const before = JSON.stringify(input)
    const output = content(input)!
    for (const secret of ['private-key', 'nested-secret', 'another-secret', 'user:pass', 'token=secret']) expect(output).not.toContain(secret)
    expect(output.includes('Private Person')).toBe(mode === 'raw')
    expect(JSON.stringify(input)).toBe(before)
  })
  it('omits payloads in metadata or invalid modes and bounds size', () => {
    vi.stubEnv('OBSERVABILITY_CONTENT_MODE', 'metadata')
    expect(content({ input: 'private' })).toBeUndefined()
    vi.stubEnv('OBSERVABILITY_CONTENT_MODE', 'invalid')
    expect(content({ input: 'private' })).toBeUndefined()
    vi.stubEnv('OBSERVABILITY_CONTENT_MODE', 'redacted')
    expect(Buffer.byteLength(content('hello '.repeat(10000))!)).toBeLessThanOrEqual(16384)
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic
    expect(content(cyclic)).toContain('[depth limit]')
  })
})
