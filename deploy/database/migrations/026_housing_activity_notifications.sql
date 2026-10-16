-- Durable system updates, separate from participant messages. No existing history is rewritten.
CREATE TABLE housing.activity_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL,
 audience text NOT NULL CHECK(audience IN ('tenant','landlord','admin')),
 contact_id uuid REFERENCES housing.contact_requests(id) ON DELETE CASCADE,
 property_id uuid REFERENCES housing.properties(id) ON DELETE CASCADE,
 listing_id uuid REFERENCES housing.listings(id) ON DELETE CASCADE,
 subject_user_id text,
 payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_contact_time_idx ON housing.activity_events(contact_id,created_at);
CREATE INDEX activity_audience_time_idx ON housing.activity_events(audience,created_at DESC);
CREATE TABLE housing.activity_reads (
 event_id uuid NOT NULL REFERENCES housing.activity_events(id) ON DELETE CASCADE,
 user_id text NOT NULL,
 read_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(event_id,user_id)
);

CREATE FUNCTION housing.record_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item housing.contact_requests%ROWTYPE; home uuid; kind text; target text; detail jsonb='{}';
BEGIN
 IF TG_TABLE_NAME='contact_requests' THEN
  item=NEW;
  IF TG_OP='INSERT' THEN
   kind=CASE WHEN NEW.viewing_status='requested' THEN 'viewing_requested' ELSE 'contact_requested' END;target='landlord';
  ELSIF NEW.viewing_status IS DISTINCT FROM OLD.viewing_status OR NEW.viewing_slot IS DISTINCT FROM OLD.viewing_slot OR NEW.viewing_options IS DISTINCT FROM OLD.viewing_options THEN
   kind=CASE NEW.viewing_status WHEN 'requested' THEN 'viewing_requested' WHEN 'confirmed' THEN 'viewing_confirmed' WHEN 'declined' THEN 'viewing_proposed' WHEN 'cancelled' THEN 'viewing_cancelled' ELSE NULL END;
   target=CASE WHEN NEW.viewing_status IN ('requested','cancelled') THEN 'landlord' ELSE 'tenant' END;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
   kind='request_closed';target=CASE WHEN NEW.status='resolved' THEN 'tenant' ELSE 'landlord' END;
  ELSE RETURN NULL; END IF;
  detail=jsonb_build_object('slot',NEW.viewing_slot,'slots',NEW.viewing_options);
 ELSIF TG_TABLE_NAME='rent_payment_reports' THEN
  SELECT * INTO item FROM housing.contact_requests WHERE id=NEW.request_id;
  IF TG_OP='INSERT' THEN kind='payment_reported';target='landlord';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN kind='payment_'||NEW.status;target='tenant';
  ELSE RETURN NULL; END IF;
  detail=jsonb_build_object('amount_vnd',NEW.amount_vnd,'paid_on',NEW.paid_on,'reason',NEW.reason);
 ELSE RETURN NULL; END IF;
 IF kind IS NOT NULL THEN
  SELECT property_id INTO home FROM housing.listings WHERE id=item.listing_id;
  INSERT INTO housing.activity_events(kind,audience,contact_id,property_id,listing_id,subject_user_id,payload)
   VALUES(kind,target,item.id,home,item.listing_id,item.tenant_user_id,detail);
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER contact_activity AFTER INSERT OR UPDATE ON housing.contact_requests FOR EACH ROW EXECUTE FUNCTION housing.record_activity();
CREATE TRIGGER payment_activity AFTER INSERT OR UPDATE ON housing.rent_payment_reports FOR EACH ROW EXECUTE FUNCTION housing.record_activity();

CREATE FUNCTION housing.record_moderation_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE home uuid; listing uuid; subject text; kind text; target text; detail jsonb='{}';
BEGIN
 IF TG_TABLE_NAME='managed_listings' THEN
  IF TG_OP='INSERT' OR NEW.publication_status IS NOT DISTINCT FROM OLD.publication_status THEN RETURN NULL; END IF;
  SELECT property_id INTO home FROM housing.listings WHERE id=NEW.listing_id;
  listing=NEW.listing_id;subject=NEW.created_by;
  IF NEW.publication_status='pending_review' THEN kind='listing_submitted';target='admin';
  ELSIF NEW.publication_status IN ('published','rejected') THEN kind='listing_'||NEW.publication_status;target='landlord';
  ELSE RETURN NULL; END IF;
  detail=jsonb_build_object('reason',NEW.rejection_reason);
 ELSIF TG_TABLE_NAME='host_profiles' THEN
  subject=NEW.user_id;
  IF TG_OP='INSERT' THEN kind='host_submitted';target='admin';
  ELSIF NEW.status IS DISTINCT FROM OLD.status OR (NEW.status='pending' AND NEW.revision<>OLD.revision) THEN
   kind='host_'||NEW.status;target=CASE WHEN NEW.status='pending' THEN 'admin' ELSE 'landlord' END;
  ELSE RETURN NULL; END IF;
  detail=jsonb_build_object('reason',NEW.info_request);
 ELSIF TG_TABLE_NAME='management_members' THEN
  home=NEW.property_id;subject=NEW.user_id;
  IF TG_OP='INSERT' AND NEW.status='pending' THEN kind='property_submitted';target='admin';
  ELSIF TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN kind='property_'||NEW.status;target='landlord';
  ELSE RETURN NULL; END IF;
 END IF;
 IF kind IS NOT NULL THEN
  INSERT INTO housing.activity_events(kind,audience,property_id,listing_id,subject_user_id,payload)
   VALUES(kind,target,home,listing,subject,detail);
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER listing_activity AFTER INSERT OR UPDATE ON housing.managed_listings FOR EACH ROW EXECUTE FUNCTION housing.record_moderation_activity();
CREATE TRIGGER host_activity AFTER INSERT OR UPDATE ON housing.host_profiles FOR EACH ROW EXECUTE FUNCTION housing.record_moderation_activity();
CREATE TRIGGER property_activity AFTER INSERT OR UPDATE ON housing.management_members FOR EACH ROW EXECUTE FUNCTION housing.record_moderation_activity();

-- Seed current open work only, so existing requests are visible in the same bell.
INSERT INTO housing.activity_events(kind,audience,contact_id,property_id,listing_id,subject_user_id,payload,created_at)
 SELECT CASE cr.viewing_status WHEN 'requested' THEN 'viewing_requested' WHEN 'confirmed' THEN 'viewing_confirmed' WHEN 'declined' THEN 'viewing_proposed' ELSE 'contact_requested' END,
 CASE WHEN cr.viewing_status IN ('confirmed','declined') THEN 'tenant' ELSE 'landlord' END,
 cr.id,l.property_id,cr.listing_id,cr.tenant_user_id,jsonb_build_object('slot',cr.viewing_slot,'slots',cr.viewing_options),cr.updated_at
 FROM housing.contact_requests cr JOIN housing.listings l ON l.id=cr.listing_id
 WHERE cr.status IN ('new','contacted','viewing');
INSERT INTO housing.activity_events(kind,audience,contact_id,property_id,listing_id,subject_user_id,payload,created_at)
 SELECT 'payment_reported','landlord',cr.id,l.property_id,l.id,cr.tenant_user_id,jsonb_build_object('amount_vnd',r.amount_vnd,'paid_on',r.paid_on),r.created_at
 FROM housing.rent_payment_reports r JOIN housing.contact_requests cr ON cr.id=r.request_id JOIN housing.listings l ON l.id=cr.listing_id WHERE r.status='pending';
INSERT INTO housing.activity_events(kind,audience,listing_id,property_id,subject_user_id,created_at)
 SELECT 'listing_submitted','admin',l.id,l.property_id,ml.created_by,ml.updated_at
 FROM housing.managed_listings ml JOIN housing.listings l ON l.id=ml.listing_id WHERE ml.publication_status='pending_review';
INSERT INTO housing.activity_events(kind,audience,subject_user_id,created_at)
 SELECT 'host_submitted','admin',hp.user_id,hp.updated_at FROM housing.host_profiles hp WHERE hp.status='pending';
INSERT INTO housing.activity_events(kind,audience,property_id,subject_user_id,created_at)
 SELECT 'property_submitted','admin',mm.property_id,mm.user_id,mm.requested_at FROM housing.management_members mm WHERE mm.status='pending';
