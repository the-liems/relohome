import { MovingServiceError } from './errors.js'

function required(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new MovingServiceError('CONFIGURATION_ERROR', `Missing required environment variable: ${name}`)
  return value
}

function positiveInteger(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name] || fallback)
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new MovingServiceError('CONFIGURATION_ERROR', `${name} must be an integer between 1 and ${maximum}.`)
  }
  return value
}

function enabled(name: string, fallback = false) {
  const value = process.env[name]
  if (value === undefined) return fallback
  return value.toLowerCase() === 'true'
}

function applicationDatabaseUrl() {
  if (process.env.MOVING_DATABASE_URL) return process.env.MOVING_DATABASE_URL
  const user = required('POSTGRES_APP_USER')
  const password = required('POSTGRES_APP_PASSWORD')
  const host = process.env.POSTGRES_HOST || '127.0.0.1'
  const port = process.env.POSTGRES_PORT || '5433'
  const database = process.env.POSTGRES_DB || 'lifeflow'
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`
}

export interface MovingRuntimeConfig {
  environment: 'staging' | 'production'
  baseUrl: string
  apiKey?: string
  mobile?: string
  token?: string
  databaseUrl: string
  timeoutMs: number
  quoteTtlSeconds: number
  writeEnabled: boolean
  ratingEnabled: boolean
  productionEnabled: boolean
  webhookAuthMode: 'api-key' | 'bearer' | 'basic'
  webhookSecret?: string
}

/** Provider settings only; for callers that never touch the Moving database. */
export type AhaMoveConfig = Omit<MovingRuntimeConfig, 'databaseUrl'>

export function getAhaMoveConfig(): AhaMoveConfig {
  const environment = (process.env.AHAMOVE_ENV || 'staging') as 'staging' | 'production'
  if (!['staging', 'production'].includes(environment)) {
    throw new MovingServiceError('CONFIGURATION_ERROR', 'AHAMOVE_ENV must be staging or production.')
  }
  const productionEnabled = enabled('AHAMOVE_PRODUCTION_ENABLED')
  if (environment === 'production' && !productionEnabled) {
    throw new MovingServiceError('CONFIGURATION_ERROR', 'Production is blocked until AHAMOVE_PRODUCTION_ENABLED=true.')
  }
  const expectedHost = environment === 'staging'
    ? 'https://partner-apistg.ahamove.com/v3'
    : 'https://partner-api.ahamove.com/v3'
  const baseUrl = (process.env.AHAMOVE_BASE_URL || expectedHost).replace(/\/$/, '')
  if (new URL(baseUrl).origin !== new URL(expectedHost).origin) {
    throw new MovingServiceError('CONFIGURATION_ERROR', 'AHAMOVE_BASE_URL must use the official host for the selected environment.')
  }
  const token = process.env.AHAMOVE_USER_TOKEN?.trim()
  const apiKey = process.env.AHAMOVE_API_KEY?.trim()
  const mobile = process.env.AHAMOVE_MOBILE?.trim()
  if (!token && (!apiKey || !mobile)) {
    throw new MovingServiceError(
      'CONFIGURATION_ERROR',
      'Configure AHAMOVE_USER_TOKEN or both AHAMOVE_API_KEY and AHAMOVE_MOBILE.',
    )
  }
  const webhookAuthMode = process.env.AHAMOVE_WEBHOOK_AUTH_MODE || 'api-key'
  if (!['api-key', 'bearer', 'basic'].includes(webhookAuthMode)) {
    throw new MovingServiceError('CONFIGURATION_ERROR', 'AHAMOVE_WEBHOOK_AUTH_MODE must be api-key, bearer or basic.')
  }
  return {
    environment,
    baseUrl,
    apiKey,
    mobile,
    token,
    timeoutMs: positiveInteger('AHAMOVE_TIMEOUT_MS', 10_000, 120_000),
    quoteTtlSeconds: positiveInteger('AHAMOVE_QUOTE_TTL_SECONDS', 300, 3_600),
    writeEnabled: enabled('AHAMOVE_WRITE_ENABLED'),
    ratingEnabled: enabled('AHAMOVE_RATING_ENABLED'),
    productionEnabled,
    webhookAuthMode: webhookAuthMode as MovingRuntimeConfig['webhookAuthMode'],
    webhookSecret: process.env.AHAMOVE_WEBHOOK_SECRET?.trim(),
  }
}

export function getMovingRuntimeConfig(): MovingRuntimeConfig {
  return { ...getAhaMoveConfig(), databaseUrl: applicationDatabaseUrl() }
}
