import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { expect, it } from 'vitest'

it.skipIf(!process.env.ROOMMATE_TEST_DATABASE_URL).each(['staging', 'production'])(
  'preloads official PostgreSQL instrumentation with safe %s OTLP', async environment => {
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
      child = spawn(process.execPath, ['--import', '@relohome/telemetry/register', fileURLToPath(new URL('./postgres-fixture.mjs', import.meta.url))], {
        env: { ...process.env, OBSERVABILITY_ENABLED: 'true', OBSERVABILITY_CONTENT_MODE: 'metadata',
          APP_ENV: environment, OTEL_DEPLOYMENT_ENVIRONMENT: environment, OTEL_SERVICE_NAME: 'postgres-fixture',
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
      const scopes = requests.filter(item => item.path === '/v1/traces')
        .flatMap(item => item.payload.resourceSpans).flatMap(item => item.scopeSpans)
      expect(scopes.some(item => item.scope.name === '@opentelemetry/instrumentation-pg')).toBe(true)
      const spans = scopes.flatMap(item => item.spans)
      const root = spans.find(item => item.name === 'database.request')
      expect(root).toBeDefined()
      const failed = spans.find(item => item.attributes.some((attribute: any) =>
        attribute.key === 'error.type' && attribute.value.stringValue === '42P01'))
      expect(failed).toBeDefined()
      expect(failed.traceId).toBe(root.traceId)
      expect(failed.parentSpanId).toBe(root.spanId)
      expect(failed.status.code).toBe(2)
      expect(spans.every(item => !item.events?.length && !item.status.message)).toBe(true)
      expect(JSON.stringify(requests)).not.toContain('SYNTHETIC_PRIVATE')
    } finally {
      if (child && child.exitCode === null) child.kill('SIGKILL')
      await new Promise<void>(resolve => receiver.close(() => resolve()))
    }
  }, 20000,
)
