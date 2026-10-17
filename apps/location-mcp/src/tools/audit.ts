import {
  NotFoundError,
  QueryValidationError,
  RouteServiceError,
  OperationError,
  withinOperation,
  type QueryExecutor,
} from '@relohome/housing-query'
import { logger, logToolFailure } from '@relohome/mcp-core'
import { z } from 'zod'
import type { ServerContext } from '@modelcontextprotocol/server'

export function audited<Input, Output extends Record<string, unknown>>(
  pool: QueryExecutor,
  toolName: string,
  handler: (input: Input) => Promise<Output>,
) {
  return async (input: Input, context?: ServerContext) => {
    const started = performance.now()
    try {
      const output = await withinOperation(() => handler(input), context?.mcpReq.signal)
      void writeAudit(pool, toolName, input, 'success', performance.now() - started)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(output) }],
        structuredContent: output,
      }
    } catch (error) {
      const code = errorCode(error)
      logToolFailure(toolName, code, error)
      void writeAudit(pool, toolName, input, 'error', performance.now() - started, code)
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              code,
              retryable: ['TIMEOUT', 'UNAVAILABLE', 'OSRM_OFFLINE'].includes(code),
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
    logger.error({ err: error, tool: toolName }, 'mcp_audit_write_failed')
  }
}

function errorCode(error: unknown) {
  if (error instanceof QueryValidationError) return error.code
  if (error instanceof NotFoundError) return error.code
  if (error instanceof RouteServiceError) return error.code
  if (error instanceof OperationError) return error.code
  const code = (error as { code?: string } | null)?.code
  if (code === '57014') return 'TIMEOUT'
  if (code && (/^08/.test(code) || ['ECONNREFUSED', 'ECONNRESET', '57P01', '57P02', '57P03', '53300'].includes(code))) return 'UNAVAILABLE'
  if (error instanceof z.ZodError) return 'VALIDATION_ERROR'
  return 'INTERNAL_ERROR'
}
