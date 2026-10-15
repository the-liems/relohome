import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { expect, it } from 'vitest'

it('preloads official instrumentors and exports HTTP traces, logs and metrics', async () => {
  const requests: Array<{ path: string, payload: any }> = []
  const receiver = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    let body = Buffer.concat(chunks)
    if (req.headers['content-encoding'] === 'gzip') body = gunzipSync(body)
    requests.push({ path: req.url || '', payload: JSON.parse(body.toString()) })
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}')
  })
  await new Promise<void>(resolve => receiver.listen(0, '127.0.0.1', resolve))
  const port = (receiver.address() as { port: number }).port
  let child: ReturnType<typeof spawn> | undefined
  try {
    child = spawn(process.execPath, ['--import', '@relohome/telemetry/register', fileURLToPath(new URL('./fixture.mjs', import.meta.url))], {
      env: { ...process.env, OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
        OTEL_RESOURCE_ATTRIBUTES: 'service.namespace=relohome,deployment.environment.name=staging', OTEL_SERVICE_NAME: 'node-fixture',
        OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`, OTEL_EXPORTER_OTLP_HEADERS: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr!.on('data', chunk => { stderr += chunk })
    child.stdout!.resume()
    const code = await new Promise<number | null>((resolve, reject) => {
      child!.once('error', reject); child!.once('exit', resolve)
    })
    expect(code, stderr).toBe(0)
    expect(stderr).not.toContain('telemetry_initialization_failed')
    const spans = requests.filter(item => item.path === '/v1/traces')
      .flatMap(item => item.payload.resourceSpans).flatMap(item => item.scopeSpans).flatMap(item => item.spans)
    const root = spans.find(item => item.name === 'gateway')
    expect(root).toBeDefined()
    const traceResources = requests.filter(item => item.path === '/v1/traces').flatMap(item => item.payload.resourceSpans)
    expect(traceResources.every(item => item.resource.attributes.some((attribute: any) =>
      attribute.key === 'service.namespace' && attribute.value.stringValue === 'relohome'))).toBe(true)
    expect(spans.some(item => item.kind === 2)).toBe(true)
    expect(spans.some(item => item.kind === 3)).toBe(true)
    const failures = spans.filter(item => item.attributes.some((attribute: any) =>
      attribute.key === 'http.route' && attribute.value.stringValue === '/failure'))
    expect(failures.filter(item => item.kind === 2)).toHaveLength(1)
    expect(failures.filter(item => item.kind === 2)[0].status.code).toBe(2)
    expect(spans.some(item => item.events?.some((event: any) => event.name === 'exception'))).toBe(true)
    expect(requests.some(item => item.path === '/v1/logs')).toBe(true)
    expect(requests.some(item => item.path === '/v1/metrics')).toBe(true)
    const metricNames = requests.filter(item => item.path === '/v1/metrics')
      .flatMap(item => item.payload.resourceMetrics).flatMap(item => item.scopeMetrics).flatMap(item => item.metrics)
      .map(item => item.name)
    expect(metricNames.some(name => name.startsWith('http.server.'))).toBe(true)
  } finally {
    if (child && child.exitCode === null) child.kill('SIGKILL')
    await new Promise<void>(resolve => receiver.close(() => resolve()))
  }
}, 20000)
