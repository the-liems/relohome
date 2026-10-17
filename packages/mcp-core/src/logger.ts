import pino from 'pino'

/**
 * One process logger for the MCP servers, exported to OTLP by @relohome/telemetry's pino instrumentation.
 * It writes to stderr because a stdio transport reserves stdout for MCP protocol messages.
 */
export const logger = pino({}, pino.destination(2))
