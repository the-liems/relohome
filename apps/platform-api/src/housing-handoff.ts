import { isDeepStrictEqual } from 'node:util'
import type { FastifyInstance } from 'fastify'
import type { DatabasePool } from '@relohome/housing-query'
import { z } from 'zod'
import { actor, contactCounterpartySql, conversationRole, ManagementError } from './housing-management.js'
import { calendarDate, plausibleRent, startRentPeriod } from './housing-revenue.js'
import { withTransaction } from './transaction.js'

const Id = z.string().uuid()
const Revision = z.number().int().positive()
const OPEN = ['new', 'contacted', 'viewing']
/** Same setting as agent-api, which offers the slots the landlord proposes from. */
export function proposalDays() {
  const days = Number(process.env.HOUSING_VIEWING_PROPOSAL_DAYS || 7)
  return Number.isInteger(days) && days >= 1 && days <= 60 ? days : 7
}
const Options = z.object({
  revision: Revision,
  slots: z
    .array(z.iso.datetime({ offset: true }))
    .min(1)
    .max(100),
})
const Report = z.object({
  report_key: z.string().min(8).max(160),
  amount_vnd: z.number().int().min(1).max(10_000_000_000),
  paid_on: z.iso.date(),
  agreement: z
    .object({
      first_month_vnd: z.number().optional(),
      rent_vnd: z.number().optional(),
      deposit_vnd: z.number().optional(),
      move_in: z.string().nullable().optional(),
    })
    .default({}),
})
const Review = z.object({
  report_id: Id,
  revision: Revision,
  decision: z.enum(['confirm', 'reject']),
  reason: z.string().trim().max(1000).optional(),
})

export function registerHousingHandoff(app: FastifyInstance, pool: DatabasePool) {
  app.post('/v1/landlord/contact-requests/:requestId/viewing-options', async (request) => {
    const user = actor(request),
      id = Id.parse((request.params as { requestId: string }).requestId),
      input = Options.parse(request.body)
    const dates = [...new Set(input.slots.map((value) => new Date(value).toISOString()))].sort()
    const days = proposalDays(),
      now = Date.now(),
      end = now + days * 24 * 60 * 60_000
    if (dates.some((value) => Date.parse(value) <= now || Date.parse(value) > end))
      throw new ManagementError(422, `Chọn giờ phù hợp trong ${days} ngày tới.`)
    return withTransaction(pool, async client => {
      await client.query('SELECT id FROM housing.contact_requests WHERE id=$1 FOR UPDATE', [id])
      const contact = await conversationRole(client, user, id)
      if (contact.role !== 'landlord') throw new ManagementError(403, 'Chỉ chủ nhà quản lý được đề xuất giờ.')
      if (contact.viewing_slot && dates.some(value => new Date(value).getTime() === new Date(contact.viewing_slot as string).getTime()))
        throw new ManagementError(422, 'Chọn giờ thay thế khác với giờ bạn vừa từ chối.')
      const pending = await client.query(
        "SELECT 1 FROM housing.rent_payment_reports WHERE request_id=$1 AND status IN ('pending','confirmed')",
        [id],
      )
      if (pending.rowCount) throw new ManagementError(409, 'Yêu cầu đang xử lý xác nhận chuyển tiền.')
      const result = await client.query(
        `UPDATE housing.contact_requests SET viewing_status='declined',viewing_options=$3::jsonb,
        viewing_updated_at=now(),updated_at=now(),tenant_activity_at=now(),revision=revision+1
        WHERE id=$1 AND revision=$2 AND status=ANY($4::text[]) AND viewing_status IN ('requested','declined') RETURNING *`,
        [id, input.revision, JSON.stringify(dates), OPEN],
      )
      if (!result.rowCount) throw new ManagementError(409, 'Lịch đã thay đổi; tải lại trước khi đề xuất giờ.')
      return result.rows[0]
    })
  })

  app.post('/v1/housing/:listingId/payment-reports', async (request, reply) => {
    const user = actor(request),
      listing = Id.parse((request.params as { listingId: string }).listingId),
      input = Report.parse(request.body)
    const outcome = await withTransaction(pool, async client => {
      // Serialize reports with landlord decisions and other contact state changes.
      const contacts = await client.query(
        `SELECT id FROM housing.contact_requests WHERE listing_id=$1 AND tenant_user_id=$2
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [listing, user],
      )
      const id = contacts.rows[0]?.id
      if (!id) throw new ManagementError(409, 'Chưa có lịch hẹn với chủ nhà để báo chuyển tiền.')
      const contact = await conversationRole(client, user, id)
      if (contact.role !== 'tenant') throw new ManagementError(403, 'Chỉ người thuê được báo chuyển tiền.')
      // Self-dealing guard: any unrevoked tie counts, including a membership still
      // pending review (same rule as self-contact and self-review). Actions on a
      // home, such as archive below, require an active membership instead.
      const self = await client.query(
        `SELECT 1 FROM housing.management_members mm JOIN housing.listings l ON l.property_id=mm.property_id
        WHERE l.id=$1 AND mm.user_id=$2 AND mm.status<>'revoked'`,
        [listing, user],
      )
      if (self.rowCount) throw new ManagementError(409, 'Không thể tự báo chuyển tiền cho nhà bạn quản lý.')
      const prior = await client.query(
        "SELECT *,amount_vnd::float AS amount_vnd,to_char(paid_on,'YYYY-MM-DD') AS paid_on FROM housing.rent_payment_reports WHERE tenant_user_id=$1 AND report_key=$2",
        [user, input.report_key],
      )
      if (prior.rows[0]) {
        const row = prior.rows[0]
        if (
          row.request_id !== id ||
          Number(row.amount_vnd) !== input.amount_vnd ||
          row.paid_on !== input.paid_on ||
          !isDeepStrictEqual(row.agreement, input.agreement)
        )
          throw new ManagementError(409, 'Khóa báo cáo đã dùng cho nội dung khác.')
        return { status: 200, body: row }
      }
      if (!OPEN.includes(String(contact.status)) || contact.viewing_status !== 'confirmed' || !contact.viewing_slot)
        throw new ManagementError(409, 'Cần có lịch đã được chủ nhà xác nhận trước khi báo chuyển tiền.')
      const pending = await client.query(
        "SELECT 1 FROM housing.rent_payment_reports WHERE request_id=$1 AND status IN ('pending','confirmed')",
        [id],
      )
      if (pending.rowCount) throw new ManagementError(409, 'Báo cáo trước đang chờ hoặc đã được chủ nhà xác nhận.')
      const created = await client.query(
        `INSERT INTO housing.rent_payment_reports(request_id,tenant_user_id,report_key,amount_vnd,paid_on,agreement)
        VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING *,amount_vnd::float AS amount_vnd,to_char(paid_on,'YYYY-MM-DD') AS paid_on`,
        [id, user, input.report_key, input.amount_vnd, input.paid_on, JSON.stringify(input.agreement)],
      )
      await client.query(
        'UPDATE housing.contact_requests SET landlord_activity_at=now(),updated_at=now(),revision=revision+1 WHERE id=$1',
        [id],
      )
      return { status: 201, body: created.rows[0] }
    })
    return reply.status(outcome.status).send(outcome.body)
  })

  app.post('/v1/landlord/contact-requests/:requestId/payment-review', async (request) => {
    const user = actor(request),
      id = Id.parse((request.params as { requestId: string }).requestId),
      input = Review.parse(request.body)
    if (input.decision === 'reject' && !input.reason)
      throw new ManagementError(422, 'Nhập phản hồi chưa nhận hoặc số tiền chưa khớp.')
    return withTransaction(pool, async client => {
      await client.query('SELECT id FROM housing.contact_requests WHERE id=$1 FOR UPDATE', [id])
      const contact = await conversationRole(client, user, id)
      if (contact.role !== 'landlord') throw new ManagementError(403, 'Chỉ chủ nhà quản lý được xác nhận nhận tiền.')
      if (!OPEN.includes(String(contact.status)) || contact.viewing_status !== 'confirmed')
        throw new ManagementError(409, 'Yêu cầu đã đóng hoặc lịch không còn được xác nhận.')
      const result = await client.query(
        `UPDATE housing.rent_payment_reports SET status=$4,reason=$5,reviewed_by=$6,reviewed_at=now(),revision=revision+1
        WHERE id=$1 AND request_id=$2 AND revision=$3 AND status='pending' RETURNING *,amount_vnd::float AS amount_vnd,to_char(paid_on,'YYYY-MM-DD') AS paid_on`,
        [
          input.report_id,
          id,
          input.revision,
          input.decision === 'confirm' ? 'confirmed' : 'rejected',
          input.reason || null,
          user,
        ],
      )
      if (!result.rowCount) throw new ManagementError(409, 'Báo cáo đã thay đổi hoặc đã được xử lý.')
      await client.query(
        `UPDATE housing.contact_requests SET status=CASE WHEN $2 THEN 'resolved' ELSE status END,
        tenant_activity_at=now(),updated_at=now(),revision=revision+1 WHERE id=$1`,
        [id, input.decision === 'confirm'],
      )
      if (input.decision === 'confirm')
        await client.query(
          `UPDATE housing.managed_listings SET availability_status='rented',
        availability_confirmed_at=now(),updated_at=now(),revision=revision+1 WHERE listing_id=$1`,
          [contact.listing_id],
        )
      if (input.decision === 'confirm') {
        // Revenue estimates start at the agreed move-in; the deposit is never counted.
        const report = result.rows[0], agreement = report.agreement || {}
        await startRentPeriod(client, String(contact.listing_id), {
          source: 'payment',
          startsOn: calendarDate(agreement.move_in) ?? report.paid_on,
          rentVnd: plausibleRent(agreement.rent_vnd) ?? plausibleRent(agreement.first_month_vnd),
          reportId: String(report.id),
        })
      }
      return result.rows[0]
    })
  })

  app.post('/v1/landlord/contact-requests/:requestId/archive', async (request) => {
    const user = actor(request),
      id = Id.parse((request.params as { requestId: string }).requestId)
    const input = z.object({ revision: Revision }).parse(request.body)
    return withTransaction(pool, async client => {
      await client.query('SELECT id FROM housing.contact_requests WHERE id=$1 FOR UPDATE', [id])
      const contact = await conversationRole(client, user, id)
      // Acting for a home needs an active membership. A legacy self-contact can be
      // cleared by its active property manager too.
      const manager = await client.query(
        `SELECT 1 FROM housing.management_members mm JOIN housing.listings l ON l.property_id=mm.property_id
        WHERE l.id=$1 AND mm.user_id=$2 AND mm.status='active'`,
        [contact.listing_id, user],
      )
      if (!manager.rowCount) throw new ManagementError(403, 'Chỉ chủ nhà quản lý được xóa yêu cầu khỏi hộp thư.')
      if (Number(contact.revision) !== input.revision)
        throw new ManagementError(409, 'Yêu cầu đã thay đổi; tải lại trước khi xóa.')
      if (!['resolved', 'declined'].includes(String(contact.status)) && contact.viewing_status !== 'cancelled')
        throw new ManagementError(409, 'Chỉ xóa yêu cầu đã hoàn tất hoặc đã hủy.')
      const pending = await client.query(
        "SELECT 1 FROM housing.rent_payment_reports WHERE request_id=$1 AND status='pending'",
        [id],
      )
      if (pending.rowCount) throw new ManagementError(409, 'Báo cáo chuyển tiền vẫn đang chờ xử lý.')
      await client.query(
        'INSERT INTO housing.contact_archives(request_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [id, user],
      )
      return { archived: true }
    })
  })

  app.get('/v1/housing/contact-notifications', async (request) => {
    const user = actor(request)
    const result = await pool.query(
      `WITH accessible AS (
      SELECT cr.*,l.title,l.property_id,l.unit_id,p.name AS property_name,u.unit_code,${contactCounterpartySql('$1')} AS counterparty_user_id,
        CASE WHEN cr.tenant_user_id=$1 THEN 'tenant' ELSE 'landlord' END AS role
      FROM housing.contact_requests cr JOIN housing.listings l ON l.id=cr.listing_id
      JOIN housing.properties p ON p.id=l.property_id LEFT JOIN housing.units u ON u.id=l.unit_id
      WHERE (cr.tenant_user_id=$1 OR EXISTS(SELECT 1 FROM housing.management_members mm WHERE mm.property_id=l.property_id AND mm.user_id=$1 AND mm.status='active'))
        AND NOT EXISTS(SELECT 1 FROM housing.contact_archives a WHERE a.request_id=cr.id AND a.user_id=$1)
    ) SELECT cr.id,cr.title,cr.property_id,cr.unit_id,cr.property_name,cr.unit_code,cr.listing_id,cr.viewing_slot,cr.counterparty_user_id,cr.role,cr.status,cr.viewing_status,cr.updated_at,
      (SELECT count(*)::int FROM housing.contact_messages m WHERE m.request_id=cr.id AND m.sender_role<>cr.role
        AND m.created_at>coalesce(CASE WHEN cr.role='tenant' THEN cr.tenant_read_at ELSE cr.landlord_read_at END,'epoch')) AS unread,
      CASE WHEN cr.role='tenant' THEN cr.tenant_activity_at>coalesce(cr.tenant_activity_read_at,'epoch')
        ELSE cr.landlord_activity_at>coalesce(cr.landlord_activity_read_at,'epoch') END AS update_unread,
      (SELECT r.status FROM housing.rent_payment_reports r WHERE r.request_id=cr.id ORDER BY r.created_at DESC,r.id DESC LIMIT 1) AS payment_status
      FROM accessible cr ORDER BY cr.updated_at DESC LIMIT 100`,
      [user],
    )
    return { items: result.rows }
  })
}
