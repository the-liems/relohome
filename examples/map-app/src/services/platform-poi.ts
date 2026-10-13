import type { CityConfig, PoiCollection } from '../types'

const API_BASE_URL = (import.meta.env.VITE_PLATFORM_API_URL || 'http://127.0.0.1:4100').replace(/\/$/, '')
const cityCache = new Map<string, { collection: PoiCollection; loadedAt: number }>()
const pendingByCity = new Map<string, Promise<PoiCollection>>()
const CACHE_TTL_MS = 5 * 60_000

export async function loadPois(city: CityConfig, signal?: AbortSignal): Promise<PoiCollection> {
  const cached = cityCache.get(city.id)
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.collection

  let pending = pendingByCity.get(city.id)
  if (!pending) {
    pending = fetchCityPois(city).finally(() => pendingByCity.delete(city.id))
    pendingByCity.set(city.id, pending)
  }
  return waitForCaller(pending, signal)
}

async function fetchCityPois(city: CityConfig): Promise<PoiCollection> {
  const [[west, south], [east, north]] = city.bounds
  const response = await fetch(`${API_BASE_URL}/v1/places/map`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bounding_box: { west, south, east, north } }),
  })
  if (!response.ok) throw new Error(`Cannot load all POIs (Platform API ${response.status}).`)
  const collection = await response.json() as PoiCollection
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('Platform API returned invalid map data.')
  }
  // Do not substitute the old accommodation-only file for an all-category map.
  cityCache.set(city.id, { collection, loadedAt: Date.now() })
  return collection
}

function waitForCaller<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('The request was aborted.', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
