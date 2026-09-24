import { QueryValidationError } from './errors.js'

export function encodeCursor(offset: number) {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url')
}

export function decodeCursor(cursor: string | null | undefined) {
  if (!cursor) return 0
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { offset?: unknown }
    if (!Number.isInteger(value.offset) || Number(value.offset) < 0) throw new Error('Invalid offset')
    return Number(value.offset)
  } catch {
    throw new QueryValidationError('Invalid pagination cursor.')
  }
}
