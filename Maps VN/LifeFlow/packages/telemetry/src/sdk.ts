import { SpanKind, type Context } from '@opentelemetry/api'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { BatchSpanProcessor, ParentBasedSampler, AlwaysOnSampler, type SpanProcessor, type ReadableSpan, type Span } from '@opentelemetry/sdk-trace-base'
import { BatchLogRecordProcessor, type LogRecordProcessor, type ReadWriteLogRecord } from '@opentelemetry/sdk-logs'
import { PeriodicExportingMetricReader, AggregationType } from '@opentelemetry/sdk-metrics'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici'
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify'
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino'
import { healthPaths } from './index.js'

const safeAttributes = new Set(['http.request.method', 'http.method', 'http.response.status_code', 'http.status_code',
  'http.route', 'db.system', 'db.system.name', 'db.operation', 'db.operation.name', 'server.address', 'server.port',
  'network.protocol.version', 'rpc.system', 'rpc.method', 'error.type', 'lifeflow.operation', 'lifeflow.kind',
  'lifeflow.outcome', 'lifeflow.cache_hit', 'langfuse.session.id', 'langfuse.environment', 'langfuse.observation.type',
  'langfuse.observation.input', 'langfuse.observation.output', 'langfuse.observation.level'])

export class SanitizingSpanProcessor implements SpanProcessor {
  constructor(private delegate: SpanProcessor) {}
  onStart(span: Span, _parent: Context) {
    span.setAttribute('langfuse.environment', process.env.OTEL_DEPLOYMENT_ENVIRONMENT || 'development')
  }
  onEnd(span: ReadableSpan) {
    try {
      const attributes = Object.fromEntries(Object.entries(span.attributes).filter(([key]) => safeAttributes.has(key)))
      let name = span.name
      if (span.attributes['db.system'] || span.attributes['db.system.name']) {
        const raw = String(span.attributes['db.operation.name'] || span.attributes['db.operation'] || span.attributes['db.query.text'] || span.attributes['db.statement'] || 'QUERY')
        const operation = raw.split(/\s+/)[0]?.toUpperCase() || 'QUERY'
        attributes['db.operation.name'] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'COMMIT', 'ROLLBACK', 'BEGIN'].includes(operation) ? operation : 'QUERY'
        name = `db.${attributes['db.operation.name']}`
      } else if (attributes['http.method'] || attributes['http.request.method']) {
        name = `${attributes['http.request.method'] || attributes['http.method']} ${attributes['http.route'] || (span.kind === SpanKind.SERVER ? 'unmatched' : 'request')}`
      }
      this.delegate.onEnd({
        name, attributes, events: [], links: span.links.map(link => ({ context: link.context })),
        kind: span.kind, spanContext: () => span.spanContext(), parentSpanContext: span.parentSpanContext,
        startTime: span.startTime, endTime: span.endTime, duration: span.duration, ended: span.ended,
        resource: span.resource, instrumentationScope: span.instrumentationScope,
        status: { code: span.status.code }, droppedAttributesCount: span.droppedAttributesCount,
        droppedEventsCount: span.droppedEventsCount, droppedLinksCount: span.droppedLinksCount,
      })
    } catch { /* never affect application requests */ }
  }
  forceFlush() { return this.delegate.forceFlush() }
  shutdown() { return this.delegate.shutdown() }
}

class MetadataLogProcessor implements LogRecordProcessor {
  constructor(private delegate: LogRecordProcessor) {}
  onEmit(record: ReadWriteLogRecord, parent?: Context) {
    // Pino payloads/exception messages are not safe to export. Our own logs use a fixed schema.
    const own = record.instrumentationScope.name === 'lifeflow'
    if (!own) {
      record.setBody('application.log')
      for (const key of Object.keys(record.attributes)) delete record.attributes[key]
    }
    this.delegate.onEmit(record, parent)
  }
  forceFlush() { return this.delegate.forceFlush() }
  shutdown() { return this.delegate.shutdown() }
}

const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318').replace(/\/$/, '')
const batch = { maxQueueSize: 2048, maxExportBatchSize: 256, scheduledDelayMillis: 5000, exportTimeoutMillis: 5000 }
const sdk = new NodeSDK({
  autoDetectResources: false,
  resource: resourceFromAttributes({ 'service.name': process.env.OTEL_SERVICE_NAME || 'lifeflow-node',
    'service.namespace': 'lifeflow', 'service.version': process.env.RELEASE_SHA || 'development',
    'deployment.environment.name': process.env.OTEL_DEPLOYMENT_ENVIRONMENT || 'development' }),
  textMapPropagator: new W3CTraceContextPropagator(),
  sampler: new ParentBasedSampler({ root: new AlwaysOnSampler() }),
  spanProcessors: [new SanitizingSpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces`, timeoutMillis: 3000 }), batch))],
  logRecordProcessors: [new MetadataLogProcessor(new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({ url: `${endpoint}/v1/logs`, timeoutMillis: 3000 }), ...batch }))],
  metricReaders: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics`, timeoutMillis: 3000 }), exportIntervalMillis: 15000, exportTimeoutMillis: 5000 })],
  views: [{ instrumentName: 'lifeflow.*.duration', aggregation: { type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
    options: { boundaries: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 180, 240, 300] } } }],
  instrumentations: [
    new HttpInstrumentation({ ignoreIncomingRequestHook: req => healthPaths.has((req.url || '').split('?')[0] || ''),
      startIncomingSpanHook: req => (req.url || '').split('?')[0] === '/mcp' ? { 'http.route': '/mcp' } : {} }),
    new UndiciInstrumentation(), new PgInstrumentation({ enhancedDatabaseReporting: false, requireParentSpan: true }),
    new FastifyInstrumentation(), new PinoInstrumentation(),
  ],
})
sdk.start()
const { metrics } = await import('@opentelemetry/api')
metrics.getMeter('lifeflow').createObservableGauge('lifeflow.heartbeat', { unit: 's' })
  .addCallback(result => result.observe(Date.now() / 1000))
// Do not export console arguments: they may include arbitrary payloads or errors.
const { logEvent } = await import('./index.js')
const { SeverityNumber } = await import('@opentelemetry/api-logs')
for (const level of ['warn', 'error'] as const) {
  const original = console[level].bind(console)
  console[level] = (...args) => {
    logEvent('application.log', { source: 'console' }, level === 'error' ? SeverityNumber.ERROR : SeverityNumber.WARN)
    original(...args)
  }
}
let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  await sdk.shutdown().catch(() => undefined)
}
process.once('beforeExit', () => { void shutdown() })
