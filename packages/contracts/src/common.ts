import { z } from 'zod'

export const LongitudeSchema = z.number().finite().min(-180).max(180)
export const LatitudeSchema = z.number().finite().min(-90).max(90)

export const CoordinateSchema = z.object({
  lng: LongitudeSchema,
  lat: LatitudeSchema,
})

export const BoundingBoxSchema = z
  .object({
    west: LongitudeSchema,
    south: LatitudeSchema,
    east: LongitudeSchema,
    north: LatitudeSchema,
  })
  .refine((box) => box.west < box.east && box.south < box.north, {
    message: 'Bounding box must have west < east and south < north.',
  })

export const SourceSchema = z.object({
  type: z.enum(['osm', 'partner', 'user', 'lifeflow_admin', 'import']),
  source_id: z.string().min(1),
  source_url: z.url().nullable().optional(),
  observed_at: z.iso.datetime().nullable().optional(),
})

export const VerificationSchema = z.object({
  status: z.enum(['unverified', 'source_verified', 'lifeflow_verified']),
  verified_at: z.iso.datetime().nullable(),
  verified_by: z.string().nullable().optional(),
})

export const CursorPageSchema = z.object({
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).nullable().default(null),
})

export type Coordinate = z.infer<typeof CoordinateSchema>
export type BoundingBox = z.infer<typeof BoundingBoxSchema>
export type DataSource = z.infer<typeof SourceSchema>
