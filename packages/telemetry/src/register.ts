// Preload with `node --import @relohome/telemetry/register` before importing service modules.
// Register the ESM hook before loading HTTP/Fastify/pg/undici and the SDK.
try {
  const { register } = await import('node:module')
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url)
  await import('./sdk.js')
} catch {
  process.stderr.write('{"event":"telemetry_initialization_failed"}\n')
}
export {}
