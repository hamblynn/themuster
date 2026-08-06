-- ============================================================
-- THE MUSTER — data model
-- Compatible with SQLite (for local dev) and Postgres (for prod)
-- Notes:
--   * TEXT is used for enums for SQLite-friendliness; swap to
--     native ENUM types or CHECK constraints on Postgres if you want
--     stricter validation.
--   * All timestamps are stored as TEXT (ISO 8601) for SQLite compat.
-- ============================================================

-- ------------------------------------------------------------
-- ADMINS
-- Real per-admin accounts (replaces the old shared X-Admin-Key).
-- Kept separate from farmers/hunters — an admin isn't a farmer or
-- hunter account with a flag, it's its own login.
-- ------------------------------------------------------------
CREATE TABLE admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- NEWS
-- Admin-posted announcements, tagged for farmers, hunters, or both.
-- ------------------------------------------------------------
CREATE TABLE news (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  audience    TEXT NOT NULL CHECK (audience IN ('farmer', 'hunter', 'both')),
  posted_by   TEXT,                 -- admin username
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- FARMERS
-- ------------------------------------------------------------
CREATE TABLE farmers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- PROPERTIES
-- One farmer can list multiple properties.
-- ------------------------------------------------------------
CREATE TABLE properties (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  farmer_id         INTEGER NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,              -- e.g. "Riverbend"
  pic_code          TEXT NOT NULL UNIQUE,        -- Property Identification Code
  lot_number        TEXT,                        -- cadastral lot, e.g. "1" — used with plan_number to look up the real parcel boundary
  plan_number       TEXT,                        -- cadastral plan, e.g. "PS123456"
  address           TEXT,
  suburb            TEXT,
  latitude          REAL NOT NULL,
  longitude         REAL NOT NULL,
  size_hectares     REAL,
  access_notes      TEXT,                        -- gate codes, tracks, general notes
  permitted_hours   TEXT,                        -- e.g. "05:30-09:00,16:00-dusk"
  allow_spotlighting INTEGER NOT NULL DEFAULT 0,  -- boolean 0/1
  exclusivity_mode  TEXT NOT NULL DEFAULT 'shared'
                    CHECK (exclusivity_mode IN ('shared','exclusive_per_period')),
  active            INTEGER NOT NULL DEFAULT 1,
  -- Circular geofence around (latitude, longitude), used when a booking
  -- opts into geofenced check-in/check-out. Properties vary hugely in
  -- size, so this is per-property rather than one fixed constant.
  geofence_radius_m INTEGER NOT NULL DEFAULT 1000,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- NO-GO ZONES
-- A property can have several excluded areas (house paddock, dam, etc.)
-- Kept as simple named zones for MVP; upgrade `geometry` to a real
-- polygon/GeoJSON column later if you add proper mapping.
-- ------------------------------------------------------------
CREATE TABLE no_go_zones (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id   INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,        -- e.g. "House paddock"
  description   TEXT,
  geometry      TEXT                  -- GeoJSON polygon, nullable for MVP
);

-- ------------------------------------------------------------
-- GAME SPECIES
-- Admin-managed list of animals that can be permitted on a
-- property. `is_other` marks the single fixed "Other, please
-- specify" row (always present, never deletable) rather than a
-- real species. `requires_atcw` marks species that need an
-- Authority to Control Wildlife permit on file (document, tag
-- count, expiry) before a farmer can permit them — kangaroo/wombat
-- by default, but this is admin-editable per species, not hardcoded.
-- ------------------------------------------------------------
CREATE TABLE game_species (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  value         TEXT NOT NULL UNIQUE,       -- slug, e.g. 'deer'
  label         TEXT NOT NULL,              -- e.g. 'Deer'
  requires_atcw INTEGER NOT NULL DEFAULT 0,
  is_other      INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1, -- inactive species drop out of new listings but stay valid for existing rows
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- PROPERTY SPECIES
-- Which animals a farmer permits hunting on this property. A
-- property can have several. Species requiring an ATCW permit
-- (game_species.requires_atcw) need the permit itself on file
-- plus how many tags are left and when it expires — those three
-- columns are only meaningful for those rows.
-- ------------------------------------------------------------
CREATE TABLE property_species (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id               INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  species                   TEXT NOT NULL REFERENCES game_species(value),
  other_description         TEXT,     -- 'other' rows only
  atcw_document_url         TEXT,     -- link to the ATCW permit, requires_atcw rows only
  atcw_remaining_quantity   INTEGER,  -- tags left on the permit, requires_atcw rows only
  atcw_expiry_date          TEXT,     -- requires_atcw rows only
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (property_id, species)
);

-- ------------------------------------------------------------
-- HUNTERS
-- ------------------------------------------------------------
CREATE TABLE hunters (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL,
  email               TEXT NOT NULL UNIQUE,
  phone               TEXT,
  password_hash       TEXT NOT NULL,
  bio                 TEXT,
  latitude            REAL NOT NULL,
  longitude           REAL NOT NULL,
  thermal_capable     INTEGER NOT NULL DEFAULT 0,   -- boolean 0/1
  suppressed_capable  INTEGER NOT NULL DEFAULT 0,   -- boolean 0/1
  rating_avg          REAL NOT NULL DEFAULT 0,
  rating_count        INTEGER NOT NULL DEFAULT 0,
  -- rolls up credential statuses so the platform can gate visibility
  -- without joining every time; recomputed whenever a credential changes
  is_active           INTEGER NOT NULL DEFAULT 0,
  -- Availability pattern — which days a hunter is willing to be booked.
  -- 'daily' (default) means no restriction, for backwards compatibility
  -- with hunters who've never set one.
  --   'weekly'   uses availability_days, e.g. "mon,tue,wed,thu"
  --   'interval' uses availability_interval + availability_anchor_date,
  --              e.g. every 2nd day counting from the anchor date
  availability_mode      TEXT NOT NULL DEFAULT 'daily'
                         CHECK (availability_mode IN ('daily', 'weekly', 'interval')),
  availability_days      TEXT,     -- comma-separated lowercase day abbreviations, 'weekly' mode only
  availability_interval  INTEGER,  -- e.g. 2 = every second day, 'interval' mode only
  availability_anchor_date TEXT,   -- a date known to be available, 'interval' mode only
  -- Live-tracking SOS: who to call, and whether this hunter wants to be
  -- alerted about *other* nearby hunters' SOS while they're out too.
  emergency_contact_name  TEXT,
  emergency_contact_phone TEXT,
  sos_alert_opt_in        INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- CREDENTIALS
-- Every licence/insurance/permit a hunter needs, each individually
-- tracked with its own expiry so the platform can auto-suspend a
-- hunter the moment any one of these lapses.
-- ------------------------------------------------------------
CREATE TABLE credentials (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  hunter_id         INTEGER NOT NULL REFERENCES hunters(id) ON DELETE CASCADE,
  credential_type   TEXT NOT NULL CHECK (credential_type IN (
                      'primesafe_field_harvester',
                      'game_licence',
                      'firearms_licence',
                      'vehicle_field_depot',
                      'vehicle_mtv',
                      'public_liability_insurance',
                      'suppressor_permit'
                    )),
  reference_number  TEXT NOT NULL,       -- approval/licence/policy number
  issuer            TEXT,                -- e.g. "PrimeSafe", "VicPol", insurer name
  issued_date       TEXT,
  expiry_date       TEXT,                -- nullable only for non-expiring items
  document_url      TEXT,                -- link to uploaded certificate/permit
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','verified','warning','expired','rejected')),
  verified_by_admin TEXT,                -- admin username/id who sighted it
  verified_at       TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (hunter_id, credential_type)     -- one active record per credential type
);

-- ------------------------------------------------------------
-- BOOKINGS
-- ------------------------------------------------------------
CREATE TABLE bookings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id     INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  hunter_id       INTEGER NOT NULL REFERENCES hunters(id) ON DELETE CASCADE,
  requested_date  TEXT NOT NULL,
  start_time      TEXT,
  end_time        TEXT,
  status          TEXT NOT NULL DEFAULT 'requested'
                  CHECK (status IN ('requested','approved','declined','completed','cancelled')),
  farmer_note     TEXT,     -- e.g. "livestock in north paddock this week"
  -- Farmer opts into this per booking (not a fixed property setting) —
  -- the hunter sees it before accepting, per the original ask: "the
  -- hunter can decide if they want to take the booking."
  geofence_required INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- HARVEST DECLARATIONS
-- Auto-filled per booking; one row is created once a booking is
-- completed and a harvest actually occurs. Supports multiple
-- carcasses per booking.
-- ------------------------------------------------------------
CREATE TABLE harvest_declarations (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id            INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  pic_code              TEXT NOT NULL,          -- copied from property at time of harvest
  harvester_approval_no TEXT NOT NULL,          -- copied from hunter's PrimeSafe credential
  species               TEXT NOT NULL,          -- e.g. "Sambar", "Fallow"
  carcass_count         INTEGER NOT NULL DEFAULT 1,
  date_of_harvest       TEXT NOT NULL,
  tag_numbers           TEXT,                   -- comma-separated or JSON array
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- MESSAGES
-- Simple threaded messaging tied to a booking, for the audit trail.
-- ------------------------------------------------------------
CREATE TABLE messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id    INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  sender_type   TEXT NOT NULL CHECK (sender_type IN ('farmer','hunter')),
  sender_id     INTEGER NOT NULL,   -- farmer.id or hunter.id depending on sender_type
  content       TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- REVIEWS
-- Bidirectional — a farmer reviews a hunter, or a hunter reviews
-- a farmer/property, both tied back to the booking that occurred.
-- ------------------------------------------------------------
CREATE TABLE reviews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id    INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  author_type   TEXT NOT NULL CHECK (author_type IN ('farmer','hunter')),
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- REFERRALS
-- Farmer refers a hunter they trust to a neighbouring property.
-- ------------------------------------------------------------
CREATE TABLE referrals (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  referring_farmer_id   INTEGER NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
  hunter_id             INTEGER NOT NULL REFERENCES hunters(id) ON DELETE CASCADE,
  referred_name         TEXT NOT NULL,
  referred_contact      TEXT NOT NULL,     -- email or phone
  referred_property     TEXT,
  note                  TEXT,
  status                TEXT NOT NULL DEFAULT 'sent'
                        CHECK (status IN ('sent','signed_up','declined')),
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- SIGHTINGS / DAMAGE REPORTS
-- Farmer-logged pressure reports, feeding both the property map
-- and an "urgent" flag on bookings/matching.
-- ------------------------------------------------------------
CREATE TABLE sightings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id   INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  reported_date TEXT NOT NULL DEFAULT (datetime('now')),
  species       TEXT,
  estimated_count INTEGER,
  damage_notes  TEXT,               -- crop/fence damage description
  latitude      REAL,               -- optional pin on the property map
  longitude     REAL,
  urgent        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per hunter dispatched an alert for a given urgent sighting —
-- records who was notified (and how far they were at the time) so a
-- hunter can see it in-app even if the push never arrived or they
-- weren't watching their (redirected, on this test site) inbox.
CREATE TABLE sighting_dispatches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sighting_id   INTEGER NOT NULL REFERENCES sightings(id) ON DELETE CASCADE,
  hunter_id     INTEGER NOT NULL REFERENCES hunters(id) ON DELETE CASCADE,
  distance_km   REAL NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sighting_dispatches_hunter ON sighting_dispatches(hunter_id);

-- ------------------------------------------------------------
-- LIVE TRACKING & SOS
-- A hunter's continuous GPS track during an approved booking visit
-- (started_at/ended_at *is* the check-in/check-out record — the
-- bookings.status machine itself is untouched). Private to the
-- hunter by default; share_with_farmer is an explicit opt-in they
-- can toggle mid-session. Only one active session per hunter at a
-- time (see the partial unique index below) so an SOS's "nearby
-- active hunters" lookup always has an unambiguous latest point.
-- ------------------------------------------------------------
CREATE TABLE tracking_sessions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id        INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  hunter_id         INTEGER NOT NULL REFERENCES hunters(id) ON DELETE CASCADE,
  started_at        TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at          TEXT,                          -- NULL while active
  share_with_farmer INTEGER NOT NULL DEFAULT 0,
  -- Only meaningful when the booking has geofence_required=1; NULL
  -- otherwise (geofencing wasn't in effect, so there's nothing to flag).
  -- Soft enforcement per product decision — check-in/out is never
  -- blocked, just recorded, since a bad GPS fix shouldn't lock anyone
  -- out.
  checkin_in_geofence  INTEGER,
  checkout_in_geofence INTEGER,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE track_points (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
  latitude    REAL NOT NULL,
  longitude   REAL NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))  -- server-assigned; don't trust client clocks
);

CREATE TABLE track_tags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
  tag_type    TEXT NOT NULL CHECK (tag_type IN ('shot', 'left', 'processed')),
  latitude    REAL NOT NULL,
  longitude   REAL NOT NULL,
  notes       TEXT,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sos_alerts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id       INTEGER NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
  hunter_id        INTEGER NOT NULL REFERENCES hunters(id) ON DELETE CASCADE,
  latitude         REAL NOT NULL,
  longitude        REAL NOT NULL,
  triggered_at     TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at      TEXT,
  resolved_by_role TEXT CHECK (resolved_by_role IN ('farmer', 'hunter', 'admin')),
  resolved_by_id   INTEGER
);

-- A user (farmer or hunter) can have several subscriptions (multiple devices).
CREATE TABLE push_subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_role TEXT NOT NULL CHECK (owner_role IN ('farmer', 'hunter')),
  owner_id   INTEGER NOT NULL,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- INDEXES for the queries you'll run most often
-- ============================================================
CREATE INDEX idx_properties_location ON properties(latitude, longitude);
CREATE INDEX idx_hunters_location ON hunters(latitude, longitude);
CREATE INDEX idx_hunters_active ON hunters(is_active);
CREATE INDEX idx_credentials_hunter ON credentials(hunter_id);
CREATE INDEX idx_credentials_expiry ON credentials(expiry_date);
CREATE INDEX idx_bookings_property ON bookings(property_id);
CREATE INDEX idx_bookings_hunter ON bookings(hunter_id);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_sightings_property ON sightings(property_id);
CREATE INDEX idx_tracking_sessions_booking ON tracking_sessions(booking_id);
-- Enforces "one active session per hunter" AND serves as the lookup index for it.
CREATE UNIQUE INDEX idx_one_active_session_per_hunter ON tracking_sessions(hunter_id) WHERE ended_at IS NULL;
CREATE INDEX idx_track_points_session ON track_points(session_id);
CREATE INDEX idx_track_tags_session ON track_tags(session_id);
CREATE INDEX idx_sos_alerts_session ON sos_alerts(session_id);
CREATE INDEX idx_push_subscriptions_owner ON push_subscriptions(owner_role, owner_id);
