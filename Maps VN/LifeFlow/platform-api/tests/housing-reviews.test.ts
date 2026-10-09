import { describe, expect, it } from 'vitest'
import { validateReviewText } from '../src/housing-reviews.js'
describe('public review text', () => {
  it('accepts empty text and ordinary Vietnamese words with accents', () => {
    expect(() => validateReviewText('')).not.toThrow()
    expect(() => validateReviewText('Các phòng lớn, sáng và sạch sẽ.')).not.toThrow()
  })
  it('rejects contact information in public reviews and replies', () => {
    for (const text of ['Gọi 0901 234 567', '+84 901 234 567', 'Liên hệ tenant@example.test']) {
      expect(() => validateReviewText(text)).toThrow(/số điện thoại hoặc email/)
    }
  })
  it('rejects abusive language without converting neutral criticism into abuse', () => {
    expect(() => validateReviewText('đồ khốn nạn')).toThrow(/tôn trọng/)
    expect(() => validateReviewText('Phòng ồn và phản hồi chậm, tôi không hài lòng.')).not.toThrow()
  })
})
