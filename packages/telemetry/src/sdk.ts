import { NodeSDK } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { PeriodicExportingMetricReader, AggregationType } from '@opentelemetry/sdk-metrics'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici'
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'
import { FastifyOtelInstrumentation } from '@fastify/otel'
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino'
import { healthPaths, markInitialized } from './index.js'

const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318').replace(/\/$/, '')
const batch = { maxQueueSize: 2048, maxExportBatchSize: 256, scheduledDelayMillis: 5000, exportTimeoutMillis: 5000 }
const sdk = new NodeSDK({
  resource: resourceFromAttributes({ 'service.name': process.env.OTEL_SERVICE_NAME || 'relohome-node',
    'service.namespace': 'relohome', 'service.version': process.env.RELEASE_SHA || 'development',
    'deployment.environment.name': process.env.OTEL_DEPLOYMENT_ENVIRONMENT || 'development' }),
  textMapPropagator: new W3CTraceContextPropagator(),
  spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces`, timeoutMillis: 3000 }), batch)],
  logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({ url: `${endpoint}/v1/logs`, timeoutMillis: 3000 }), ...batch })],
  metricReaders: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics`, timeoutMillis: 3000 }), exportIntervalMillis: 15000, exportTimeoutMillis: 5000 })],
  views: [
    { instrumentName: 'relohome.*.duration', aggregation: { type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
      options: { boundaries: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 180, 240, 300] } } },
  ],
  instrumentations: [
    new HttpInstrumentation({ ignoreIncomingRequestHook: req => healthPaths.has((req.url || '').split('?')[0] || ''),
      startIncomingSpanHook: req => (req.url || '').split('?')[0] === '/mcp' ? { 'http.route': '/mcp' } : {} }),
    new UndiciInstrumentation(), new PgInstrumentation({ enhancedDatabaseReporting: false, requireParentSpan: true }),
    new FastifyOtelInstrumentation({ registerOnInitialization: true, instrumentHooks: false,
      ignorePaths: options => healthPaths.has(options.url.split('?')[0] || '') }),
    new PinoInstrumentation(),
  ],
})
sdk.start()
markInitialized()
const { metrics } = await import('@opentelemetry/api')
metrics.getMeter('relohome').createObservableGauge('relohome.heartbeat', { unit: 's' })
  .addCallback(result => result.observe(Date.now() / 1000))
let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  await sdk.shutdown().catch(() => undefined)
}
process.once('beforeExit', () => { void shutdown() })
