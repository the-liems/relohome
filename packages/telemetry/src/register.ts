// Preload with `node --import @relohome/telemetry/register` before importing service modules.
// Register the ESM hook before loading HTTP/Fastify/pg/undici and the SDK.
try {
  const { register } = await import('node:module')
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url)
  await import('./sdk.js')
} catch (error) {
  // No logger exists before the SDK; keep the cause so a service without telemetry is diagnosable.
  const cause = error instanceof Error ? { error: error.message, stack: error.stack } : { error: String(error) }
  process.stderr.write(JSON.stringify({ event: 'telemetry_initialization_failed', ...cause }) + '\n')
}
export {}
