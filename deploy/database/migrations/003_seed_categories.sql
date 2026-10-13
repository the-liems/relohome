INSERT INTO catalog.place_categories (slug, name, parent_slug)
VALUES
    ('accommodation', 'Accommodation', NULL),
    ('hotel', 'Hotel', 'accommodation'),
    ('hostel', 'Hostel', 'accommodation'),
    ('guest_house', 'Guest house', 'accommodation'),
    ('motel', 'Motel', 'accommodation'),
    ('homestay', 'Homestay', 'accommodation'),
    ('apartment', 'Apartment', 'accommodation'),
    ('hospital', 'Hospital', NULL),
    ('clinic', 'Clinic', NULL),
    ('pharmacy', 'Pharmacy', NULL),
    ('supermarket', 'Supermarket', NULL),
    ('restaurant', 'Restaurant', NULL),
    ('cafe', 'Cafe', NULL),
    ('other', 'Other', NULL)
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    parent_slug = EXCLUDED.parent_slug;
