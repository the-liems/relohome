import { readFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { describe, expect, it } from 'vitest'
import { authenticateMcpRequest, requireServiceToken, validBearerToken } from '../src/auth.js'

const cases = JSON.parse(readFileSync(new URL('../../../tests/fixtures/internal-mcp-auth.json', import.meta.url), 'utf8')) as {
  token: string; headers: { name: string; header: string | null; valid: boolean }[]; invalid_tokens: string[]
}

describe('shared internal MCP authentication contract', () => {
  it.each(cases.headers)('$name', ({ header, valid }) => {
    expect(validBearerToken(header ?? undefined, cases.token)).toBe(valid)
  })
  it.each(cases.invalid_tokens)('rejects invalid configuration %j', token => {
    expect(() => requireServiceToken(token)).toThrow('MCP_AUTH_TOKEN')
  })
  it('accepts valid configuration', () => {
    expect(requireServiceToken(cases.token)).toBe(cases.token)
  })
  it('rejects duplicate credentials and preserves credential roles', async () => {
    const server = createServer((req, res) => {
      const index = authenticateMcpRequest(req, res, [cases.token, `${cases.token}-write`])
      if (index !== undefined) { res.writeHead(200); res.end(String(index)) }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test address')
    const url = `http://127.0.0.1:${address.port}/mcp`
    try {
      for (const authorization of [undefined, 'Bearer wrong']) {
        const response = await fetch(url, { headers: authorization ? { authorization } : {} })
        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({ status: 'error', code: 'UNAUTHORIZED' })
        expect(response.headers.get('www-authenticate')).toBe('Bearer')
        expect(response.headers.get('cache-control')).toBe('no-store')
      }
      const duplicate = await new Promise<number | undefined>((resolve, reject) => {
        const req = request(url, { headers: ['Host', `127.0.0.1:${address.port}`, 'Authorization', `Bearer ${cases.token}`, 'Authorization', `Bearer ${cases.token}`] }, res => {
          res.resume(); res.once('end', () => resolve(res.statusCode))
        })
        req.once('error', reject); req.end()
      })
      expect(duplicate).toBe(401)
      for (const [token, role] of [[cases.token, '0'], [`${cases.token}-write`, '1']]) {
        expect(await (await fetch(url, { headers: { authorization: `Bearer ${token}` } })).text()).toBe(role)
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
})
