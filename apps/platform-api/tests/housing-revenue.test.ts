import { describe, expect, it } from 'vitest'
import { calendarDate } from '../src/housing-revenue.js'

describe('revenue calendar dates', () => {
  it.each(['0000-01-01', '2026-02-31', '1900-02-29', '', null, undefined])(
    'rejects %s before passing a date to PostgreSQL',
    (value) => expect(calendarDate(value)).toBeNull(),
  )

  it.each(['0001-01-01', '2000-02-29', '2026-10-17', '9999-12-31'])('preserves the valid date %s', (value) =>
    expect(calendarDate(value)).toBe(value),
  )
})
