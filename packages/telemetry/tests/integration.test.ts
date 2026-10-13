import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { expect, it } from 'vitest'

it('preloads ESM instrumentation, propagates across HTTP, and exports only sanitized OTLP', async () => {
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
      env: { ...process.env, OBSERVABILITY_ENABLED: 'true', OBSERVABILITY_CONTENT_MODE: 'redacted',
        OTEL_DEPLOYMENT_ENVIRONMENT: 'staging', OTEL_SERVICE_NAME: 'node-fixture',
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
    const tool = spans.find(item => item.name === 'echo')
    expect(root).toBeDefined(); expect(tool).toBeDefined()
    expect(tool.traceId).toBe(root.traceId)
    expect(tool.parentSpanId).toBe(root.spanId)
    expect(tool.status.code).toBe(2)
    expect(spans.some(item => item.kind === 2)).toBe(true)
    expect(spans.some(item => item.kind === 3)).toBe(true)
    const exported = JSON.stringify(requests)
    expect(exported).not.toContain('person@example.com')
    expect(exported).not.toContain('fixture-secret')
    expect(exported).not.toContain('private-error-message')
    expect(requests.some(item => item.path === '/v1/logs')).toBe(true)
    expect(requests.some(item => item.path === '/v1/metrics')).toBe(true)
  } finally {
    if (child && child.exitCode === null) child.kill('SIGKILL')
    await new Promise<void>(resolve => receiver.close(() => resolve()))
  }
}, 20000)
