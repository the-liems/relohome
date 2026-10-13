import type { DatabasePool } from '@relohome/housing-query'
import { ManagementError, member } from './housing-management.js'

export type HousingClient = { query: DatabasePool['query'] }
export async function lockedListing(client: HousingClient, user: string, listing: string, revision?: number) {
  const result = await client.query(
    `SELECT ml.*,l.property_id FROM housing.managed_listings ml
    JOIN housing.listings l ON l.id=ml.listing_id WHERE ml.listing_id=$1 AND l.deleted_at IS NULL FOR UPDATE OF ml,l`,
    [listing],
  )
  const row = result.rows[0]
  if (!row) throw new ManagementError(404, 'Không tìm thấy tin nhà.')
  await member(client, user, String(row.property_id))
  if (revision !== undefined && row.revision !== revision)
    throw new ManagementError(409, 'Tin đã được cập nhật. Hãy tải lại trước khi tiếp tục.', 'revision_conflict')
  return row
}
export async function listingIssues(client: HousingClient, listing: string): Promise<Record<string, string>> {
  const result = await client.query(
    `SELECT l.title,l.description,p.property_type,p.location_confirmed_at,
    cp.address,ST_X(cp.geom)::float AS lng,ST_Y(cp.geom)::float AS lat,u.area_m2,
    o.price_amount::float AS rent_vnd,
    (SELECT count(*) FROM housing.listing_media m WHERE m.listing_id=l.id AND m.deleted_at IS NULL
      AND m.moderation_status<>'rejected' AND (m.content_sha256 IS NOT NULL OR m.moderation_status='approved'))::int AS images
    FROM housing.listings l JOIN housing.properties p ON p.id=l.property_id
    JOIN catalog.places cp ON cp.id=p.place_id LEFT JOIN housing.units u ON u.id=l.unit_id AND u.deleted_at IS NULL
    LEFT JOIN housing.current_offers o ON o.listing_id=l.id WHERE l.id=$1`,
    [listing],
  )
  const row = result.rows[0],
    issues: Record<string, string> = {}
  if (!row) return { listing: 'Không tìm thấy tin nhà.' }
  if (String(row.title || '').trim().length < 5) issues.title = 'Tiêu đề cần ít nhất 5 ký tự.'
  if (!String(row.description || '').trim()) issues.description = 'Hãy thêm mô tả phòng.'
  if (!String(row.address?.full_address || row.address?.raw || '').trim()) issues.address = 'Hãy nhập địa chỉ đầy đủ.'
  if (!row.location_confirmed_at || !Number.isFinite(row.lat) || !Number.isFinite(row.lng))
    issues.location = 'Hãy chọn và xác nhận vị trí trên bản đồ.'
  if (!(Number(row.rent_vnd) > 0)) issues.rent_vnd = 'Giá thuê cần lớn hơn 0 và có hiệu lực.'
  if (!(Number(row.area_m2) > 0)) issues.area_m2 = 'Hãy nhập diện tích phòng lớn hơn 0.'
  if (!row.property_type) issues.property_type = 'Hãy chọn loại nhà/phòng.'
  if (!row.images) issues.images = 'Hãy tải ít nhất một ảnh phòng hợp lệ.'
  return issues
}
export async function requireCompleteListing(client: HousingClient, listing: string) {
  const issues = await listingIssues(client, listing)
  if (Object.keys(issues).length)
    throw new ManagementError(422, 'Tin chưa đủ thông tin để gửi duyệt.', 'listing_incomplete', issues)
}
export async function revisionOf(client: HousingClient, listing: string) {
  const result = await client.query(
    'SELECT revision,publication_status FROM housing.managed_listings WHERE listing_id=$1',
    [listing],
  )
  return result.rows[0]
}
