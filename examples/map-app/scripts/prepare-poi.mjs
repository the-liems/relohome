import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const [, , inputArg, outputArg] = process.argv
const input = inputArg || process.env.RELOHOME_POI_INPUT
const output = outputArg || process.env.RELOHOME_POI_OUTPUT
if (!input || !output) {
  throw new Error('Set RELOHOME_POI_INPUT and RELOHOME_POI_OUTPUT, or pass <input.geojson> <output.geojson>. Output must be outside the repository; the map uses the Platform API.')
}

const inputPath = resolve(input)
const outputPath = resolve(output)
const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const relativeOutput = relative(repositoryRoot, outputPath)
const outsideRepository = relativeOutput === '..' || relativeOutput.startsWith('..' + sep) || isAbsolute(relativeOutput)
if (outputPath === inputPath || !outsideRepository) {
  throw new Error('POI output must be outside the repository and must not overwrite the input.')
}
const source = JSON.parse(await readFile(inputPath, 'utf8'))

if (source.type !== 'FeatureCollection' || !Array.isArray(source.features)) {
  throw new Error('Input must be a GeoJSON FeatureCollection.')
}

const features = source.features.flatMap((feature) => {
  const coordinate = representativePoint(feature.geometry)
  if (!coordinate) return []

  return [{
    type: 'Feature',
    id: feature.id,
    properties: feature.properties || {},
    geometry: { type: 'Point', coordinates: coordinate },
  }]
})

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(
  outputPath,
  JSON.stringify({ type: 'FeatureCollection', features }),
  'utf8',
)

console.log(`Prepared ${features.length} POIs from ${source.features.length} source features.`)

function representativePoint(geometry) {
  if (!geometry) return null
  if (geometry.type === 'Point') return validCoordinate(geometry.coordinates)

  const coordinates = []
  collectCoordinates(geometry.coordinates, coordinates)
  if (!coordinates.length) return null

  const sum = coordinates.reduce(
    (result, coordinate) => [result[0] + coordinate[0], result[1] + coordinate[1]],
    [0, 0],
  )
  return [sum[0] / coordinates.length, sum[1] / coordinates.length]
}

function collectCoordinates(value, output) {
  const coordinate = validCoordinate(value)
  if (coordinate) {
    output.push(coordinate)
    return
  }
  if (Array.isArray(value)) value.forEach((item) => collectCoordinates(item, output))
}

function validCoordinate(value) {
  if (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  ) {
    return [value[0], value[1]]
  }
  return null
}
