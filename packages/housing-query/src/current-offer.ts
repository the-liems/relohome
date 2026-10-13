// Same winning-offer rules as housing.current_offers, without carrying the
// provider payload through every sort/join. Migration 019 covers these fields.
export const CURRENT_OFFERS = `(
  SELECT DISTINCT ON (listing_id)
    id,listing_id,price_amount,deposit_amount,currency,price_period,
    availability_from,availability_to
  FROM housing.offers
  WHERE is_active AND valid_from <= now() AND (valid_to IS NULL OR valid_to > now())
  ORDER BY listing_id,valid_from DESC,created_at DESC,id DESC
)`

export function candidateFrom(indexed: boolean) {
  return indexed
    ? `FROM housing.map_points l JOIN ${CURRENT_OFFERS} o ON o.listing_id=l.id`
    : `FROM housing.listings l
       JOIN housing.properties p ON p.id=l.property_id
       LEFT JOIN housing.units u ON u.id=l.unit_id AND u.deleted_at IS NULL
       JOIN ${CURRENT_OFFERS} o ON o.listing_id=l.id
       JOIN catalog.places cp ON cp.id=p.place_id`
}
