import { context, metrics, trace, SpanKind, SpanStatusCode, type Attributes, type MeterProvider } from '@opentelemetry/api'
import { logs, SeverityNumber } from '@opentelemetry/api-logs'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
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
