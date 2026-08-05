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
-- FARMERS
-- ------------------------------------------------------------
CREATE TABLE farmers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT,
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
-- HUNTERS
-- ------------------------------------------------------------
CREATE TABLE hunters (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL,
  email               TEXT NOT NULL UNIQUE,
  phone               TEXT,
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
