import Fastify from 'fastify'
import { createServer } from 'node:http'
import { context, propagation, trace } from '@opentelemetry/api'
import { toolOperation, instrumentHttpRequest, registerFastifyTelemetry } from '../dist/index.js'

const app = Fastify({ logger: true })
registerFastifyTelemetry(app)
app.get('/health', () => ({ status: 'ok' }))
app.post('/mcp', request => toolOperation('echo', request.body.arguments, request.body._meta, async () => {
  console.warn('private-error-message person@example.com')
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ email: 'person@example.com', api_key: 'fixture-secret' }) }] }
}))
const url = await app.listen({ host: '127.0.0.1', port: 0 })
const raw = createServer((request, response) => {
  instrumentHttpRequest(request, response, ['/mcp', '/healthz'])
  const path = request.url.split('?')[0]
  response.statusCode = path === '/mcp' ? 401 : path === '/healthz' ? 200 : 404
  response.end('{}')
})
await new Promise(resolve => raw.listen(0, '127.0.0.1', resolve))
const rawUrl = `http://127.0.0.1:${raw.address().port}`
await trace.getTracer('fixture').startActiveSpan('gateway', async span => {
  const metadata = {}
  propagation.inject(context.active(), metadata)
  const response = await fetch(`${url}/mcp?token=fixture-secret`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ arguments: { email: 'person@example.com', token: 'fixture-secret' }, _meta: metadata }) })
  if (!response.ok || !response.headers.get('x-trace-id')) throw new Error('request failed')
  await response.json()
  for (const target of [`${url}/health`, `${url}/private-error-message`,
    `${rawUrl}/healthz`, `${rawUrl}/mcp?token=fixture-secret`, `${rawUrl}/private-error-message`]) {
    const result = await fetch(target)
    if (!target.endsWith('/health') && !target.endsWith('/healthz') && result.headers.get('x-trace-id') !== span.spanContext().traceId) {
      throw new Error('response trace ID does not match caller')
    }
    await result.text()
  }
  span.end()
})
await app.close()
await new Promise(resolve => raw.close(resolve))
