const personalKeys = new Set(['name', 'full_name', 'first_name', 'last_name', 'dob', 'date_of_birth',
  'birthday', 'email', 'phone', 'phone_number', 'mobile', 'contact', 'address', 'cccd', 'cmnd', 'passport',
  'id_number', 'passengers_detail', 'pickup_contact', 'destination_contact'])
const secretKey = /(?:^|_)(?:api_?key|authorization|cookie|password|secret|token|key1|key2|signature|credential)(?:$|_)/i

function cleanText(value: string, personal: boolean): string {
  let result = value.replace(/https?:\/\/[^\s"<>]+/g, (text) => {
    try { const url = new URL(text); return `${url.protocol}//${url.hostname}${url.pathname}` }
    catch { return '[url]' }
  }).replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, '[credential]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '[credential]')
    .replace(/(\b(?:api[_-]?key|authorization|password|secret|access[_-]?token|token|signature)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}]+)/gi, '$1[redacted]')
  if (personal) result = result.replace(/[^@\s"<>]+@[^@\s"<>]+\.[^@\s"<>]+/g, '[email]')
    .replace(/(?<!\d)\d{12}(?!\d)/g, '[identity]')
    .replace(/(?<![\d.])(?:\+84|0)(?:[\s.-]?\d){8,10}(?![\d.])/g, '[phone]')
  return result
}

export function sanitize(value: unknown, personal = true, depth = 0): unknown {
  if (depth > 12) return '[depth limit]'
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) return value.slice(0, 200).map(item => sanitize(item, personal, depth + 1))
  if (typeof value === 'string') {
    if (/^\s*[\[{]/.test(value)) {
      try { return sanitize(JSON.parse(value), personal, depth + 1) } catch { /* ordinary text */ }
    }
    return cleanText(value, personal)
  }
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).slice(0, 200).map(([key, item]) => {
      const normalized = key.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replaceAll('-', '_')
      const output = secretKey.test(normalized) || ['pay_url', 'qr_code', 'pii_refs', 'provider_data'].includes(normalized)
        ? '[credential]' : personal && personalKeys.has(normalized) ? '[personal]' : sanitize(item, personal, depth + 1)
      return [cleanText(key, true), output]
    }))
  }
  return '[unsupported]'
}

export function content(value: unknown): string | undefined {
  // Free text cannot be reliably anonymized with patterns. Production never
  // exports payload content, including under a legacy redacted/raw setting.
  if (['APP_ENV', 'OTEL_DEPLOYMENT_ENVIRONMENT'].some(key => process.env[key]?.trim().toLowerCase() === 'production')) return undefined
  const mode = (process.env.OBSERVABILITY_CONTENT_MODE || 'metadata').trim().toLowerCase()
  if (!['redacted', 'raw'].includes(mode)) return undefined
  try {
    const result = JSON.stringify(sanitize(value, mode !== 'raw'))
    const encoded = Buffer.from(result)
    return encoded.length > 16 * 1024 ? encoded.subarray(0, 16 * 1024 - 16).toString('utf8') + ' [truncated]' : result
  } catch { return undefined }
}
