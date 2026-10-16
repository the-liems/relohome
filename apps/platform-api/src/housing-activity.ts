import type { FastifyInstance } from 'fastify'
import type { DatabasePool } from '@relohome/housing-query'
import { z } from 'zod'
import { actor, moderator, conversationRole, ManagementError } from './housing-management.js'

// Every read/ack checks current participation or the server's moderator list.
const access = `((e.audience='admin' AND $2)
 OR (e.audience='tenant' AND e.subject_user_id=$1)
 OR (e.audience='landlord' AND ((e.contact_id IS NULL AND e.subject_user_id=$1) OR EXISTS(
  SELECT 1 FROM housing.management_members mm WHERE mm.property_id=e.property_id AND mm.user_id=$1 AND mm.status='active'))))`
export function registerHousingActivity(app: FastifyInstance, pool: DatabasePool) {
  app.get('/v1/housing/activity', async request => {
    const user = actor(request)
    const input = z
      .object({
        admin: z
          .enum(['true', 'false'])
          .optional()
          .transform(value => value === 'true'),
      })
      .parse(request.query)
    if (input.admin && !moderator(user))
      throw new ManagementError(403, 'Chỉ Admin được xem thông báo kiểm duyệt.')
    const result = await pool.query(
      `SELECT e.*,l.title,p.name AS property_name,u.unit_code,
    NOT EXISTS(SELECT 1 FROM housing.activity_reads r WHERE r.event_id=e.id AND r.user_id=$1) AS unread,
    CASE WHEN e.audience='tenant' THEN (SELECT mm.user_id FROM housing.management_members mm WHERE mm.property_id=e.property_id AND mm.status='active' ORDER BY mm.requested_at LIMIT 1) WHEN e.audience='admin' OR e.contact_id IS NOT NULL THEN e.subject_user_id ELSE NULL END AS counterparty_user_id
    FROM housing.activity_events e LEFT JOIN housing.listings l ON l.id=e.listing_id
    LEFT JOIN housing.properties p ON p.id=e.property_id LEFT JOIN housing.units u ON u.id=l.unit_id
    WHERE ${access} AND ${input.admin ? "e.audience='admin'" : "e.audience<>'admin'"}
      AND NOT EXISTS(SELECT 1 FROM housing.contact_archives a WHERE a.request_id=e.contact_id AND a.user_id=$1)
    ORDER BY e.created_at DESC,e.id DESC LIMIT 100`,
      [user, moderator(user)],
    )
    return { items: result.rows }
  })
  app.post('/v1/housing/activity/:eventId/read', async request => {
    const user = actor(request),
      id = z
        .string()
        .uuid()
        .parse((request.params as { eventId: string }).eventId)
    const found = await pool.query(`SELECT e.id,e.contact_id,e.audience,e.created_at FROM housing.activity_events e WHERE e.id=$3 AND ${access}`, [
      user,
      moderator(user),
      id,
    ])
    if (!found.rowCount) throw new ManagementError(404, 'Không tìm thấy thông báo.')
    await pool.query(
      'INSERT INTO housing.activity_reads(event_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [id, user],
    )
    await pool.query(`UPDATE housing.contact_requests cr SET
      landlord_activity_read_at=CASE WHEN e.audience='landlord' THEN greatest(coalesce(cr.landlord_activity_read_at,'epoch'),e.created_at) ELSE cr.landlord_activity_read_at END,
      tenant_activity_read_at=CASE WHEN e.audience='tenant' THEN greatest(coalesce(cr.tenant_activity_read_at,'epoch'),e.created_at) ELSE cr.tenant_activity_read_at END
      FROM housing.activity_events e WHERE e.id=$1 AND cr.id=e.contact_id`,[id])
    return { read: true }
  })
  app.get('/v1/housing/contact-requests/:requestId/activity', async request => {
    const user = actor(request),
      id = z
        .string()
        .uuid()
        .parse((request.params as { requestId: string }).requestId)
    await conversationRole(pool, user, id)
    const result = await pool.query(
      `SELECT e.* FROM housing.activity_events e WHERE e.contact_id=$1 ORDER BY e.created_at,e.id`,
      [id],
    )
    return { items: result.rows }
  })
}
