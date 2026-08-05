const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const webPush = require("web-push");
const {
  hashPassword, verifyPassword, requireAuth, requireAdminAuth,
  setSessionCookie, clearSessionCookie, setAdminSessionCookie, clearAdminSessionCookie,
} = require("./auth");

// VAPID identifies this app to push services (not a secret in the same
// sense as JWT_SECRET — the public key is meant to be public, and it's
// fine to reuse the same pair across dev/prod). Falls back to a
// generated pair for local dev convenience; set real env vars on the
// host to override if you want your own.
webPush.setVapidDetails(
  process.env.VAPID_SUBJECT || "mailto:admin@example.com",
  process.env.VAPID_PUBLIC_KEY || "BCBd5HYiBZJjCBdFLjQm11ceAagJ8Kj3SwfQyFsElJ5KIO2TfCpRFIJ6uXenRDsp6l8Rf07oipABXYFHE5Vty-I",
  process.env.VAPID_PRIVATE_KEY || "mWhwd2hZRRqHqb8tKIc2_FLzbpevBy9mXfcSSUyee-U"
);

const dbPath = path.join(__dirname, "muster.db");
if (!fs.existsSync(dbPath)) {
  console.error("muster.db not found — run `npm run seed` first.");
  process.exit(1);
}
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
// Live-tracking mixes concurrent writes (GPS points streaming in) with
// concurrent reads (a farmer polling a shared track) for the first time —
// the default rollback-journal mode serializes readers behind writers and
// can throw "database is locked" under that combination.
db.pragma("journal_mode = WAL");

const app = express();
// credentials: true + an explicit origin (not "*") are both required for
// the browser to accept the httpOnly session cookie cross-origin (the
// Vite dev server on :5173 talking to the API on :4000).
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Sends a Web Push notification to one subscription. Keeps the payload
// small (4KB limit, encrypted) — the client deep-links into the app to
// fetch full detail rather than the push payload carrying everything.
// Prunes the subscription on 404/410 (permanently-gone endpoint) rather
// than leaving dead rows around.
async function sendPush(subscriptionRow, payload) {
  const subscription = {
    endpoint: subscriptionRow.endpoint,
    keys: { p256dh: subscriptionRow.p256dh, auth: subscriptionRow.auth },
  };
  try {
    await webPush.sendNotification(subscription, JSON.stringify(payload), {
      TTL: 3600,
      urgency: "high",
    });
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) {
      db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(subscriptionRow.endpoint);
    } else {
      console.error("Push send failed:", e.statusCode, e.body || e.message);
    }
  }
}

const DAY_ABBREVS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]; // matches Date#getUTCDay() index

// Given a hunter row and a 'YYYY-MM-DD' date string, is that day within
// their stated availability? 'daily' (the default) means no restriction.
function isHunterAvailable(hunter, dateStr) {
  if (hunter.availability_mode === "weekly") {
    const days = (hunter.availability_days || "").split(",").map((d) => d.trim()).filter(Boolean);
    const dayOfWeek = DAY_ABBREVS[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
    return days.includes(dayOfWeek);
  }
  if (hunter.availability_mode === "interval") {
    if (!hunter.availability_anchor_date || !hunter.availability_interval) return true;
    const msPerDay = 24 * 60 * 60 * 1000;
    const anchor = new Date(`${hunter.availability_anchor_date}T00:00:00Z`).getTime();
    const target = new Date(`${dateStr}T00:00:00Z`).getTime();
    const diffDays = Math.round((target - anchor) / msPerDay);
    return (
      ((diffDays % hunter.availability_interval) + hunter.availability_interval) % hunter.availability_interval === 0
    );
  }
  return true; // 'daily' — no restriction
}

const DAY_LABELS = { sun: "Sun", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat" };
function describeAvailability(hunter) {
  if (hunter.availability_mode === "weekly") {
    const days = (hunter.availability_days || "").split(",").map((d) => DAY_LABELS[d.trim()]).filter(Boolean);
    return days.length ? `only available ${days.join(", ")}` : "not available any day";
  }
  if (hunter.availability_mode === "interval" && hunter.availability_interval && hunter.availability_anchor_date) {
    return `only available every ${hunter.availability_interval} day(s) from ${hunter.availability_anchor_date}`;
  }
  return "available daily";
}

function credentialLabel(type) {
  return {
    primesafe_field_harvester: "PRIMESAFE",
    game_licence: "GAME LICENCE",
    firearms_licence: "FIREARMS LICENCE",
    vehicle_field_depot: "VEHICLE",
    vehicle_mtv: "VEHICLE (MTV)",
    public_liability_insurance: "INSURED",
    suppressor_permit: "SUPPRESSOR PERMIT",
  }[type] || type.toUpperCase();
}

// Never send password_hash back to the client.
function omitPassword(row) {
  if (!row) return row;
  const { password_hash, ...rest } = row;
  return rest;
}

// ===========================================================
// AUTH — farmers
// ===========================================================

// POST /api/auth/farmer/register — body: { name, email, phone, password }
app.post("/api/auth/farmer/register", (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: "name, email and password are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  try {
    const result = db
      .prepare(`INSERT INTO farmers (name, email, phone, password_hash) VALUES (?, ?, ?, ?)`)
      .run(name, email, phone || null, hashPassword(password));
    const farmer = db.prepare(`SELECT * FROM farmers WHERE id = ?`).get(result.lastInsertRowid);
    setSessionCookie(res, { id: farmer.id, role: "farmer" });
    res.status(201).json({ user: { ...omitPassword(farmer), role: "farmer" } });
  } catch (e) {
    res.status(400).json({
      error: e.message.includes("UNIQUE") ? "A farmer with that email already exists" : e.message,
    });
  }
});

// POST /api/auth/farmer/login — body: { email, password }
app.post("/api/auth/farmer/login", (req, res) => {
  const { email, password } = req.body;
  const farmer = db.prepare(`SELECT * FROM farmers WHERE email = ?`).get(email);
  if (!farmer || !verifyPassword(password || "", farmer.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  setSessionCookie(res, { id: farmer.id, role: "farmer" });
  res.json({ user: { ...omitPassword(farmer), role: "farmer" } });
});

// ===========================================================
// AUTH — hunters
// ===========================================================

// POST /api/auth/hunter/register
// body: { name, email, phone, password, bio, latitude, longitude,
//         thermal_capable, suppressed_capable,
//         credentials: [{ credential_type, reference_number, issuer, issued_date, expiry_date }] }
// New hunters start inactive (is_active = 0) until an admin verifies credentials.
app.post("/api/auth/hunter/register", (req, res) => {
  const {
    name, email, phone, password, bio, latitude, longitude,
    thermal_capable, suppressed_capable, credentials,
  } = req.body;

  if (!name || !email || !password || latitude == null || longitude == null) {
    return res.status(400).json({ error: "name, email, password, latitude and longitude are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  try {
    const result = db
      .prepare(`
        INSERT INTO hunters
          (name, email, phone, password_hash, bio, latitude, longitude, thermal_capable, suppressed_capable, is_active)
        VALUES (@name, @email, @phone, @password_hash, @bio, @latitude, @longitude, @thermal_capable, @suppressed_capable, 0)
      `)
      .run({
        name, email,
        phone: phone || null,
        password_hash: hashPassword(password),
        bio: bio || null,
        latitude, longitude,
        thermal_capable: thermal_capable ? 1 : 0,
        suppressed_capable: suppressed_capable ? 1 : 0,
      });

    const hunterId = result.lastInsertRowid;

    if (Array.isArray(credentials)) {
      const insertCred = db.prepare(`
        INSERT INTO credentials
          (hunter_id, credential_type, reference_number, issuer, issued_date, expiry_date, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `);
      credentials
        .filter((c) => c && c.credential_type && c.reference_number)
        .forEach((c) =>
          insertCred.run(
            hunterId, c.credential_type, c.reference_number,
            c.issuer || null, c.issued_date || null, c.expiry_date || null
          )
        );
    }

    const hunter = db.prepare(`SELECT * FROM hunters WHERE id = ?`).get(hunterId);
    setSessionCookie(res, { id: hunter.id, role: "hunter" });
    res.status(201).json({ user: { ...omitPassword(hunter), role: "hunter" } });
  } catch (e) {
    res.status(400).json({
      error: e.message.includes("UNIQUE") ? "A hunter with that email already exists" : e.message,
    });
  }
});

// POST /api/auth/hunter/login — body: { email, password }
app.post("/api/auth/hunter/login", (req, res) => {
  const { email, password } = req.body;
  const hunter = db.prepare(`SELECT * FROM hunters WHERE email = ?`).get(email);
  if (!hunter || !verifyPassword(password || "", hunter.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  setSessionCookie(res, { id: hunter.id, role: "hunter" });
  res.json({ user: { ...omitPassword(hunter), role: "hunter" } });
});

// POST /api/auth/logout — clears the main session cookie (farmer/hunter)
app.post("/api/auth/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ===========================================================
// AUTH — admin
// A real per-admin account, replacing the old shared X-Admin-Key.
// Separate cookie/session from the farmer/hunter one, so an admin
// can be logged in independently of (or alongside) a normal session
// in the same browser.
// ===========================================================

// POST /api/auth/admin/login — body: { username, password }
app.post("/api/auth/admin/login", (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare(`SELECT * FROM admins WHERE username = ?`).get(username);
  if (!admin || !verifyPassword(password || "", admin.password_hash)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  setAdminSessionCookie(res, { id: admin.id, role: "admin" });
  res.json({ admin: { id: admin.id, username: admin.username } });
});

// POST /api/auth/admin/logout
app.post("/api/auth/admin/logout", (req, res) => {
  clearAdminSessionCookie(res);
  res.json({ ok: true });
});

// GET /api/me — current logged-in user, either role, from the token
app.get("/api/me", requireAuth(), (req, res) => {
  if (req.user.role === "farmer") {
    const farmer = db.prepare(`SELECT * FROM farmers WHERE id = ?`).get(req.user.id);
    if (!farmer) return res.status(404).json({ error: "Farmer not found" });
    const properties = db.prepare(`SELECT * FROM properties WHERE farmer_id = ?`).all(farmer.id);
    return res.json({ role: "farmer", ...omitPassword(farmer), properties });
  }
  const hunter = db.prepare(`SELECT * FROM hunters WHERE id = ?`).get(req.user.id);
  if (!hunter) return res.status(404).json({ error: "Hunter not found" });
  hunter.credentials = db.prepare(`SELECT * FROM credentials WHERE hunter_id = ?`).all(hunter.id);
  return res.json({ role: "hunter", ...omitPassword(hunter) });
});

// PATCH /api/me — edit your own account. Accepts any subset of the
// fields editable for your role; only what's present in the body is
// changed. (Property details are edited via PATCH /api/properties/:id,
// not here — this is account-level info only.)
const SELF_EDITABLE_FIELDS_BY_ROLE = {
  farmer: ["name", "email", "phone"],
  hunter: [
    "name", "email", "phone", "bio", "latitude", "longitude", "thermal_capable", "suppressed_capable",
    "availability_mode", "availability_days", "availability_interval", "availability_anchor_date",
    "emergency_contact_name", "emergency_contact_phone", "sos_alert_opt_in",
  ],
};
app.patch("/api/me", requireAuth(), (req, res) => {
  const table = req.user.role === "farmer" ? "farmers" : "hunters";
  const editable = SELF_EDITABLE_FIELDS_BY_ROLE[req.user.role];
  const updates = {};
  editable.forEach((field) => {
    if (req.body[field] === undefined) return;
    if (field === "thermal_capable" || field === "suppressed_capable" || field === "sos_alert_opt_in") {
      updates[field] = req.body[field] ? 1 : 0;
    } else {
      updates[field] = req.body[field];
    }
  });

  try {
    if (Object.keys(updates).length > 0) {
      const setClause = Object.keys(updates).map((k) => `${k} = @${k}`).join(", ");
      db.prepare(`UPDATE ${table} SET ${setClause} WHERE id = @id`).run({ ...updates, id: req.user.id });
    }

    if (req.user.role === "farmer") {
      const farmer = db.prepare(`SELECT * FROM farmers WHERE id = ?`).get(req.user.id);
      const properties = db.prepare(`SELECT * FROM properties WHERE farmer_id = ?`).all(farmer.id);
      return res.json({ role: "farmer", ...omitPassword(farmer), properties });
    }
    const hunter = db.prepare(`SELECT * FROM hunters WHERE id = ?`).get(req.user.id);
    hunter.credentials = db.prepare(`SELECT * FROM credentials WHERE hunter_id = ?`).all(hunter.id);
    res.json({ role: "hunter", ...omitPassword(hunter) });
  } catch (e) {
    res.status(400).json({
      error: e.message.includes("UNIQUE") ? "That email is already in use" : e.message,
    });
  }
});

// ===========================================================
// PROPERTIES
// ===========================================================

// Shared by POST/PATCH /api/properties below. Species are admin-managed
// (see the GAME SPECIES section) rather than a hardcoded list, so this
// looks the current set up fresh each call instead of caching it —
// these requests are infrequent and better-sqlite3 is synchronous/fast.
function getSpeciesByValue() {
  const rows = db.prepare(`SELECT * FROM game_species`).all();
  return new Map(rows.map((r) => [r.value, r]));
}

// Returns an error string if `species` (the array from the request
// body) is malformed or references an unknown species, or null if
// it's fine to insert. A species needing an ATCW permit (per its
// game_species.requires_atcw flag) needs the permit itself on file —
// that's the whole point of the field — so it's rejected outright
// rather than silently dropped.
function validateSpecies(species) {
  if (!Array.isArray(species)) return null;
  const byValue = getSpeciesByValue();
  for (const s of species) {
    if (!s || !s.species) continue;
    const def = byValue.get(s.species);
    if (!def) return `Unknown species: ${s.species}`;
    if (def.requires_atcw) {
      if (!s.atcw_document_url || s.atcw_remaining_quantity == null || !s.atcw_expiry_date) {
        return `${def.label} needs an ATCW document link, remaining quantity and expiry date`;
      }
    }
    if (def.is_other && !s.other_description) {
      return "Please describe the 'Other' species";
    }
  }
  return null;
}

function insertPropertySpecies(propertyId, species) {
  if (!Array.isArray(species)) return;
  const byValue = getSpeciesByValue();
  const insertSpecies = db.prepare(`
    INSERT INTO property_species
      (property_id, species, other_description, atcw_document_url, atcw_remaining_quantity, atcw_expiry_date)
    VALUES (@property_id, @species, @other_description, @atcw_document_url, @atcw_remaining_quantity, @atcw_expiry_date)
  `);
  species
    .filter((s) => s && s.species && byValue.has(s.species))
    .forEach((s) => {
      const def = byValue.get(s.species);
      insertSpecies.run({
        property_id: propertyId,
        species: s.species,
        other_description: def.is_other ? s.other_description || null : null,
        atcw_document_url: def.requires_atcw ? s.atcw_document_url || null : null,
        atcw_remaining_quantity: def.requires_atcw ? s.atcw_remaining_quantity ?? null : null,
        atcw_expiry_date: def.requires_atcw ? s.atcw_expiry_date || null : null,
      });
    });
}

// ===========================================================
// GAME SPECIES
// Admin-managed list of animals a farmer can permit on a property
// (replaces what used to be a hardcoded enum). "Other" is a fixed
// system row (is_other = 1) that always exists and can't be deleted.
// ===========================================================

// GET /api/species — active species, for the property species checklist
app.get("/api/species", requireAuth("farmer"), (req, res) => {
  res.json(db.prepare(`SELECT * FROM game_species WHERE is_active = 1 ORDER BY sort_order, id`).all());
});

// GET /api/admin/species — every species, including inactive, for admin management
app.get("/api/admin/species", requireAdminAuth, (req, res) => {
  res.json(db.prepare(`SELECT * FROM game_species ORDER BY sort_order, id`).all());
});

// POST /api/admin/species — body: { value?, label, requires_atcw }
// value is slugified from label if not supplied.
app.post("/api/admin/species", requireAdminAuth, (req, res) => {
  const { label, requires_atcw } = req.body;
  if (!label || !label.trim()) return res.status(400).json({ error: "Label is required" });
  const value =
    (req.body.value && req.body.value.trim()) ||
    label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!value) return res.status(400).json({ error: "Could not derive a species code from that label" });
  const maxOrder = db.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM game_species`).get().m;
  try {
    const result = db
      .prepare(
        `INSERT INTO game_species (value, label, requires_atcw, is_other, sort_order) VALUES (?, ?, ?, 0, ?)`
      )
      .run(value, label.trim(), requires_atcw ? 1 : 0, maxOrder + 1);
    res.status(201).json(db.prepare(`SELECT * FROM game_species WHERE id = ?`).get(result.lastInsertRowid));
  } catch (e) {
    res.status(400).json({
      error: e.message.includes("UNIQUE") ? "That species code is already in use" : e.message,
    });
  }
});

// PATCH /api/admin/species/:id — body: { label?, requires_atcw?, is_active? }
// (value and is_other are fixed at creation — editing them would
// silently orphan any existing property_species rows referencing them)
app.patch("/api/admin/species/:id", requireAdminAuth, (req, res) => {
  const existing = db.prepare(`SELECT * FROM game_species WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Species not found" });
  const label = req.body.label !== undefined ? req.body.label : existing.label;
  const requiresAtcw = req.body.requires_atcw !== undefined ? (req.body.requires_atcw ? 1 : 0) : existing.requires_atcw;
  const isActive = req.body.is_active !== undefined ? (req.body.is_active ? 1 : 0) : existing.is_active;
  db.prepare(`UPDATE game_species SET label = ?, requires_atcw = ?, is_active = ? WHERE id = ?`).run(
    label, requiresAtcw, isActive, req.params.id
  );
  res.json(db.prepare(`SELECT * FROM game_species WHERE id = ?`).get(req.params.id));
});

// DELETE /api/admin/species/:id — refused for the "Other" system row or
// any species still referenced by a property (the FK would reject it
// anyway; this just gives a friendlier error).
app.delete("/api/admin/species/:id", requireAdminAuth, (req, res) => {
  const existing = db.prepare(`SELECT * FROM game_species WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Species not found" });
  if (existing.is_other) return res.status(400).json({ error: "The 'Other' entry can't be deleted" });
  const inUse = db.prepare(`SELECT COUNT(*) AS n FROM property_species WHERE species = ?`).get(existing.value).n;
  if (inUse > 0) {
    return res.status(400).json({
      error: `Can't delete — ${inUse} propert${inUse === 1 ? "y" : "ies"} still list this species. Deactivate it instead.`,
    });
  }
  db.prepare(`DELETE FROM game_species WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// GET /api/properties/:id — owner only
app.get("/api/properties/:id", requireAuth("farmer"), (req, res) => {
  const property = db.prepare(`SELECT * FROM properties WHERE id = ?`).get(req.params.id);
  if (!property) return res.status(404).json({ error: "Property not found" });
  if (property.farmer_id !== req.user.id) {
    return res.status(403).json({ error: "You don't have access to this property" });
  }

  property.no_go_zones = db.prepare(`SELECT * FROM no_go_zones WHERE property_id = ?`).all(property.id);
  property.species = db
    .prepare(
      `SELECT ps.*, gs.label, gs.requires_atcw, gs.is_other
       FROM property_species ps JOIN game_species gs ON gs.value = ps.species
       WHERE ps.property_id = ?`
    )
    .all(property.id);
  property.sightings = db
    .prepare(`SELECT * FROM sightings WHERE property_id = ? ORDER BY reported_date DESC`)
    .all(property.id);

  res.json(property);
});

// GET /api/properties/:id/matches — owner only
app.get("/api/properties/:id/matches", requireAuth("farmer"), (req, res) => {
  const property = db.prepare(`SELECT * FROM properties WHERE id = ?`).get(req.params.id);
  if (!property) return res.status(404).json({ error: "Property not found" });
  if (property.farmer_id !== req.user.id) {
    return res.status(403).json({ error: "You don't have access to this property" });
  }

  const hunters = db.prepare(`SELECT * FROM hunters WHERE is_active = 1`).all();
  const credStmt = db.prepare(`SELECT * FROM credentials WHERE hunter_id = ?`);

  const matches = hunters
    .map((h) => {
      const credentials = credStmt.all(h.id);
      return {
        id: h.id,
        name: h.name,
        rating_avg: h.rating_avg,
        rating_count: h.rating_count,
        thermal_capable: !!h.thermal_capable,
        suppressed_capable: !!h.suppressed_capable,
        distance_km: Math.round(
          distanceKm(property.latitude, property.longitude, h.latitude, h.longitude) * 10
        ) / 10,
        credential_tags: credentials.map((c) => ({
          label: credentialLabel(c.credential_type),
          status: c.status,
        })),
      };
    })
    .sort((a, b) => a.distance_km - b.distance_km);

  res.json(matches);
});

// POST /api/properties — logged-in farmer lists a new property
// body: { name, pic_code, address, suburb, latitude, longitude, size_hectares,
//         access_notes, permitted_hours, allow_spotlighting, no_go_zones,
//         species: [{ species, other_description?, atcw_document_url?,
//                      atcw_remaining_quantity?, atcw_expiry_date? }] }
app.post("/api/properties", requireAuth("farmer"), (req, res) => {
  const {
    name, pic_code, lot_number, plan_number, address, suburb, latitude, longitude,
    size_hectares, access_notes, permitted_hours, allow_spotlighting, no_go_zones, species,
  } = req.body;

  if (!name || !pic_code || latitude == null || longitude == null) {
    return res.status(400).json({ error: "name, pic_code, latitude and longitude are required" });
  }
  const speciesError = validateSpecies(species);
  if (speciesError) return res.status(400).json({ error: speciesError });

  try {
    const result = db
      .prepare(`
        INSERT INTO properties
          (farmer_id, name, pic_code, lot_number, plan_number, address, suburb, latitude, longitude,
           size_hectares, access_notes, permitted_hours, allow_spotlighting)
        VALUES (@farmer_id, @name, @pic_code, @lot_number, @plan_number, @address, @suburb, @latitude, @longitude,
                @size_hectares, @access_notes, @permitted_hours, @allow_spotlighting)
      `)
      .run({
        farmer_id: req.user.id, name, pic_code,
        lot_number: lot_number || null,
        plan_number: plan_number || null,
        address: address || null,
        suburb: suburb || null,
        latitude, longitude,
        size_hectares: size_hectares || null,
        access_notes: access_notes || null,
        permitted_hours: permitted_hours || null,
        allow_spotlighting: allow_spotlighting ? 1 : 0,
      });

    const propertyId = result.lastInsertRowid;

    if (Array.isArray(no_go_zones)) {
      const insertZone = db.prepare(
        `INSERT INTO no_go_zones (property_id, label, description) VALUES (?, ?, ?)`
      );
      no_go_zones
        .filter((z) => z && z.label)
        .forEach((z) => insertZone.run(propertyId, z.label, z.description || null));
    }
    insertPropertySpecies(propertyId, species);

    const created = db.prepare(`SELECT * FROM properties WHERE id = ?`).get(propertyId);
    created.species = db
      .prepare(
        `SELECT ps.*, gs.label, gs.requires_atcw, gs.is_other
         FROM property_species ps JOIN game_species gs ON gs.value = ps.species
         WHERE ps.property_id = ?`
      )
      .all(propertyId);
    res.status(201).json(created);
  } catch (e) {
    res.status(400).json({
      error: e.message.includes("UNIQUE") ? "A property with that PIC already exists" : e.message,
    });
  }
});

// PATCH /api/properties/:id — owner-only edit. Accepts any subset of
// the editable fields; only what's present in the body is changed.
// Passing no_go_zones replaces the full set (simplest correct model
// for a farmer editing them in one form).
app.patch("/api/properties/:id", requireAuth("farmer"), (req, res) => {
  const existing = db.prepare(`SELECT * FROM properties WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Property not found" });
  if (existing.farmer_id !== req.user.id) {
    return res.status(403).json({ error: "You can only edit your own properties" });
  }
  const speciesError = validateSpecies(req.body.species);
  if (speciesError) return res.status(400).json({ error: speciesError });

  const editable = [
    "name", "pic_code", "lot_number", "plan_number", "address", "suburb",
    "latitude", "longitude", "size_hectares", "access_notes",
    "permitted_hours", "allow_spotlighting",
  ];
  const updates = {};
  editable.forEach((field) => {
    if (req.body[field] !== undefined) {
      updates[field] = field === "allow_spotlighting" ? (req.body[field] ? 1 : 0) : req.body[field];
    }
  });

  try {
    if (Object.keys(updates).length > 0) {
      const setClause = Object.keys(updates).map((k) => `${k} = @${k}`).join(", ");
      db.prepare(`UPDATE properties SET ${setClause} WHERE id = @id`).run({ ...updates, id: req.params.id });
    }

    if (Array.isArray(req.body.no_go_zones)) {
      db.prepare(`DELETE FROM no_go_zones WHERE property_id = ?`).run(req.params.id);
      const insertZone = db.prepare(
        `INSERT INTO no_go_zones (property_id, label, description) VALUES (?, ?, ?)`
      );
      req.body.no_go_zones
        .filter((z) => z && z.label)
        .forEach((z) => insertZone.run(req.params.id, z.label, z.description || null));
    }
    if (Array.isArray(req.body.species)) {
      db.prepare(`DELETE FROM property_species WHERE property_id = ?`).run(req.params.id);
      insertPropertySpecies(req.params.id, req.body.species);
    }

    const updated = db.prepare(`SELECT * FROM properties WHERE id = ?`).get(req.params.id);
    updated.no_go_zones = db.prepare(`SELECT * FROM no_go_zones WHERE property_id = ?`).all(updated.id);
    updated.species = db
      .prepare(
        `SELECT ps.*, gs.label, gs.requires_atcw, gs.is_other
         FROM property_species ps JOIN game_species gs ON gs.value = ps.species
         WHERE ps.property_id = ?`
      )
      .all(updated.id);
    res.json(updated);
  } catch (e) {
    res.status(400).json({
      error: e.message.includes("UNIQUE") ? "A property with that PIC already exists" : e.message,
    });
  }
});

// ===========================================================
// ADMIN — properties (cleanup of test/demo listings, etc.)
// ===========================================================

// GET /api/admin/properties — every property with its owning farmer
// and a booking count, so an admin can tell a live listing from an
// unused test one before deleting.
app.get("/api/admin/properties", requireAdminAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.pic_code, p.suburb, p.created_at,
           f.name AS farmer_name, f.email AS farmer_email,
           (SELECT COUNT(*) FROM property_species ps WHERE ps.property_id = p.id) AS species_count,
           (SELECT COUNT(*) FROM bookings b WHERE b.property_id = p.id) AS booking_count
    FROM properties p
    JOIN farmers f ON f.id = p.farmer_id
    ORDER BY p.created_at DESC
  `).all();
  res.json(rows);
});

// DELETE /api/admin/properties/:id — deletes the property and
// everything under it (no-go zones, species, sightings, bookings and
// their messages/harvest declarations/reviews) via ON DELETE CASCADE.
// No in-use guard like game_species has — deleting a farmer's actual
// listing is a real (if unlikely) admin action, not something to block.
app.delete("/api/admin/properties/:id", requireAdminAuth, (req, res) => {
  const existing = db.prepare(`SELECT id FROM properties WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Property not found" });
  db.prepare(`DELETE FROM properties WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ===========================================================
// SIGHTINGS — farmer-logged pressure reports against their own property
// ===========================================================

// POST /api/sightings — owner only
// body: { property_id, species, estimated_count, damage_notes, latitude, longitude, urgent }
app.post("/api/sightings", requireAuth("farmer"), (req, res) => {
  const { property_id, species, estimated_count, damage_notes, latitude, longitude, urgent } = req.body;
  if (!property_id) {
    return res.status(400).json({ error: "property_id is required" });
  }
  const property = db.prepare(`SELECT farmer_id FROM properties WHERE id = ?`).get(property_id);
  if (!property || property.farmer_id !== req.user.id) {
    return res.status(403).json({ error: "You can only report sightings on your own properties" });
  }

  const result = db
    .prepare(`
      INSERT INTO sightings (property_id, species, estimated_count, damage_notes, latitude, longitude, urgent)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      property_id,
      species || null,
      estimated_count || null,
      damage_notes || null,
      latitude ?? null,
      longitude ?? null,
      urgent ? 1 : 0
    );

  res.status(201).json(db.prepare(`SELECT * FROM sightings WHERE id = ?`).get(result.lastInsertRowid));
});

// GET /api/properties/:id/regional-pressure — owner only. Aggregates
// sightings from *other* properties within range, grouped by species,
// so a farmer can see district-wide pest pressure before it's their
// own problem. Deliberately returns counts only, never which specific
// property/farmer reported what — this is meant to build a sense of
// the district, not let farmers see into each other's business.
const REGIONAL_PRESSURE_RADIUS_KM = 25;
const REGIONAL_PRESSURE_WINDOW_DAYS = 60;
app.get("/api/properties/:id/regional-pressure", requireAuth("farmer"), (req, res) => {
  const property = db.prepare(`SELECT * FROM properties WHERE id = ?`).get(req.params.id);
  if (!property) return res.status(404).json({ error: "Property not found" });
  if (property.farmer_id !== req.user.id) {
    return res.status(403).json({ error: "You don't have access to this property" });
  }

  const nearby = db
    .prepare(`SELECT id, latitude, longitude FROM properties WHERE id != ?`)
    .all(property.id)
    .filter(
      (p) => distanceKm(property.latitude, property.longitude, p.latitude, p.longitude) <= REGIONAL_PRESSURE_RADIUS_KM
    );

  if (nearby.length === 0) {
    return res.json({
      radius_km: REGIONAL_PRESSURE_RADIUS_KM,
      window_days: REGIONAL_PRESSURE_WINDOW_DAYS,
      property_count: 0,
      species: [],
    });
  }

  const cutoff = new Date(Date.now() - REGIONAL_PRESSURE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const placeholders = nearby.map(() => "?").join(",");
  const sightings = db
    .prepare(`SELECT property_id, species, estimated_count, urgent, reported_date FROM sightings WHERE property_id IN (${placeholders}) AND reported_date >= ?`)
    .all(
      ...nearby.map((p) => p.id),
      cutoff
    );

  const bySpecies = {};
  sightings.forEach((s) => {
    const key = s.species || "Unspecified";
    if (!bySpecies[key]) {
      bySpecies[key] = {
        sighting_count: 0,
        reportingPropertyIds: new Set(),
        total_estimated_count: 0,
        urgent_count: 0,
        latest_reported_date: null,
      };
    }
    const agg = bySpecies[key];
    agg.sighting_count += 1;
    agg.reportingPropertyIds.add(s.property_id);
    agg.total_estimated_count += s.estimated_count || 0;
    if (s.urgent) agg.urgent_count += 1;
    if (!agg.latest_reported_date || s.reported_date > agg.latest_reported_date) {
      agg.latest_reported_date = s.reported_date;
    }
  });

  const species = Object.entries(bySpecies)
    .map(([name, agg]) => ({
      species: name,
      sighting_count: agg.sighting_count,
      reporting_property_count: agg.reportingPropertyIds.size,
      total_estimated_count: agg.total_estimated_count,
      urgent_count: agg.urgent_count,
      latest_reported_date: agg.latest_reported_date,
    }))
    .sort((a, b) => b.sighting_count - a.sighting_count);

  res.json({
    radius_km: REGIONAL_PRESSURE_RADIUS_KM,
    window_days: REGIONAL_PRESSURE_WINDOW_DAYS,
    property_count: nearby.length,
    species,
  });
});

// ===========================================================
// HUNTERS (public profile view + credential self-service)
// ===========================================================

// GET /api/hunters/:id — any logged-in user can view a hunter's public profile
app.get("/api/hunters/:id", requireAuth(), (req, res) => {
  const hunter = db.prepare(`SELECT * FROM hunters WHERE id = ?`).get(req.params.id);
  if (!hunter) return res.status(404).json({ error: "Hunter not found" });

  hunter.credentials = db.prepare(`SELECT * FROM credentials WHERE hunter_id = ?`).all(hunter.id);
  hunter.reviews = db
    .prepare(
      `SELECT r.* FROM reviews r
       JOIN bookings b ON b.id = r.booking_id
       WHERE b.hunter_id = ? AND r.author_type = 'farmer'
       ORDER BY r.created_at DESC`
    )
    .all(hunter.id);
  hunter.referral_count = db
    .prepare(`SELECT COUNT(*) AS n FROM referrals WHERE hunter_id = ?`)
    .get(hunter.id).n;

  res.json(omitPassword(hunter));
});

// POST /api/hunters/:id/credentials — a hunter adds/updates their own credential
app.post("/api/hunters/:id/credentials", requireAuth("hunter"), (req, res) => {
  if (Number(req.params.id) !== req.user.id) {
    return res.status(403).json({ error: "You can only update your own credentials" });
  }
  const { credential_type, reference_number, issuer, issued_date, expiry_date, document_url } = req.body;
  if (!credential_type || !reference_number) {
    return res.status(400).json({ error: "credential_type and reference_number are required" });
  }
  db.prepare(`
    INSERT INTO credentials (hunter_id, credential_type, reference_number, issuer, issued_date, expiry_date, document_url, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    ON CONFLICT(hunter_id, credential_type) DO UPDATE SET
      reference_number = excluded.reference_number,
      issuer = excluded.issuer,
      issued_date = excluded.issued_date,
      expiry_date = excluded.expiry_date,
      document_url = excluded.document_url,
      status = 'pending',
      verified_by_admin = NULL,
      verified_at = NULL
  `).run(
    req.params.id, credential_type, reference_number,
    issuer || null, issued_date || null, expiry_date || null, document_url || null
  );

  res.status(201).json(db.prepare(`SELECT * FROM credentials WHERE hunter_id = ?`).all(req.params.id));
});

// ===========================================================
// ADMIN — credential verification
// (Gated by a real admin login — see requireAdminAuth in auth.js)
// ===========================================================

// GET /api/admin/hunters — every hunter with their credentials,
// for reviewing and verifying.
app.get("/api/admin/hunters", requireAdminAuth, (req, res) => {
  const hunters = db.prepare(`SELECT * FROM hunters ORDER BY created_at DESC`).all();
  const credStmt = db.prepare(`SELECT * FROM credentials WHERE hunter_id = ?`);
  const rows = hunters.map((h) => ({
    ...omitPassword(h),
    credentials: credStmt.all(h.id),
  }));
  res.json(rows);
});

// PATCH /api/hunters/:id — admin activation toggle + credential
// status updates.
// body: { is_active?: boolean, credential_id?: number, credential_status?: string }
app.patch("/api/hunters/:id", requireAdminAuth, (req, res) => {
  const { is_active, credential_id, credential_status } = req.body;
  if (typeof is_active === "boolean") {
    db.prepare(`UPDATE hunters SET is_active = ? WHERE id = ?`).run(is_active ? 1 : 0, req.params.id);
  }
  if (credential_id && credential_status) {
    const admin = db.prepare(`SELECT username FROM admins WHERE id = ?`).get(req.admin.id);
    db.prepare(`
      UPDATE credentials SET status = ?, verified_by_admin = ?, verified_at = datetime('now') WHERE id = ?
    `).run(credential_status, admin?.username || "admin", credential_id);
  }
  res.json(omitPassword(db.prepare(`SELECT * FROM hunters WHERE id = ?`).get(req.params.id)));
});

// ===========================================================
// NEWS — admin-posted announcements, tagged for farmers, hunters, or both
// ===========================================================

// GET /api/news — the logged-in farmer/hunter's relevant news
app.get("/api/news", requireAuth(), (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM news WHERE audience = ? OR audience = 'both' ORDER BY created_at DESC`)
    .all(req.user.role);
  res.json(rows);
});

// GET /api/admin/news — every news post, for admin management
app.get("/api/admin/news", requireAdminAuth, (req, res) => {
  res.json(db.prepare(`SELECT * FROM news ORDER BY created_at DESC`).all());
});

// POST /api/admin/news — body: { title, body, audience }
app.post("/api/admin/news", requireAdminAuth, (req, res) => {
  const { title, body, audience } = req.body;
  if (!title || !body || !["farmer", "hunter", "both"].includes(audience)) {
    return res.status(400).json({ error: "title, body and a valid audience ('farmer', 'hunter' or 'both') are required" });
  }
  const admin = db.prepare(`SELECT username FROM admins WHERE id = ?`).get(req.admin.id);
  const result = db
    .prepare(`INSERT INTO news (title, body, audience, posted_by) VALUES (?, ?, ?, ?)`)
    .run(title, body, audience, admin?.username || "admin");
  res.status(201).json(db.prepare(`SELECT * FROM news WHERE id = ?`).get(result.lastInsertRowid));
});

// DELETE /api/admin/news/:id
app.delete("/api/admin/news/:id", requireAdminAuth, (req, res) => {
  db.prepare(`DELETE FROM news WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ===========================================================
// BOOKINGS
// ===========================================================

// Shared by the booking and messages routes below — true if the
// logged-in user is either the farmer who owns the property or the
// hunter who was booked.
function assertBookingAccess(req, res, booking) {
  const property = db.prepare(`SELECT farmer_id FROM properties WHERE id = ?`).get(booking.property_id);
  const isOwnerFarmer = req.user.role === "farmer" && property?.farmer_id === req.user.id;
  const isBookedHunter = req.user.role === "hunter" && booking.hunter_id === req.user.id;
  if (!isOwnerFarmer && !isBookedHunter) {
    res.status(403).json({ error: "You don't have access to this booking" });
    return false;
  }
  return true;
}

// POST /api/bookings — logged-in farmer books a hunter on one of their own properties
// body: { property_id, hunter_id, requested_date, start_time, end_time, farmer_note }
app.post("/api/bookings", requireAuth("farmer"), (req, res) => {
  const { property_id, hunter_id, requested_date, start_time, end_time, farmer_note } = req.body;
  if (!property_id || !hunter_id || !requested_date) {
    return res.status(400).json({ error: "property_id, hunter_id and requested_date are required" });
  }
  const property = db.prepare(`SELECT farmer_id FROM properties WHERE id = ?`).get(property_id);
  if (!property || property.farmer_id !== req.user.id) {
    return res.status(403).json({ error: "You can only book on your own properties" });
  }

  const hunter = db.prepare(`SELECT * FROM hunters WHERE id = ?`).get(hunter_id);
  if (!hunter) return res.status(404).json({ error: "Hunter not found" });
  if (!isHunterAvailable(hunter, requested_date)) {
    return res.status(400).json({
      error: `${hunter.name} is ${describeAvailability(hunter)} — ${requested_date} isn't one of their available days`,
    });
  }

  const result = db
    .prepare(`
      INSERT INTO bookings (property_id, hunter_id, requested_date, start_time, end_time, farmer_note, status)
      VALUES (?, ?, ?, ?, ?, ?, 'requested')
    `)
    .run(property_id, hunter_id, requested_date, start_time || null, end_time || null, farmer_note || null);

  const booking = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(result.lastInsertRowid);
  res.status(201).json(booking);
});

// GET /api/bookings — the logged-in user's own bookings: a farmer sees
// requests against their properties, a hunter sees requests made of them.
// Each booking also carries its logged harvest declarations, and — for a
// farmer — the review they've left on it, if any (so the UI knows whether
// to show "leave a review" or the review itself).
app.get("/api/bookings", requireAuth(), (req, res) => {
  const rows =
    req.user.role === "farmer"
      ? db
          .prepare(`
            SELECT b.*, p.name AS property_name, p.suburb AS property_suburb, h.name AS hunter_name,
                   r.rating AS my_review_rating, r.comment AS my_review_comment
            FROM bookings b
            JOIN properties p ON p.id = b.property_id
            JOIN hunters h ON h.id = b.hunter_id
            LEFT JOIN reviews r ON r.booking_id = b.id AND r.author_type = 'farmer'
            WHERE p.farmer_id = ?
            ORDER BY b.requested_date DESC
          `)
          .all(req.user.id)
      : db
          .prepare(`
            SELECT b.*, p.name AS property_name, p.suburb AS property_suburb, f.name AS farmer_name
            FROM bookings b
            JOIN properties p ON p.id = b.property_id
            JOIN farmers f ON f.id = p.farmer_id
            WHERE b.hunter_id = ?
            ORDER BY b.requested_date DESC
          `)
          .all(req.user.id);

  const declStmt = db.prepare(`SELECT * FROM harvest_declarations WHERE booking_id = ? ORDER BY created_at DESC`);
  const trackingStmt = db.prepare(`SELECT * FROM tracking_sessions WHERE booking_id = ? ORDER BY started_at DESC LIMIT 1`);
  res.json(
    rows.map((b) => ({
      ...b,
      harvest_declarations: declStmt.all(b.id),
      tracking_session: trackingStmt.get(b.id) || null,
    }))
  );
});

// GET /api/bookings/:id — booking + pre-filled declaration data
app.get("/api/bookings/:id", requireAuth(), (req, res) => {
  const booking = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found" });

  const property = db.prepare(`SELECT pic_code, name, farmer_id FROM properties WHERE id = ?`).get(booking.property_id);
  const isOwnerFarmer = req.user.role === "farmer" && property?.farmer_id === req.user.id;
  const isBookedHunter = req.user.role === "hunter" && booking.hunter_id === req.user.id;
  if (!isOwnerFarmer && !isBookedHunter) {
    return res.status(403).json({ error: "You don't have access to this booking" });
  }

  const harvesterCred = db
    .prepare(`SELECT reference_number FROM credentials WHERE hunter_id = ? AND credential_type = 'primesafe_field_harvester'`)
    .get(booking.hunter_id);

  booking.declaration_prefill = {
    pic_code: property?.pic_code,
    property_name: property?.name,
    harvester_approval_no: harvesterCred?.reference_number || null,
  };
  booking.harvest_declarations = db
    .prepare(`SELECT * FROM harvest_declarations WHERE booking_id = ? ORDER BY created_at DESC`)
    .all(booking.id);

  res.json(booking);
});

// POST /api/bookings/:id/harvest-declarations — log a harvest against a
// booking (either party may log it; in practice it'll be the hunter).
// Only makes sense once the hunter has actually been on the property, so
// it's gated to approved/completed bookings.
// body: { species, carcass_count, date_of_harvest, tag_numbers }
app.post("/api/bookings/:id/harvest-declarations", requireAuth(), (req, res) => {
  const booking = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  if (!assertBookingAccess(req, res, booking)) return;
  if (!["approved", "completed"].includes(booking.status)) {
    return res.status(400).json({ error: "A harvest can only be logged against an approved or completed booking" });
  }

  const { species, carcass_count, date_of_harvest, tag_numbers } = req.body;
  if (!species || !date_of_harvest) {
    return res.status(400).json({ error: "species and date_of_harvest are required" });
  }

  const property = db.prepare(`SELECT pic_code FROM properties WHERE id = ?`).get(booking.property_id);
  const harvesterCred = db
    .prepare(`SELECT reference_number FROM credentials WHERE hunter_id = ? AND credential_type = 'primesafe_field_harvester'`)
    .get(booking.hunter_id);
  if (!harvesterCred) {
    return res.status(400).json({ error: "This hunter has no PrimeSafe Field Harvester approval on file" });
  }

  const result = db
    .prepare(`
      INSERT INTO harvest_declarations
        (booking_id, pic_code, harvester_approval_no, species, carcass_count, date_of_harvest, tag_numbers)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      booking.id,
      property.pic_code,
      harvesterCred.reference_number,
      species,
      carcass_count || 1,
      date_of_harvest,
      tag_numbers || null
    );

  res.status(201).json(db.prepare(`SELECT * FROM harvest_declarations WHERE id = ?`).get(result.lastInsertRowid));
});

// PATCH /api/bookings/:id — update status. Only the farmer who owns the
// property or the booked hunter may act, and each role can only move the
// booking to the statuses that make sense from their side: the hunter
// accepts/declines the request (or marks it done), the farmer can call it
// off or mark it done.
const BOOKING_STATUS_TRANSITIONS_BY_ROLE = {
  hunter: ["approved", "declined", "completed"],
  farmer: ["cancelled", "completed"],
};
app.patch("/api/bookings/:id", requireAuth(), (req, res) => {
  const booking = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  if (!assertBookingAccess(req, res, booking)) return;

  const { status } = req.body;
  const allowed = BOOKING_STATUS_TRANSITIONS_BY_ROLE[req.user.role];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `As a ${req.user.role}, status must be one of ${allowed.join(", ")}` });
  }

  db.prepare(`UPDATE bookings SET status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status, req.params.id);
  res.json(db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(req.params.id));
});

// ===========================================================
// REVIEWS
// A farmer reviews the hunter who worked their booking. (There's
// nowhere in the product that surfaces a hunter's review of a farmer —
// no rating column on `farmers` and no profile screen for it — so this
// only handles the farmer → hunter direction that's actually used.)
// ===========================================================

// POST /api/reviews — body: { booking_id, rating, comment }
app.post("/api/reviews", requireAuth("farmer"), (req, res) => {
  const { booking_id, rating, comment } = req.body;
  if (!booking_id || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "booking_id and an integer rating (1-5) are required" });
  }

  const booking = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(booking_id);
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  if (!assertBookingAccess(req, res, booking)) return;
  if (booking.status !== "completed") {
    return res.status(400).json({ error: "You can only review a completed booking" });
  }

  const existing = db
    .prepare(`SELECT id FROM reviews WHERE booking_id = ? AND author_type = 'farmer'`)
    .get(booking_id);
  if (existing) {
    return res.status(400).json({ error: "You've already reviewed this booking" });
  }

  const result = db
    .prepare(`INSERT INTO reviews (booking_id, author_type, rating, comment) VALUES (?, 'farmer', ?, ?)`)
    .run(booking_id, rating, comment || null);

  // Roll the new rating into the hunter's rating_avg/rating_count so it
  // shows up immediately on their profile and in match listings.
  const agg = db
    .prepare(`
      SELECT AVG(r.rating) AS avg, COUNT(*) AS n
      FROM reviews r
      JOIN bookings b ON b.id = r.booking_id
      WHERE b.hunter_id = ? AND r.author_type = 'farmer'
    `)
    .get(booking.hunter_id);
  db.prepare(`UPDATE hunters SET rating_avg = ?, rating_count = ? WHERE id = ?`)
    .run(Math.round(agg.avg * 10) / 10, agg.n, booking.hunter_id);

  res.status(201).json(db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(result.lastInsertRowid));
});

// ===========================================================
// REFERRALS
// ===========================================================

// POST /api/referrals — logged-in farmer refers a hunter to a neighbour
app.post("/api/referrals", requireAuth("farmer"), (req, res) => {
  const { hunter_id, referred_name, referred_contact, referred_property, note } = req.body;
  if (!hunter_id || !referred_name || !referred_contact) {
    return res.status(400).json({
      error: "hunter_id, referred_name and referred_contact are required",
    });
  }
  const result = db
    .prepare(`
      INSERT INTO referrals (referring_farmer_id, hunter_id, referred_name, referred_contact, referred_property, note, status)
      VALUES (?, ?, ?, ?, ?, ?, 'sent')
    `)
    .run(req.user.id, hunter_id, referred_name, referred_contact, referred_property || null, note || null);

  res.status(201).json(db.prepare(`SELECT * FROM referrals WHERE id = ?`).get(result.lastInsertRowid));
});

// GET /api/referrals — the logged-in farmer's own referral history
app.get("/api/referrals", requireAuth("farmer"), (req, res) => {
  const rows = db
    .prepare(`
      SELECT r.*, h.name AS hunter_name
      FROM referrals r
      JOIN hunters h ON h.id = r.hunter_id
      WHERE r.referring_farmer_id = ?
      ORDER BY r.created_at DESC
    `)
    .all(req.user.id);

  res.json(rows);
});

// ===========================================================
// MESSAGES — threaded per booking
// ===========================================================

// GET /api/bookings/:id/messages
app.get("/api/bookings/:id/messages", requireAuth(), (req, res) => {
  const booking = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  if (!assertBookingAccess(req, res, booking)) return;

  const messages = db
    .prepare(`SELECT * FROM messages WHERE booking_id = ? ORDER BY created_at ASC`)
    .all(booking.id);
  res.json(messages);
});

// POST /api/bookings/:id/messages — body: { content }
app.post("/api/bookings/:id/messages", requireAuth(), (req, res) => {
  const booking = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  if (!assertBookingAccess(req, res, booking)) return;

  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: "content is required" });
  }
  const result = db
    .prepare(`INSERT INTO messages (booking_id, sender_type, sender_id, content) VALUES (?, ?, ?, ?)`)
    .run(booking.id, req.user.role, req.user.id, content.trim());

  res.status(201).json(db.prepare(`SELECT * FROM messages WHERE id = ?`).get(result.lastInsertRowid));
});

// ---------------------------------------------------------
// GET /api/properties/:id/parcel — real cadastral boundary
// from Victoria's public VicPlan ArcGIS service (DTP), looked
// up by the property's stored lat/lng. No API key required —
// it's a public read-only planning data service.
// Docs: https://www.land.vic.gov.au/maps-and-spatial/spatial-data/vicmap-catalogue/vicmap-property
// ---------------------------------------------------------
const VICPLAN_PARCEL_QUERY_URL =
  "https://plan-gis.mapshare.vic.gov.au/arcgis/rest/services/Planning/VicPlan_PropertyAndParcel/MapServer/4/query";

app.get("/api/properties/:id/parcel", requireAuth("farmer"), async (req, res) => {
  const property = db.prepare(`SELECT * FROM properties WHERE id = ?`).get(req.params.id);
  if (!property) return res.status(404).json({ error: "Property not found" });
  if (property.farmer_id !== req.user.id) {
    return res.status(403).json({ error: "You don't have access to this property" });
  }

  const baseFields = {
    outFields: "PARCEL_SPI,PARCEL_PFI,PARCEL_LOT_NUMBER,PARCEL_PLAN_NUMBER",
    returnGeometry: "true",
    f: "geojson",
  };

  // Prefer an exact lot/plan attribute match when the farmer has
  // supplied it — more precise than a coordinate lookup, and doesn't
  // depend on the pinned lat/lng actually landing inside the parcel.
  let params;
  let matchedBy;
  if (property.lot_number && property.plan_number) {
    const esc = (s) => s.replace(/'/g, "''"); // basic single-quote escaping for the ArcGIS `where` clause
    params = new URLSearchParams({
      ...baseFields,
      where: `PARCEL_LOT_NUMBER='${esc(property.lot_number)}' AND PARCEL_PLAN_NUMBER='${esc(property.plan_number)}'`,
    });
    matchedBy = "lot_plan";
  } else {
    params = new URLSearchParams({
      ...baseFields,
      geometry: `${property.longitude},${property.latitude}`,
      geometryType: "esriGeometryPoint",
      inSR: "4283",
      spatialRel: "esriSpatialRelIntersects",
    });
    matchedBy = "coordinates";
  }

  try {
    let response = await fetch(`${VICPLAN_PARCEL_QUERY_URL}?${params.toString()}`);
    let data = response.ok ? await response.json() : null;
    let feature = data?.features?.[0];

    // If a lot/plan match came back empty, fall back to coordinates
    // rather than dead-ending — the farmer's typed lot/plan might have
    // a typo, but the pin is still worth trying.
    if (!feature && matchedBy === "lot_plan") {
      const fallbackParams = new URLSearchParams({
        ...baseFields,
        geometry: `${property.longitude},${property.latitude}`,
        geometryType: "esriGeometryPoint",
        inSR: "4283",
        spatialRel: "esriSpatialRelIntersects",
      });
      response = await fetch(`${VICPLAN_PARCEL_QUERY_URL}?${fallbackParams.toString()}`);
      data = response.ok ? await response.json() : null;
      feature = data?.features?.[0];
      matchedBy = feature ? "coordinates_fallback" : matchedBy;
    }

    if (!feature) {
      return res.status(404).json({
        error: property.lot_number && property.plan_number
          ? "No parcel found for that lot/plan or these coordinates"
          : "No parcel found at this property's coordinates",
      });
    }

    const ring = feature.geometry?.coordinates?.[0] || null;

    res.json({
      matched_by: matchedBy,
      spi: feature.properties?.PARCEL_SPI || null,
      lot_number: feature.properties?.PARCEL_LOT_NUMBER || null,
      plan_number: feature.properties?.PARCEL_PLAN_NUMBER || null,
      ring,
    });
  } catch (e) {
    res.status(502).json({ error: `Could not reach VicPlan: ${e.message}` });
  }
});

// ===========================================================
// LIVE TRACKING & SOS
// A hunter's GPS track during an approved booking visit. Session
// start/stop *is* the check-in/check-out record — bookings.status is
// untouched. Private to the hunter by default (share_with_farmer),
// except an unresolved SOS always grants the property's farmer access
// so they can actually help.
// ===========================================================

const TRACK_TAG_TYPES = ["shot", "left", "processed"];
const SOS_ALERT_RADIUS_KM = 20;

// POST /api/bookings/:id/tracking/start — hunter only, must be their
// own approved booking. The partial unique index on tracking_sessions
// enforces one active session per hunter at a time.
app.post("/api/bookings/:id/tracking/start", requireAuth("hunter"), (req, res) => {
  const booking = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  if (booking.hunter_id !== req.user.id) {
    return res.status(403).json({ error: "You can only track your own bookings" });
  }
  if (booking.status !== "approved") {
    return res.status(400).json({ error: "Tracking can only be started on an approved booking" });
  }
  try {
    const result = db
      .prepare(`INSERT INTO tracking_sessions (booking_id, hunter_id) VALUES (?, ?)`)
      .run(booking.id, req.user.id);
    res.status(201).json(db.prepare(`SELECT * FROM tracking_sessions WHERE id = ?`).get(result.lastInsertRowid));
  } catch (e) {
    if (e.message.includes("UNIQUE")) {
      return res.status(400).json({ error: "You already have an active tracking session" });
    }
    res.status(400).json({ error: e.message });
  }
});

// PATCH /api/tracking/:sessionId — owner hunter only. body: { stop: true }
// to end the session (server sets ended_at, never trusts a client value),
// and/or { share_with_farmer: bool }.
app.patch("/api/tracking/:sessionId", requireAuth("hunter"), (req, res) => {
  const session = db.prepare(`SELECT * FROM tracking_sessions WHERE id = ?`).get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Tracking session not found" });
  if (session.hunter_id !== req.user.id) {
    return res.status(403).json({ error: "You can only edit your own tracking session" });
  }
  if (session.ended_at) {
    return res.status(400).json({ error: "This tracking session has already ended" });
  }
  if (req.body.stop) {
    db.prepare(`UPDATE tracking_sessions SET ended_at = datetime('now') WHERE id = ?`).run(session.id);
  }
  if (req.body.share_with_farmer !== undefined) {
    db.prepare(`UPDATE tracking_sessions SET share_with_farmer = ? WHERE id = ?`).run(
      req.body.share_with_farmer ? 1 : 0,
      session.id
    );
  }
  res.json(db.prepare(`SELECT * FROM tracking_sessions WHERE id = ?`).get(session.id));
});

// POST /api/tracking/:sessionId/points — owner hunter only, only while
// active. body: { points: [{latitude, longitude}, ...] } — the client
// batches a few points per request to cut request volume.
app.post("/api/tracking/:sessionId/points", requireAuth("hunter"), (req, res) => {
  const session = db.prepare(`SELECT * FROM tracking_sessions WHERE id = ?`).get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Tracking session not found" });
  if (session.hunter_id !== req.user.id) {
    return res.status(403).json({ error: "You can only add points to your own tracking session" });
  }
  if (session.ended_at) {
    return res.status(400).json({ error: "This tracking session has ended" });
  }
  const points = Array.isArray(req.body.points) ? req.body.points : [];
  const valid = points.filter((p) => typeof p?.latitude === "number" && typeof p?.longitude === "number");
  if (valid.length === 0) {
    return res.status(400).json({ error: "points must include at least one {latitude, longitude}" });
  }
  const insertPoint = db.prepare(`INSERT INTO track_points (session_id, latitude, longitude) VALUES (?, ?, ?)`);
  db.transaction((rows) => rows.forEach((p) => insertPoint.run(session.id, p.latitude, p.longitude)))(valid);
  res.status(201).json({ ok: true, inserted: valid.length });
});

// POST /api/tracking/:sessionId/tags — owner hunter only.
app.post("/api/tracking/:sessionId/tags", requireAuth("hunter"), (req, res) => {
  const session = db.prepare(`SELECT * FROM tracking_sessions WHERE id = ?`).get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Tracking session not found" });
  if (session.hunter_id !== req.user.id) {
    return res.status(403).json({ error: "You can only tag your own tracking session" });
  }
  const { tag_type, latitude, longitude, notes } = req.body;
  if (!TRACK_TAG_TYPES.includes(tag_type) || typeof latitude !== "number" || typeof longitude !== "number") {
    return res.status(400).json({
      error: `tag_type must be one of ${TRACK_TAG_TYPES.join(", ")}, plus latitude/longitude`,
    });
  }
  const result = db
    .prepare(`INSERT INTO track_tags (session_id, tag_type, latitude, longitude, notes) VALUES (?, ?, ?, ?, ?)`)
    .run(session.id, tag_type, latitude, longitude, notes || null);
  res.status(201).json(db.prepare(`SELECT * FROM track_tags WHERE id = ?`).get(result.lastInsertRowid));
});

// GET /api/tracking/:sessionId — owner hunter, or the farmer who owns
// the booking's property AND (share_with_farmer=1 OR there's an
// unresolved SOS — safety overrides the privacy default).
app.get("/api/tracking/:sessionId", requireAuth(), (req, res) => {
  const session = db.prepare(`SELECT * FROM tracking_sessions WHERE id = ?`).get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Tracking session not found" });

  const isOwnerHunter = req.user.role === "hunter" && session.hunter_id === req.user.id;
  let isFarmerAllowed = false;
  if (req.user.role === "farmer") {
    const booking = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(session.booking_id);
    const property = booking && db.prepare(`SELECT farmer_id FROM properties WHERE id = ?`).get(booking.property_id);
    const ownsProperty = property?.farmer_id === req.user.id;
    const hasUnresolvedSos = !!db
      .prepare(`SELECT id FROM sos_alerts WHERE session_id = ? AND resolved_at IS NULL LIMIT 1`)
      .get(session.id);
    isFarmerAllowed = ownsProperty && (!!session.share_with_farmer || hasUnresolvedSos);
  }
  if (!isOwnerHunter && !isFarmerAllowed) {
    return res.status(403).json({ error: "You don't have access to this tracking session" });
  }

  session.points = db.prepare(`SELECT * FROM track_points WHERE session_id = ? ORDER BY recorded_at`).all(session.id);
  session.tags = db.prepare(`SELECT * FROM track_tags WHERE session_id = ? ORDER BY recorded_at`).all(session.id);
  res.json(session);
});

// POST /api/tracking/:sessionId/sos — owner hunter only. Pushes to the
// property's farmer, plus any other hunters currently out (active
// session) who've opted in to nearby-SOS alerts and are within radius
// of their own most recent point.
app.post("/api/tracking/:sessionId/sos", requireAuth("hunter"), (req, res) => {
  const session = db.prepare(`SELECT * FROM tracking_sessions WHERE id = ?`).get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Tracking session not found" });
  if (session.hunter_id !== req.user.id) {
    return res.status(403).json({ error: "You can only trigger SOS on your own tracking session" });
  }
  const { latitude, longitude } = req.body;
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return res.status(400).json({ error: "latitude and longitude are required" });
  }

  const result = db
    .prepare(`INSERT INTO sos_alerts (session_id, hunter_id, latitude, longitude) VALUES (?, ?, ?, ?)`)
    .run(session.id, req.user.id, latitude, longitude);
  const alert = db.prepare(`SELECT * FROM sos_alerts WHERE id = ?`).get(result.lastInsertRowid);

  const hunter = db.prepare(`SELECT name FROM hunters WHERE id = ?`).get(req.user.id);
  const booking = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(session.booking_id);
  const property = db.prepare(`SELECT * FROM properties WHERE id = ?`).get(booking.property_id);

  const payload = { type: "sos", session_id: session.id, sos_id: alert.id, hunter_name: hunter.name, lat: latitude, lng: longitude };

  db.prepare(`SELECT * FROM push_subscriptions WHERE owner_role = 'farmer' AND owner_id = ?`)
    .all(property.farmer_id)
    .forEach((sub) => sendPush(sub, payload));

  const activeHunterLatestPoints = db
    .prepare(`
      SELECT * FROM (
        SELECT tp.*, ts.hunter_id, ts.id AS session_id,
               ROW_NUMBER() OVER (PARTITION BY tp.session_id ORDER BY tp.recorded_at DESC) AS rn
        FROM track_points tp JOIN tracking_sessions ts ON ts.id = tp.session_id
        WHERE ts.ended_at IS NULL AND ts.hunter_id != ?
      ) WHERE rn = 1
    `)
    .all(req.user.id);

  activeHunterLatestPoints
    .filter((p) => {
      const h = db.prepare(`SELECT sos_alert_opt_in FROM hunters WHERE id = ?`).get(p.hunter_id);
      return h?.sos_alert_opt_in && distanceKm(latitude, longitude, p.latitude, p.longitude) <= SOS_ALERT_RADIUS_KM;
    })
    .forEach((p) => {
      db.prepare(`SELECT * FROM push_subscriptions WHERE owner_role = 'hunter' AND owner_id = ?`)
        .all(p.hunter_id)
        .forEach((sub) => sendPush(sub, payload));
    });

  res.status(201).json(alert);
});

// PATCH /api/sos/:id — owner hunter (false alarm, resolved themselves)
// or the farmer on that property.
app.patch("/api/sos/:id", requireAuth(), (req, res) => {
  const alert = db.prepare(`SELECT * FROM sos_alerts WHERE id = ?`).get(req.params.id);
  if (!alert) return res.status(404).json({ error: "SOS alert not found" });

  const isOwnerHunter = req.user.role === "hunter" && alert.hunter_id === req.user.id;
  let isPropertyFarmer = false;
  if (req.user.role === "farmer") {
    const session = db.prepare(`SELECT * FROM tracking_sessions WHERE id = ?`).get(alert.session_id);
    const booking = session && db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(session.booking_id);
    const property = booking && db.prepare(`SELECT farmer_id FROM properties WHERE id = ?`).get(booking.property_id);
    isPropertyFarmer = property?.farmer_id === req.user.id;
  }
  if (!isOwnerHunter && !isPropertyFarmer) {
    return res.status(403).json({ error: "You don't have access to this SOS alert" });
  }

  db.prepare(`UPDATE sos_alerts SET resolved_at = datetime('now'), resolved_by_role = ?, resolved_by_id = ? WHERE id = ?`)
    .run(req.user.role, req.user.id, alert.id);
  res.json(db.prepare(`SELECT * FROM sos_alerts WHERE id = ?`).get(alert.id));
});

// GET /api/sos/active — in-app fallback since push delivery isn't
// guaranteed. Farmers see unresolved SOS on their properties' bookings;
// hunters see their own, plus (if opted in) any within radius of their
// own active session's latest point.
app.get("/api/sos/active", requireAuth(), (req, res) => {
  if (req.user.role === "farmer") {
    return res.json(
      db.prepare(`
        SELECT sa.*, h.name AS hunter_name, h.emergency_contact_name, h.emergency_contact_phone,
               p.name AS property_name
        FROM sos_alerts sa
        JOIN tracking_sessions ts ON ts.id = sa.session_id
        JOIN bookings b ON b.id = ts.booking_id
        JOIN properties p ON p.id = b.property_id
        JOIN hunters h ON h.id = sa.hunter_id
        WHERE sa.resolved_at IS NULL AND p.farmer_id = ?
        ORDER BY sa.triggered_at DESC
      `).all(req.user.id)
    );
  }

  const own = db
    .prepare(`SELECT sa.*, h.name AS hunter_name FROM sos_alerts sa JOIN hunters h ON h.id = sa.hunter_id WHERE sa.resolved_at IS NULL AND sa.hunter_id = ?`)
    .all(req.user.id);

  const me = db.prepare(`SELECT sos_alert_opt_in FROM hunters WHERE id = ?`).get(req.user.id);
  let nearby = [];
  if (me?.sos_alert_opt_in) {
    const myLatestPoint = db
      .prepare(`
        SELECT tp.* FROM track_points tp JOIN tracking_sessions ts ON ts.id = tp.session_id
        WHERE ts.hunter_id = ? AND ts.ended_at IS NULL ORDER BY tp.recorded_at DESC LIMIT 1
      `)
      .get(req.user.id);
    if (myLatestPoint) {
      nearby = db
        .prepare(`SELECT sa.*, h.name AS hunter_name FROM sos_alerts sa JOIN hunters h ON h.id = sa.hunter_id WHERE sa.resolved_at IS NULL AND sa.hunter_id != ?`)
        .all(req.user.id)
        .filter((sa) => distanceKm(sa.latitude, sa.longitude, myLatestPoint.latitude, myLatestPoint.longitude) <= SOS_ALERT_RADIUS_KM);
    }
  }
  res.json([...own, ...nearby]);
});

// ===========================================================
// PUSH SUBSCRIPTIONS
// Web Push (not a third-party service — VAPID keys only) backing the
// hunter live-tracking SOS alert. A farmer or hunter can have several
// subscriptions (one per device).
// ===========================================================

// GET /api/push/vapid-public-key — any authed user, needed client-side
// for pushManager.subscribe({ applicationServerKey: ... })
app.get("/api/push/vapid-public-key", requireAuth(), (req, res) => {
  res.json({
    publicKey:
      process.env.VAPID_PUBLIC_KEY ||
      "BCBd5HYiBZJjCBdFLjQm11ceAagJ8Kj3SwfQyFsElJ5KIO2TfCpRFIJ6uXenRDsp6l8Rf07oipABXYFHE5Vty-I",
  });
});

// POST /api/push/subscribe — body: { endpoint, keys: { p256dh, auth } }
// Upsert, not a plain insert — a device can legitimately resubscribe
// with the same endpoint but rotated keys (see pushsubscriptionchange
// handling in src/sw.js).
app.post("/api/push/subscribe", requireAuth(), (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: "endpoint and keys.p256dh/keys.auth are required" });
  }
  db.prepare(`
    INSERT INTO push_subscriptions (owner_role, owner_id, endpoint, p256dh, auth)
    VALUES (@owner_role, @owner_id, @endpoint, @p256dh, @auth)
    ON CONFLICT(endpoint) DO UPDATE SET
      p256dh = excluded.p256dh, auth = excluded.auth,
      owner_role = excluded.owner_role, owner_id = excluded.owner_id
  `).run({
    owner_role: req.user.role,
    owner_id: req.user.id,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
  });
  res.status(201).json({ ok: true });
});

// POST /api/push/unsubscribe — body: { endpoint }
app.post("/api/push/unsubscribe", requireAuth(), (req, res) => {
  db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ? AND owner_role = ? AND owner_id = ?`).run(
    req.body.endpoint, req.user.role, req.user.id
  );
  res.json({ ok: true });
});

// Most hosts (Render included) assign the port via PORT and expect the
// app to listen on it rather than a fixed port.
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Muster API running at http://localhost:${PORT}`);
});
