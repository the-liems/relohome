import Fastify from 'fastify'
import { context, propagation, trace } from '@opentelemetry/api'
import { toolOperation, observeHttp, traceId } from '../dist/index.js'

const app = Fastify({ logger: true })
app.addHook('onRequest', async (request, reply) => {
  const id = traceId(request.routeOptions.url)
  if (id) reply.header('X-Trace-Id', id)
})
app.addHook('onResponse', async (request, reply) => {
  observeHttp(request.method, request.routeOptions.url || 'unmatched', reply.statusCode, reply.elapsedTime)
})
app.post('/mcp', request => toolOperation('echo', request.body.arguments, request.body._meta, async () => {
  console.warn('private-error-message person@example.com')
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ email: 'person@example.com', api_key: 'fixture-secret' }) }] }
}))
const url = await app.listen({ host: '127.0.0.1', port: 0 })
await trace.getTracer('fixture').startActiveSpan('gateway', async span => {
  const metadata = {}
  propagation.inject(context.active(), metadata)
  const response = await fetch(`${url}/mcp?token=fixture-secret`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ arguments: { email: 'person@example.com', token: 'fixture-secret' }, _meta: metadata }) })
  if (!response.ok || !response.headers.get('x-trace-id')) throw new Error('request failed')
  await response.json()
  span.end()
})
await app.close()
