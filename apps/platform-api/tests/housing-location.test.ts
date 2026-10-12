import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveHousingAddress, searchHousingAddress, signLocation, verifyLocation } from '../src/housing-location.js'

describe('owner address confirmation', () => {
  beforeEach(() => {
    process.env.AGENT_API_TOKEN = 'location-signing-test'
    process.env.VIETMAP_API_KEY = 'private-provider-key'
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete process.env.AGENT_API_TOKEN
    delete process.env.VIETMAP_API_KEY
  })
  const result = {
    ref_id: 'verified-ref',
    address: '123 Lê Lợi, TP.HCM',
    location: { lat: 10.77, lng: 106.7 },
  }
  it('binds a confirmation to the authenticated owner, exact address, coordinate and expiry', () => {
    const signed = signLocation('owner', result)
    expect(verifyLocation(signed, 'owner', result.address, result.location).source).toBe('vietmap')
    for (const [token, user, address, point] of [
      [signed, 'other', result.address, result.location],
      [signed, 'owner', 'different', result.location],
      [signed, 'owner', result.address, { lat: 10.8, lng: 106.7 }],
      [signed + 'x', 'owner', result.address, result.location],
    ] as const)
      expect(() => verifyLocation(token, user, address, point)).toThrow()
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 60_000)
    expect(() => verifyLocation(signed, 'owner', result.address, result.location)).toThrow()
  })
  it('uses Search v4 then Place v4 and exposes no provider credentials', async () => {
    const fetcher = vi.fn(async (input: URL) => {
      expect(input.searchParams.get('apikey')).toBe('private-provider-key')
      return new Response(
        JSON.stringify(
          input.pathname.endsWith('autocomplete/v4')
            ? [
                {
                  ref_id: 'verified-ref',
                  display: result.address,
                  name: '123 Lê Lợi',
                },
              ]
            : {
                display: result.address,
                lat: 10.77,
                lng: 106.7,
                ward: 'Bến Thành',
                city: 'Hồ Chí Minh',
              },
        ),
      )
    })
    vi.stubGlobal('fetch', fetcher)
    const suggestions = await searchHousingAddress('owner', 'unique-address-search')
    expect(suggestions.results).toHaveLength(1)
    const selected = await resolveHousingAddress('owner', 'verified-ref')
    expect(selected.location).toEqual(result.location)
    expect(selected.accuracy).toBe('approximate')
    expect(JSON.stringify(selected)).not.toContain('private-provider-key')
    expect(verifyLocation(selected.location_token, 'owner', selected.address, selected.location).ref_id).toBe(
      'verified-ref',
    )
  })
  it('handles provider outages and unavailable quotas without leaking upstream errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('private-provider-key')
      }),
    )
    await expect(resolveHousingAddress('owner', 'bad-ref')).rejects.toMatchObject({
      status: 502,
      code: 'location_unavailable',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('secret', { status: 429 })),
    )
    await expect(resolveHousingAddress('owner', 'bad-ref')).rejects.toMatchObject({ status: 503 })
    delete process.env.VIETMAP_API_KEY
    await expect(resolveHousingAddress('owner', 'bad-ref')).rejects.toMatchObject({ status: 503 })
  })
})
