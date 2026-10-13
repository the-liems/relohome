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

export interface ApplicationRuntimeConfig {
  databaseUrl: string
  osrmUrls: Record<
    'hcm' | 'hanoi' | 'danang',
    Record<'driving' | 'motorcycle' | 'walking', string>
  >
  commuteCandidateLimit: number
  publicDrivingOsrmUrl?: string
}

export interface RuntimeConfig extends ApplicationRuntimeConfig {
  adminDatabaseUrl: string
  ingestDatabaseUrl: string
  postgresAppUser: string
  postgresAppPassword: string
  postgresIngestUser: string
  postgresIngestPassword: string
}

export function resolvePublicDrivingOsrmUrl(value: string | undefined): string | undefined {
  // Browser device directions may use public/auto policy without a separate
  // opt-in checkbox. An explicitly empty value remains an operator kill switch.
  const publicDrivingOsrmUrl = value === undefined
    ? 'https://routing.openstreetmap.de/routed-car/'
    : value || undefined
  if (publicDrivingOsrmUrl && publicDrivingOsrmUrl !== 'https://routing.openstreetmap.de/routed-car/') {
    throw new Error('OSRM_PUBLIC_DRIVING_URL must be the approved HTTPS FOSSGIS driving endpoint.')
  }
  return publicDrivingOsrmUrl
}

export function getApplicationRuntimeConfig(): ApplicationRuntimeConfig {
  const publicDrivingOsrmUrl = resolvePublicDrivingOsrmUrl(process.env.OSRM_PUBLIC_DRIVING_URL)
  const commuteCandidateLimit = Number(process.env.COMMUTE_CANDIDATE_LIMIT || 100)
  if (!Number.isInteger(commuteCandidateLimit) || commuteCandidateLimit < 1 || commuteCandidateLimit > 1_000) {
    throw new Error('COMMUTE_CANDIDATE_LIMIT must be an integer between 1 and 1000.')
  }

  // Location reads only its own names; a generic DATABASE_URL belongs to another service.
  const resolvedDatabaseUrl = process.env.LOCATION_DATABASE_URL || databaseUrl(
    required('POSTGRES_APP_USER'),
    required('POSTGRES_APP_PASSWORD'),
  )

  return {
    databaseUrl: resolvedDatabaseUrl,
    osrmUrls: {
      hcm: {
        driving: process.env.OSRM_HCM_DRIVING_URL || process.env.OSRM_HCM_URL || 'http://127.0.0.1:5000',
        walking: process.env.OSRM_HCM_WALKING_URL || 'http://127.0.0.1:5010',
        motorcycle: process.env.OSRM_HCM_MOTORCYCLE_URL || 'http://127.0.0.1:5020',
      },
      hanoi: {
        driving: process.env.OSRM_HANOI_DRIVING_URL || process.env.OSRM_HANOI_URL || 'http://127.0.0.1:5001',
        walking: process.env.OSRM_HANOI_WALKING_URL || 'http://127.0.0.1:5011',
        motorcycle: process.env.OSRM_HANOI_MOTORCYCLE_URL || 'http://127.0.0.1:5021',
      },
      danang: {
        driving: process.env.OSRM_DANANG_DRIVING_URL || process.env.OSRM_DANANG_URL || 'http://127.0.0.1:5002',
        walking: process.env.OSRM_DANANG_WALKING_URL || 'http://127.0.0.1:5012',
        motorcycle: process.env.OSRM_DANANG_MOTORCYCLE_URL || 'http://127.0.0.1:5022',
      },
    },
    commuteCandidateLimit,
    publicDrivingOsrmUrl,
  }
}

export function getRuntimeConfig(): RuntimeConfig {
  const applicationConfig = getApplicationRuntimeConfig()
  const appUser = required('POSTGRES_APP_USER')
  const appPassword = required('POSTGRES_APP_PASSWORD')
  const ingestUser = required('POSTGRES_INGEST_USER')
  const ingestPassword = required('POSTGRES_INGEST_PASSWORD')

  return {
    ...applicationConfig,
    adminDatabaseUrl:
      process.env.LOCATION_ADMIN_DATABASE_URL ||
      databaseUrl(required('POSTGRES_ADMIN_USER'), required('POSTGRES_ADMIN_PASSWORD')),
    ingestDatabaseUrl:
      process.env.LOCATION_INGEST_DATABASE_URL ||
      databaseUrl(ingestUser, ingestPassword),
    postgresAppUser: appUser,
    postgresAppPassword: appPassword,
    postgresIngestUser: ingestUser,
    postgresIngestPassword: ingestPassword,
  }
}
