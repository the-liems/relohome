import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export function requireServiceToken(token: string, name = 'MCP_AUTH_TOKEN'): string {
  if (token.length < 32 || /^[A-Za-z0-9._~+/-]+=*$/.exec(token)?.[0] !== token) {
    throw new Error(`${name} must contain at least 32 ASCII token characters`)
  }
  return token
}

export function validBearerToken(header: string | undefined, expected: string): boolean {
  if (!header || /^Bearer [A-Za-z0-9._~+/-]+=*$/i.exec(header)?.[0] !== header) return false
  const supplied = Buffer.from(header.slice(7), 'ascii')
  const configured = Buffer.from(expected, 'ascii')
  return supplied.length === configured.length && timingSafeEqual(supplied, configured)
}

export function sendAuthError(response: ServerResponse, status: 401 | 403, code = 'UNAUTHORIZED'): void {
  if (status === 401) response.setHeader('WWW-Authenticate', 'Bearer')
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify({ status: 'error', code }))
}

// Return the matching credential index so services retain their read/write roles.
export function authenticateMcpRequest(
  request: IncomingMessage, response: ServerResponse, tokens: readonly string[],
): number | undefined {
  const authorizationCount = request.rawHeaders.filter((_, index) =>
    index % 2 === 0 && request.rawHeaders[index]?.toLowerCase() === 'authorization').length
  const index = authorizationCount === 1
    ? tokens.findIndex(token => validBearerToken(request.headers.authorization, token)) : -1
  if (index < 0) { sendAuthError(response, 401); return undefined }
  return index
}
