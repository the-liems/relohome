export { authenticateMcpRequest, requireServiceToken, sendAuthError, validBearerToken } from './auth.js'
import { toolOperation } from '@lifeflow/telemetry'

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

export function auditedTool<Input, Output extends Record<string, unknown>>(
  db: AuditExecutor,
  toolName: string,
  handler: (input: Input) => Promise<Output>,
  classify: (error: unknown) => ToolErrorShape,
) {
  return async (input: Input, context?: { mcpReq?: { _meta?: unknown } }) => toolOperation(toolName, input, context?.mcpReq?._meta, async () => {
    const started = performance.now()
    try {
      const output = await handler(input)
      await writeAudit(db, toolName, input, 'success', performance.now() - started)
      return toolSuccess(output)
    } catch (error) {
      const result = classify(error)
      await writeAudit(db, toolName, input, 'error', performance.now() - started, result.code)
      return toolFailure(error, classify)
    }
  })
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
    console.error('Failed to write MCP audit event:', error instanceof Error ? error.message : 'unknown error')
  }
}
