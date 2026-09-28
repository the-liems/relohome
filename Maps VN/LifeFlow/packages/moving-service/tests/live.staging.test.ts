import { describe, expect, it } from 'vitest'
import { config as loadDotEnv } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AhaMoveClient } from '../src/ahamove-client.js'
import { getMovingRuntimeConfig } from '../src/config.js'

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rootDirectory = resolve(packageDirectory, '../..')
loadDotEnv({
  path: process.env.LIFEFLOW_ENV_FILE || resolve(rootDirectory, '.env'),
  quiet: true,
})

const live = process.env.RUN_AHAMOVE_STAGING_INTEGRATION === '1'

describe.runIf(live)('AhaMove staging API without mocks', () => {
  it('reads current cities, services and one service detail from staging', async () => {
    const config = getMovingRuntimeConfig()
    expect(config.environment).toBe('staging')
    const client = AhaMoveClient.fromConfig(config)
    const cities = await client.listCities('VN')
    expect(cities.length).toBeGreaterThan(0)

    const cityId = process.env.AHAMOVE_TEST_CITY_ID || String((cities[0] as Record<string, unknown>)._id)
    const services = await client.listServices({ city_id: cityId })
    expect(services.length).toBeGreaterThan(0)

    const serviceId = String((services[0] as Record<string, unknown>)._id)
    const service = await client.getService(serviceId)
    expect(service).toBeTruthy()
  })

  it.runIf(Boolean(
    process.env.AHAMOVE_TEST_SERVICE_ID &&
    process.env.AHAMOVE_TEST_PICKUP_ADDRESS &&
    process.env.AHAMOVE_TEST_PICKUP_LAT &&
    process.env.AHAMOVE_TEST_PICKUP_LNG &&
    process.env.AHAMOVE_TEST_PICKUP_NAME &&
    process.env.AHAMOVE_TEST_PICKUP_MOBILE &&
    process.env.AHAMOVE_TEST_DESTINATION_ADDRESS &&
    process.env.AHAMOVE_TEST_DESTINATION_LAT &&
    process.env.AHAMOVE_TEST_DESTINATION_LNG &&
    process.env.AHAMOVE_TEST_DESTINATION_NAME &&
    process.env.AHAMOVE_TEST_DESTINATION_MOBILE
  ))('estimates a real operator-supplied staging route', async () => {
    const config = getMovingRuntimeConfig()
    const client = AhaMoveClient.fromConfig(config)
    const result = await client.estimateOrder({
      order_time: 0,
      path: [
        {
          address: process.env.AHAMOVE_TEST_PICKUP_ADDRESS,
          lat: Number(process.env.AHAMOVE_TEST_PICKUP_LAT),
          lng: Number(process.env.AHAMOVE_TEST_PICKUP_LNG),
          name: process.env.AHAMOVE_TEST_PICKUP_NAME,
          mobile: process.env.AHAMOVE_TEST_PICKUP_MOBILE,
        },
        {
          address: process.env.AHAMOVE_TEST_DESTINATION_ADDRESS,
          lat: Number(process.env.AHAMOVE_TEST_DESTINATION_LAT),
          lng: Number(process.env.AHAMOVE_TEST_DESTINATION_LNG),
          name: process.env.AHAMOVE_TEST_DESTINATION_NAME,
          mobile: process.env.AHAMOVE_TEST_DESTINATION_MOBILE,
          tracking_number: process.env.AHAMOVE_TEST_TRACKING_NUMBER,
        },
      ],
      services: [{ _id: process.env.AHAMOVE_TEST_SERVICE_ID, requests: [] }],
      payment_method: process.env.AHAMOVE_TEST_PAYMENT_METHOD || 'CASH',
    })
    expect(result).toBeTruthy()
  })
})
