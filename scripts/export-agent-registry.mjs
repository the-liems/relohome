// Offline schema export. No service is started and no provider response is created.
// Complex schemas come from the same compiled Zod contracts as the Moving MCP server.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(resolve(root, 'Maps VN/LifeFlow/package.json'));
const { z } = require('zod');
const c = await import(new URL('../Maps%20VN/LifeFlow/packages/contracts/dist/index.js', import.meta.url));
const rows = [];
const envelope = fields => z.object({ meta: c.MovingToolMetaSchema, ...fields });
function add(name, description, input, output, intent = null, trusted = {}) {
  rows.push({ service: 'moving', name, description, contract_version: '1.0.0',
    mode: intent ? 'write' : 'read', allowed_intents: intent ? [intent] : [], trusted_arguments: trusted,
    input_schema: z.toJSONSchema(input, { io: 'input' }),
    output_schema: z.toJSONSchema(output, { io: 'output' }), timeout_seconds: 30, result_ttl_seconds: 300 });
}
const id = () => z.string().trim().min(1);
add('list_service_areas', 'List factual AhaMove service cities.',
    z.object({ country_id: z.string().trim().length(2).default('VN') }), envelope({ cities: z.array(c.MovingCitySchema) }));
add('list_moving_services', 'List vehicle services by city or pickup coordinate.',
    z.object({ city_id: id().optional(), lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(), delivery_type: z.enum(['INSTANT', 'TRUCK']).optional() }),
    envelope({ services: z.array(c.MovingServiceOptionSchema) }));
add('get_moving_service', 'Get limits and details of a chosen service ID.', z.object({ service_id: id() }),
    envelope({ service: c.MovingServiceOptionSchema }));
add('estimate_move', 'Estimate factual fees and distance; requires a complete draft and selected service IDs.',
    c.EstimateMoveRequestSchema, envelope({ quote: c.MoveQuoteSchema }));
add('get_move_order', 'Get status of an existing order.',
    z.object({ order_id: id(), include_tracking_link: z.boolean().default(false) }), envelope({ order: c.MovingOrderSchema }));
add('get_move_orders', 'Read at most 100 existing orders.', z.object({ order_ids: z.array(id()).min(1).max(100) }),
    envelope({ orders: z.array(c.MovingOrderSchema) }));
add('find_move_orders_by_tracking_number', 'Find orders by partner tracking number for reconciliation.',
    z.object({ tracking_number: id(), from_time: z.number().int().nonnegative().optional(),
      to_time: z.number().int().nonnegative().optional() }), envelope({ orders: z.array(c.MovingOrderSchema) }));
add('get_move_tracking_link', 'Get tracking URL for an existing order.', z.object({ order_id: id() }),
    envelope({ shared_link: z.url() }));
add('get_move_order_events', 'Read callback history by partner tracking number.', z.object({ tracking_number: id() }),
    envelope({ callback: z.record(z.string(), z.unknown()) }));
add('create_move_order', 'Create one explicitly requested move using an unexpired selected quote.',
    c.CreateMoveOrderRequestSchema, envelope({ order: c.MovingOrderSchema }), 'moving_create',
    { approval_id: 'approval_id', workflow_id: 'workflow_id', action_id: 'action_id' });
add('update_move_order', 'Update allowed fields of an existing order.', c.UpdateMoveOrderRequestSchema,
    envelope({ order: c.MovingOrderSchema }), 'moving_update', { approval_id: 'approval_id' });
add('cancel_move_order', 'Cancel the requested existing order; exactly one order_id or tracking_number.',
    c.CancelMoveOrderRequestSchema, envelope({ order: c.MovingOrderSchema }), 'moving_cancel', { approval_id: 'approval_id' });
add('rate_move_driver', 'Rate a completed move (disabled at provider service by default).',
    c.RateMoveDriverRequestSchema, envelope({ rated: z.boolean(), order_id: z.string() }), 'moving_update', { approval_id: 'approval_id' });
// Zod refinements are not representable automatically; encode important cross-field rules explicitly.
const cancel = rows.find(t => t.name === 'cancel_move_order');
cancel.input_schema.oneOf = [
  { required: ['order_id'], not: { required: ['tracking_number'] } },
  { required: ['tracking_number'], not: { required: ['order_id'] } },
];
const source = readFileSync(resolve(root, 'Maps VN/LifeFlow/moving-mcp-server/src/create-server.ts'), 'utf8');
const names = [...source.matchAll(/server\.registerTool\('([^']+)'/g)].map(m => m[1]).sort();
if (JSON.stringify(names) !== JSON.stringify(rows.map(t => t.name).sort())) throw Error('Moving tool inventory drift');
const output = JSON.stringify({ version: '1.0.0',
  source: 'Maps VN/LifeFlow/moving-mcp-server/src/create-server.ts + packages/contracts/src/moving.ts; offline metadata only',
  tools: rows }, null, 2) + '\n';
const path = resolve(root, 'config/agent-services/registry.json');
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== output) throw Error('Registry is stale; rebuild contracts and export it again.');
} else {
  mkdirSync(resolve(root, 'config/agent-services'), { recursive: true });
  writeFileSync(path, output);
}
console.log(`Verified ${rows.length} real Moving tool contracts; no MCP connection or provider call.`);
