import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadDotEnv } from 'dotenv'

let environmentLoaded = false

function loadEnvironment() {
  if (environmentLoaded) return
  environmentLoaded = true

  const candidates = [
    process.env.LIFEFLOW_ENV_FILE,
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../.env'),
    resolve(process.cwd(), '../../.env'),
  ].filter((value): value is string => Boolean(value))

  for (const path of candidates) {
    if (existsSync(path)) {
      loadDotEnv({ path, quiet: true })
      return
    }
  }
}

function required(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function databaseUrl(user: string, password: string) {
  const host = process.env.POSTGRES_HOST || '127.0.0.1'
  const port = process.env.POSTGRES_PORT || '5433'
  const database = process.env.POSTGRES_DB || 'lifeflow'
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`
}

export interface RuntimeConfig {
  databaseUrl: string
  adminDatabaseUrl: string
  ingestDatabaseUrl: string
  postgresAppUser: string
  postgresAppPassword: string
  postgresIngestUser: string
  postgresIngestPassword: string
  osrmUrls: Record<'hcm' | 'hanoi' | 'danang', string>
  commuteCandidateLimit: number
}

export function getRuntimeConfig(): RuntimeConfig {
  loadEnvironment()
  const appUser = required('POSTGRES_APP_USER')
  const appPassword = required('POSTGRES_APP_PASSWORD')
  const ingestUser = required('POSTGRES_INGEST_USER')
  const ingestPassword = required('POSTGRES_INGEST_PASSWORD')

  return {
    databaseUrl: process.env.DATABASE_URL || databaseUrl(appUser, appPassword),
    adminDatabaseUrl:
      process.env.ADMIN_DATABASE_URL ||
      databaseUrl(required('POSTGRES_ADMIN_USER'), required('POSTGRES_ADMIN_PASSWORD')),
    ingestDatabaseUrl: process.env.INGEST_DATABASE_URL || databaseUrl(ingestUser, ingestPassword),
    postgresAppUser: appUser,
    postgresAppPassword: appPassword,
    postgresIngestUser: ingestUser,
    postgresIngestPassword: ingestPassword,
    osrmUrls: {
      hcm: process.env.OSRM_HCM_URL || 'http://127.0.0.1:5000',
      hanoi: process.env.OSRM_HANOI_URL || 'http://127.0.0.1:5001',
      danang: process.env.OSRM_DANANG_URL || 'http://127.0.0.1:5002',
    },
    commuteCandidateLimit: Number(process.env.COMMUTE_CANDIDATE_LIMIT || 100),
  }
}
