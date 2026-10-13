import { metrics } from '@opentelemetry/api'
import { InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader, AggregationTemporality } from '@opentelemetry/sdk-metrics'
import { afterEach, expect, it, vi } from 'vitest'
import { observeHttp, toolOperation } from '../src/index.js'

const providers: MeterProvider[] = []
afterEach(async () => {
  metrics.disable()
  await Promise.all(providers.splice(0).map(provider => provider.shutdown()))
  vi.unstubAllEnvs()
})

function installMeterProvider() {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE)
  const provider = new MeterProvider({ readers: [new PeriodicExportingMetricReader({
    exporter, exportIntervalMillis: 60_000,
  })] })
  providers.push(provider)
  expect(metrics.setGlobalMeterProvider(provider)).toBe(true)
  return { provider, exporter }
}

it('records after late SDK startup and uses a replacement provider without losing metrics', async () => {
  vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
  metrics.disable()
  observeHttp('GET', '/before-sdk', 200, 20)

  const first = installMeterProvider()
  observeHttp('GET', '/mcp', 200, 20)
  observeHttp('GET', '/mcp', 200, 30)
  observeHttp('GET', '/health', 200, 1)
  await toolOperation('lookup', {}, undefined, async () => ({ ok: true }))
  await first.provider.forceFlush()
  const firstMetrics = first.exporter.getMetrics().flatMap(resource => resource.scopeMetrics).flatMap(scope => scope.metrics)
  expect(firstMetrics.find(metric => metric.descriptor.name === 'relohome.http.requests')?.dataPoints).toEqual([
    expect.objectContaining({ attributes: { method: 'GET', route: '/mcp', status: '200' }, value: 2 }),
  ])
  expect(firstMetrics.find(metric => metric.descriptor.name === 'relohome.operations')?.dataPoints).toEqual([
    expect.objectContaining({ attributes: { operation: 'lookup', kind: 'tool', outcome: 'success' }, value: 1 }),
  ])

  metrics.disable()
  const replacement = installMeterProvider()
  observeHttp('POST', '/mcp', 401, 10)
  await replacement.provider.forceFlush()
  const replacementMetrics = replacement.exporter.getMetrics().flatMap(resource => resource.scopeMetrics).flatMap(scope => scope.metrics)
  expect(replacementMetrics.find(metric => metric.descriptor.name === 'relohome.http.requests')?.dataPoints).toEqual([
    expect.objectContaining({ attributes: { method: 'POST', route: '/mcp', status: '401' }, value: 1 }),
  ])
})
