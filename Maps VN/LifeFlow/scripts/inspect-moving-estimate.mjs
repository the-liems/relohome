// Read-only staging diagnostic. Prints response structure and price/error fields only, never contacts/tokens.
import { AhaMoveClient, getMovingRuntimeConfig, toAhaMoveOrderBase } from '@relohome/moving-service'
const config = getMovingRuntimeConfig()
if (config.environment !== 'staging') throw new Error('Staging only')
const route = JSON.parse(process.env.MOVING_LIVE_QUOTE_INPUTS || '{}')
if (!route.pickup_coordinate || !route.destination_coordinate) throw new Error('Operator-approved route required')
const client = AhaMoveClient.fromConfig(config)
const services = await client.listServices({ ...route.pickup_coordinate, delivery_type: 'TRUCK' })
const point = (address, coordinate) => ({address, coordinate, name: process.env.MOVING_QUOTE_CONTACT_NAME, mobile: process.env.MOVING_QUOTE_CONTACT_MOBILE})
const draft = {pickup:point(route.from_address, route.pickup_coordinate), destinations:[point(route.to_address, route.destination_coordinate)], payment_method:'CASH', order_time:Math.floor(Date.now()/1000)+172800}
const payload = await client.estimateOrder({...toAhaMoveOrderBase(draft), services:services.slice(0,3).map(s => ({_id:s._id, requests:[]}))})
function shape(v, depth=0) {
  if (depth>6) return typeof v
  if (Array.isArray(v)) return v.slice(0,3).map(x=>shape(x,depth+1))
  if (v && typeof v==='object') return Object.fromEntries(Object.entries(v).map(([k,x])=>[k, /^(total_price|total_fee|total_pay|distance|duration|code|error_code|service_id|_id)$/.test(k) ? x : shape(x,depth+1)]))
  return typeof v
}
console.log(JSON.stringify(shape(payload), null, 2))
