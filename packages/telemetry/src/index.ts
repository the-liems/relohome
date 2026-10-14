import { context, metrics, trace, SpanKind, SpanStatusCode, type Attributes, type MeterProvider } from '@opentelemetry/api'
import { logs, SeverityNumber } from '@opentelemetry/api-logs'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { content } from './privacy.js'

const propagator = new W3CTraceContextPropagator()
let initialized = false
export const enabled = () => initialized
export function markInitialized() { initialized = true }
export const healthPaths = new Set(['/health', '/healthz', '/ready', '/readyz', '/metrics'])

function createInstruments(provider: MeterProvider) {
  const meter = provider.getMeter('relohome')
  return {
    operations: meter.createCounter('relohome.operations'),
    operationDuration: meter.createHistogram('relohome.operation.duration', { unit: 's' }),
    httpRequests: meter.createCounter('relohome.http.requests'),
    httpDuration: meter.createHistogram('relohome.http.duration', { unit: 's' }),
  }
}

const instrumentsByProvider = new WeakMap<MeterProvider, ReturnType<typeof createInstruments>>()
function instruments() {
  // Resolve per provider so calls before SDK startup cannot pin no-op instruments.
  const provider = metrics.getMeterProvider()
  let result = instrumentsByProvider.get(provider)
  if (!result) {
    result = createInstruments(provider)
    instrumentsByProvider.set(provider, result)
  }
  return result
}

export function logEvent(event: string, attributes: Attributes = {}, severity = SeverityNumber.INFO) {
  if (!enabled()) return
  try { logs.getLogger('relohome').emit({ body: event, attributes, severityNumber: severity }) } catch { /* fail open */ }
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
  return trace.getTracer('relohome').startActiveSpan(name, {
    kind: SpanKind.SERVER,
    attributes: { 'rpc.system': 'mcp', 'rpc.method': name, 'langfuse.observation.type': 'tool',
      'relohome.operation': name, 'relohome.kind': 'tool' },
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
      span.setAttribute('relohome.outcome', outcome)
      const labels = { operation: name, kind: 'tool', outcome }
      const meter = instruments()
      meter.operations.add(1, labels)
      meter.operationDuration.record(duration, labels)
      logEvent('operation.completed', { ...labels, duration_ms: Math.round(duration * 1000) })
      span.end()
    }
  })
}

export function observeHttp(method: string, route: string, status: number, durationMs: number) {
  if (!enabled() || healthPaths.has(route)) return
  const safeMethod = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method) ? method : 'OTHER'
  const labels = { method: safeMethod, route, status: String(status) }
  const meter = instruments()
  meter.httpRequests.add(1, labels)
  meter.httpDuration.record(durationMs / 1000, labels)
  logEvent('http.completed', { ...labels, duration_ms: Math.round(durationMs) })
}

export function traceId(route?: string): string | undefined {
  if (enabled() && route) trace.getSpan(context.active())?.setAttribute('http.route', route)
  return enabled() ? trace.getSpan(context.active())?.spanContext().traceId : undefined
}

/** Attach telemetry before routing, including authorization failures and unknown paths. */
export function instrumentHttpRequest(request: IncomingMessage, response: ServerResponse, routes: readonly string[]) {
  if (!enabled()) return
  const started = performance.now()
  const path = (request.url || '/').split('?')[0] || '/'
  const route = routes.includes(path) ? path : 'unmatched'
  const id = traceId(route)
  if (id) response.setHeader('X-Trace-Id', id)
  response.once('finish', () => observeHttp(request.method || 'OTHER', route, response.statusCode, performance.now() - started))
}

// Depend on the hook surface only: raw HTTP services need not install Fastify.
interface TelemetryFastifyApp {
  addHook(name: 'onRequest' | 'onResponse', hook: (
    request: { method: string, routeOptions: { url?: string } },
    reply: { header(name: string, value: string): unknown, statusCode: number, elapsedTime: number },
  ) => Promise<void>): unknown
}

export function registerFastifyTelemetry(app: TelemetryFastifyApp) {
  app.addHook('onRequest', async (request, reply) => {
    const id = traceId(request.routeOptions.url || 'unmatched')
    if (id) reply.header('X-Trace-Id', id)
  })
  app.addHook('onResponse', async (request, reply) => {
    observeHttp(request.method, request.routeOptions.url || 'unmatched', reply.statusCode, reply.elapsedTime)
  })
}
