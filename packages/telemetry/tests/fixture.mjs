import Fastify from 'fastify'
import { createServer } from 'node:http'
import { context, propagation, trace } from '@opentelemetry/api'

const app = Fastify({ logger: true })
app.get('/health', () => ({ status: 'ok' }))
app.get('/failure', () => { throw new TypeError('private-error-message person@example.com fixture-secret') })
app.post('/mcp', async () => {
  console.warn('private-error-message person@example.com')
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ email: 'person@example.com', api_key: 'fixture-secret',
    description: 'SYNTHETIC_PRIVATE_NAME lives at 123 SYNTHETIC_PRIVATE_ADDRESS' }) }] }
})
const url = await app.listen({ host: '127.0.0.1', port: 0 })
const raw = createServer((request, response) => {
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
    body: JSON.stringify({ arguments: { email: 'person@example.com', token: 'fixture-secret',
      input: 'SYNTHETIC_PRIVATE_NAME lives at 123 SYNTHETIC_PRIVATE_ADDRESS' }, _meta: metadata }) })
  if (!response.ok) throw new Error('request failed')
  await response.json()
  const failure = await fetch(`${url}/failure?token=fixture-secret`)
  if (failure.status !== 500) {
    throw new Error('failed request lost its trace context')
  }
  await failure.text()
  for (const target of [`${url}/health`, `${url}/private-error-message`,
    `${rawUrl}/healthz`, `${rawUrl}/mcp?token=fixture-secret`, `${rawUrl}/private-error-message`]) {
    const result = await fetch(target)
    await result.text()
  }
  span.end()
})
await app.close()
await new Promise(resolve => raw.close(resolve))
