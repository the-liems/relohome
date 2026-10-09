-- housing-feedback-design section 14: property reviews aggregate to the owner at publication time.
CREATE TABLE housing.reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES housing.properties(id) ON DELETE CASCADE,
    host_user_id text NOT NULL REFERENCES housing.host_profiles(user_id),
    author_user_id text NOT NULL,
    rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 2000),
    stage text NOT NULL CHECK (stage IN ('contacted','viewed')),
    status text NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden','withdrawn')),
    hidden_reason text,
    reply_body text CHECK (char_length(reply_body) BETWEEN 1 AND 2000),
    reply_at timestamptz,
    moderated_at timestamptz,
    moderated_by text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (property_id, author_user_id)
);
CREATE INDEX reviews_host_public_idx ON housing.reviews(host_user_id, created_at DESC) WHERE status='published';
CREATE INDEX reviews_author_idx ON housing.reviews(author_user_id, property_id);
CREATE TABLE housing.review_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id uuid NOT NULL REFERENCES housing.reviews(id) ON DELETE CASCADE,
    reporter_user_id text NOT NULL,
    reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','dismissed')),
    decided_by text,
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (review_id, reporter_user_id)
);
CREATE INDEX review_reports_open_idx ON housing.review_reports(review_id) WHERE status='open';
CREATE TABLE housing.host_flags (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    host_user_id text NOT NULL REFERENCES housing.host_profiles(user_id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind='repeated_low_ratings'),
    evidence jsonb NOT NULL,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed')),
    reviewed_by text,
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (host_user_id, kind)
);
CREATE INDEX host_flags_status_idx ON housing.host_flags(status, updated_at DESC);
