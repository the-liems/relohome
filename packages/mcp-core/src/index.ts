import { logger } from './logger.js'

export { authenticateMcpRequest, requireServiceToken, sendAuthError, validBearerToken } from './auth.js'
export { logger } from './logger.js'

export interface AuditExecutor {
  query(sql: string, values?: unknown[]): Promise<unknown>
}

export interface ToolErrorShape {
  code: string
  message: string
  retryable: boolean
}

export function toolSuccess<Output extends Record<string, unknown>>(output: Output) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(output) }],
    structuredContent: output,
  }
}

export function toolFailure(error: unknown, classify: (error: unknown) => ToolErrorShape) {
  const payload = classify(error)
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  }
}

/**
 * Classified failures carry a sanitized message the caller already receives, so log their code only.
 * Unclassified failures keep the error and stack, the only record of their root cause.
 */
export function logToolFailure(tool: string, code: string, error: unknown) {
  if (code === 'INTERNAL_ERROR') logger.error({ err: error, tool, code }, 'mcp_tool_failed')
  else logger.warn({ tool, code }, 'mcp_tool_failed')
}

export function auditedTool<Input, Output extends Record<string, unknown>>(
  db: AuditExecutor,
  toolName: string,
  handler: (input: Input) => Promise<Output>,
  classify: (error: unknown) => ToolErrorShape,
) {
  return async (input: Input) => {
    const started = performance.now()
    try {
      const output = await handler(input)
      await writeAudit(db, toolName, input, 'success', performance.now() - started)
      return toolSuccess(output)
    } catch (error) {
      const result = classify(error)
      logToolFailure(toolName, result.code, error)
      await writeAudit(db, toolName, input, 'error', performance.now() - started, result.code)
      return toolFailure(error, classify)
    }
  }
}

async function writeAudit(
  db: AuditExecutor,
  toolName: string,
  input: unknown,
  status: 'success' | 'error',
  durationMs: number,
  errorCode?: string,
) {
  const keys = input && typeof input === 'object' ? Object.keys(input) : []
  try {
    await db.query(
      `INSERT INTO audit.tool_calls (tool_name, input_summary, result_status, duration_ms, error_code)
       VALUES ($1, $2::jsonb, $3, $4, $5)`,
      [toolName, JSON.stringify({ keys }), status, Math.max(0, Math.round(durationMs)), errorCode || null],
    )
  } catch (error) {
    logger.error({ err: error, tool: toolName }, 'mcp_audit_write_failed')
  }
}
