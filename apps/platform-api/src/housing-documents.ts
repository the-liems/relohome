import { createHmac, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { DatabasePool } from '@relohome/housing-query'
import { z } from 'zod'
import { actor, member, moderator, ManagementError } from './housing-management.js'
export function registerHousingDocuments(app: FastifyInstance, pool: DatabasePool) {
  app.get('/v1/landlord/properties/:propertyId/documents', async (request) => {
    const user = actor(request),
      id = z
        .string()
        .uuid()
        .parse((request.params as { propertyId: string }).propertyId)
    await member(pool, user, id)
    return {
      items: (
        await pool.query(
          "SELECT id,label,created_at,'/web/media/housing-documents/' || filename AS url FROM housing.property_documents WHERE property_id=$1 ORDER BY created_at",
          [id],
        )
      ).rows,
    }
  })
  app.post('/v1/landlord/properties/:propertyId/documents', async (request, reply) => {
    const user = actor(request),
      id = z
        .string()
        .uuid()
        .parse((request.params as { propertyId: string }).propertyId)
    await member(pool, user, id)
    const input = z
      .object({
        filename: z.string().regex(/^[a-f0-9]{40}\.png$/),
        content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
        label: z.string().trim().min(1).max(160),
      })
      .parse(request.body)
    const expected = createHmac('sha256', process.env.AGENT_API_TOKEN || '')
      .update(`${id}\n${input.filename}\n${input.content_sha256}`)
      .digest('hex')
    const supplied = String(request.headers['x-housing-document-signature'] || '')
    if (
      !process.env.AGENT_API_TOKEN ||
      supplied.length !== expected.length ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    )
      throw new ManagementError(403, 'Hãy dùng chức năng tải giấy tờ riêng tư.')
    const result = await pool.query(
      `INSERT INTO housing.property_documents(property_id,uploaded_by,filename,content_sha256,label)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(property_id,content_sha256) DO UPDATE SET label=EXCLUDED.label
      RETURNING id,label,filename,created_at`,
      [id, user, input.filename, input.content_sha256, input.label],
    )
    const row = result.rows[0]
    return reply.status(201).send({ ...row, url: '/web/media/housing-documents/' + row.filename })
  })
  app.get('/v1/housing-documents/:filename/access', async (request) => {
    const user = actor(request),
      filename = z
        .string()
        .regex(/^[a-f0-9]{40}\.png$/)
        .parse((request.params as { filename: string }).filename)
    const row = (
      await pool.query('SELECT property_id FROM housing.property_documents WHERE filename=$1', [filename])
    ).rows[0]
    if (!row) throw new ManagementError(404, 'Không tìm thấy giấy tờ.')
    if (!moderator(user)) await member(pool, user, row.property_id)
    return { authorized: true }
  })
}
