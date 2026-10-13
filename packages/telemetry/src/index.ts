import { context, metrics, trace, SpanKind, SpanStatusCode, type Attributes } from '@opentelemetry/api'
import { logs, SeverityNumber } from '@opentelemetry/api-logs'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { content } from './privacy.js'

const propagator = new W3CTraceContextPropagator()
export const enabled = () => process.env.OBSERVABILITY_ENABLED === 'true'
export const healthPaths = new Set(['/health', '/healthz', '/ready', '/readyz', '/metrics'])

export function logEvent(event: string, attributes: Attributes = {}, severity = SeverityNumber.INFO) {
  if (!enabled()) return
  try { logs.getLogger('lifeflow').emit({ body: event, attributes, severityNumber: severity }) } catch { /* fail open */ }
}

export async function toolOperation<T>(name: string, input: unknown, metadata: unknown, handler: () => Promise<T>): Promise<T> {
  if (!enabled()) return handler()
  const carrier = metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {}
  const headers = Object.fromEntries(Object.entries(carrier)
    .filter(([key, value]) => ['traceparent', 'tracestate'].includes(key) && typeof value === 'string'))
  const parent = propagator.extract(context.active(), headers, {
    keys: Object.keys, get: (object, key) => object[key] as string | undefined,
  })
  const started = performance.now()
  return trace.getTracer('lifeflow').startActiveSpan(name, {
    kind: SpanKind.SERVER,
    attributes: { 'rpc.system': 'mcp', 'rpc.method': name, 'langfuse.observation.type': 'tool',
      'lifeflow.operation': name, 'lifeflow.kind': 'tool' },
  }, parent, async span => {
    let outcome = 'success'
    try {
      const payload = content(input)
      if (payload !== undefined) span.setAttribute('langfuse.observation.input', payload)
      const result = await handler()
      if (result && typeof result === 'object' && 'isError' in result && result.isError) {
        outcome = 'error'; span.setStatus({ code: SpanStatusCode.ERROR })
        span.setAttribute('langfuse.observation.level', 'ERROR')
      }
      const output = content(result)
      if (output !== undefined) span.setAttribute('langfuse.observation.output', output)
      return result
    } catch (error) {
      outcome = 'error'; span.setStatus({ code: SpanStatusCode.ERROR })
      span.setAttribute('error.type', error instanceof Error ? error.name : 'Error')
      throw error
    } finally {
      const duration = (performance.now() - started) / 1000
      span.setAttribute('lifeflow.outcome', outcome)
      const labels = { operation: name, kind: 'tool', outcome }
      const meter = metrics.getMeter('lifeflow')
      meter.createCounter('lifeflow.operations').add(1, labels)
      meter.createHistogram('lifeflow.operation.duration', { unit: 's' }).record(duration, labels)
      logEvent('operation.completed', { ...labels, duration_ms: Math.round(duration * 1000) })
      span.end()
    }
  })
}

export function observeHttp(method: string, route: string, status: number, durationMs: number) {
  if (!enabled() || healthPaths.has(route)) return
  const safeMethod = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method) ? method : 'OTHER'
  const labels = { method: safeMethod, route, status: String(status) }
  const meter = metrics.getMeter('lifeflow')
  meter.createCounter('lifeflow.http.requests').add(1, labels)
  meter.createHistogram('lifeflow.http.duration', { unit: 's' }).record(durationMs / 1000, labels)
  logEvent('http.completed', { ...labels, duration_ms: Math.round(durationMs) })
}

export function traceId(route?: string): string | undefined {
  if (enabled() && route) trace.getSpan(context.active())?.setAttribute('http.route', route)
  return enabled() ? trace.getSpan(context.active())?.spanContext().traceId : undefined
}
