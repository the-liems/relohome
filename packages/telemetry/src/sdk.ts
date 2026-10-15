import { NodeSDK } from '@opentelemetry/sdk-node'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici'
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'
import { FastifyOtelInstrumentation } from '@fastify/otel'
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino'

const healthPaths = new Set(['/health', '/healthz', '/ready', '/readyz', '/metrics'])

const sdk = new NodeSDK({
  instrumentations: [
    new HttpInstrumentation({ ignoreIncomingRequestHook: req => healthPaths.has((req.url || '').split('?')[0] || '') }),
    new UndiciInstrumentation(), new PgInstrumentation({ enhancedDatabaseReporting: false, requireParentSpan: true }),
    new FastifyOtelInstrumentation({ registerOnInitialization: true, instrumentHooks: false,
      ignorePaths: options => healthPaths.has(options.url.split('?')[0] || '') }),
    new PinoInstrumentation(),
  ],
})
sdk.start()
let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  await sdk.shutdown().catch(() => undefined)
}
process.once('beforeExit', () => { void shutdown() })
