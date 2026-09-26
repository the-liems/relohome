import {
  NotFoundError,
  QueryValidationError,
  RouteServiceError,
  type QueryExecutor,
} from '@lifeflow/housing-query'
import { z } from 'zod'

export function audited<Input, Output extends Record<string, unknown>>(
  pool: QueryExecutor,
  toolName: string,
  handler: (input: Input) => Promise<Output>,
) {
  return async (input: Input) => {
    const started = performance.now()
    try {
      const output = await handler(input)
      await writeAudit(pool, toolName, input, 'success', performance.now() - started)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(output) }],
        structuredContent: output,
      }
    } catch (error) {
      const code = errorCode(error)
      await writeAudit(pool, toolName, input, 'error', performance.now() - started, code)
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              code,
              message: error instanceof Error ? error.message : 'Unknown error',
            }),
          },
        ],
      }
    }
  }
}

async function writeAudit(
  pool: QueryExecutor,
  toolName: string,
  input: unknown,
  status: 'success' | 'error',
  durationMs: number,
  errorCodeValue?: string,
) {
  const keys = input && typeof input === 'object' ? Object.keys(input) : []
  try {
    await pool.query(
      `INSERT INTO audit.tool_calls (
         tool_name, input_summary, result_status, duration_ms, error_code
       ) VALUES ($1, $2::jsonb, $3, $4, $5)`,
      [toolName, JSON.stringify({ keys }), status, Math.max(0, Math.round(durationMs)), errorCodeValue || null],
    )
  } catch (error) {
    console.error('Failed to write MCP audit event:', error)
  }
}

function errorCode(error: unknown) {
  if (error instanceof QueryValidationError) return error.code
  if (error instanceof NotFoundError) return error.code
  if (error instanceof RouteServiceError) return error.code
  if (error instanceof z.ZodError) return 'VALIDATION_ERROR'
  return 'INTERNAL_ERROR'
}
