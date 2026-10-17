// Use an activated environment, PYTHON override, or the documented root venv.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const windows = process.platform === 'win32';
const venv = resolve(root, '.venv', windows ? 'Scripts/python.exe' : 'bin/python');
const fallback = windows ? 'python' : 'python3';
const python = process.env.PYTHON || (
  process.env.VIRTUAL_ENV ? fallback : existsSync(venv) ? venv : fallback
);
const args = process.argv.slice(2);
const env = { ...process.env, RELOHOME_RUNTIME_ROOT: process.env.RELOHOME_RUNTIME_ROOT || root };
// Invoke the official CLI entry point using the selected Python environment.
if (args[0] === '--instrument') {
  Object.assign(env, { OTEL_EXPORTER_OTLP_PROTOCOL: env.OTEL_EXPORTER_OTLP_PROTOCOL || 'http/protobuf',
    OTEL_SEMCONV_STABILITY_OPT_IN: env.OTEL_SEMCONV_STABILITY_OPT_IN || 'http',
    OTEL_PROPAGATORS: 'tracecontext',
    OTEL_PYTHON_LOG_CORRELATION: env.OTEL_PYTHON_LOG_CORRELATION || 'true',
    OTEL_PYTHON_LOG_LEVEL: env.OTEL_PYTHON_LOG_LEVEL || 'info',
    OTEL_PYTHON_EXCLUDED_URLS: '/(healthz?|readyz?|metrics)(\\?.*)?$|/(assets|images)/',
    OTEL_RESOURCE_ATTRIBUTES: env.OTEL_RESOURCE_ATTRIBUTES || 'service.namespace=relohome' });
  const service = process.env.OTEL_SERVICE_NAME || args[1];
  args.splice(0, 2, '-c', 'from opentelemetry.instrumentation.auto_instrumentation import run; run()', '--service_name', service, python);
}
const result = spawnSync(python, args, { cwd: root, stdio: 'inherit', env });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
