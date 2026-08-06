// Populates muster.db with sample data matching the mockup screens.
// Run once with: npm run seed
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const { hashPassword } = require("./auth");

const DEMO_PASSWORD = "password123"; // demo accounts only — never do this for real users

const dbPath = path.join(__dirname, "muster.db");
const isNew = !fs.existsSync(dbPath);
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

// Always (re)build schema fresh for local dev/test convenience.
db.exec(fs.readFileSync(path.join(__dirname, "reset.sql"), "utf8"));
db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));

const insertSpecies = db.prepare(`
  INSERT INTO game_species (value, label, requires_atcw, is_other, sort_order)
  VALUES (@value, @label, @requires_atcw, @is_other, @sort_order)
`);
[
  { value: "deer", label: "Deer", requires_atcw: 0, is_other: 0 },
  { value: "fox", label: "Fox", requires_atcw: 0, is_other: 0 },
  { value: "rabbit", label: "Rabbit", requires_atcw: 0, is_other: 0 },
  { value: "hare", label: "Hare", requires_atcw: 0, is_other: 0 },
  { value: "wild_dog", label: "Wild Dog", requires_atcw: 0, is_other: 0 },
  { value: "kangaroo_harvest", label: "Kangaroo (Harvest)", requires_atcw: 0, is_other: 0 },
  { value: "kangaroo_atcw", label: "Kangaroo", requires_atcw: 1, is_other: 0 },
  { value: "wombat_atcw", label: "Wombat", requires_atcw: 1, is_other: 0 },
  { value: "other", label: "Other", requires_atcw: 0, is_other: 1 },
].forEach((s, i) => insertSpecies.run({ ...s, sort_order: i }));

const insertFarmer = db.prepare(
  `INSERT INTO farmers (name, email, phone, password_hash) VALUES (?, ?, ?, ?)`
);
const farmerId = insertFarmer.run(
  "Nathan Hambly", "nathan@example.com", "0400 000 000", hashPassword(DEMO_PASSWORD)
).lastInsertRowid;

const insertProperty = db.prepare(`
  INSERT INTO properties
    (farmer_id, name, pic_code, lot_number, plan_number, address, suburb, latitude, longitude,
     size_hectares, access_notes, permitted_hours, allow_spotlighting)
  VALUES (@farmer_id, @name, @pic_code, @lot_number, @plan_number, @address, @suburb, @latitude, @longitude,
          @size_hectares, @access_notes, @permitted_hours, @allow_spotlighting)
`);
const propertyId = insertProperty.run({
  farmer_id: farmerId,
  name: "Riverbend",
  pic_code: "3TR00412",
  // Real lot/plan near the seeded coordinates (verified against VicPlan)
  // so the "centre map on real parcel" match has something to find.
  lot_number: "3",
  plan_number: "TP867802",
  address: "1420 Mansfield-Woods Point Rd",
  suburb: "Mansfield",
  latitude: -37.0503,
  longitude: 146.0888,
  size_hectares: 412,
  access_notes: "Main gate code 4471#. Track suitable for 4WD only after rain.",
  permitted_hours: "05:30-09:00,16:00-dusk",
  allow_spotlighting: 0,
}).lastInsertRowid;

db.prepare(
  `INSERT INTO no_go_zones (property_id, label, description) VALUES (?, ?, ?)`
).run(propertyId, "House paddock", "Excludes house paddock and dam frontage");

const insertPropertySpecies = db.prepare(`
  INSERT INTO property_species
    (property_id, species, other_description, atcw_document_url, atcw_remaining_quantity, atcw_expiry_date)
  VALUES (@property_id, @species, @other_description, @atcw_document_url, @atcw_remaining_quantity, @atcw_expiry_date)
`);
[
  { species: "deer", other_description: null, atcw_document_url: null, atcw_remaining_quantity: null, atcw_expiry_date: null },
  { species: "fox", other_description: null, atcw_document_url: null, atcw_remaining_quantity: null, atcw_expiry_date: null },
  {
    // Deliberately within the 8-week ATCW expiry warning window (see
    // atcwExpiryStatus() in server.js) so the reminder feature has
    // something to show out of the box, not just on manual testing.
    species: "kangaroo_atcw",
    other_description: null,
    atcw_document_url: "https://drive.example.com/riverbend-atcw-kangaroo.pdf",
    atcw_remaining_quantity: 40,
    atcw_expiry_date: "2026-09-20",
  },
].forEach((s) => insertPropertySpecies.run({ property_id: propertyId, ...s }));

const insertSighting = db.prepare(`
  INSERT INTO sightings (property_id, species, estimated_count, damage_notes, urgent)
  VALUES (?, ?, ?, ?, ?)
`);
insertSighting.run(propertyId, "Sambar", 6, "Fence damage along the eastern boundary", 0);
insertSighting.run(propertyId, "Fallow", 3, "Crop damage in the lower paddock", 1);

const insertHunter = db.prepare(`
  INSERT INTO hunters
    (name, email, phone, password_hash, bio, latitude, longitude, thermal_capable, suppressed_capable, is_active)
  VALUES (@name, @email, @phone, @password_hash, @bio, @latitude, @longitude, @thermal_capable, @suppressed_capable, 1)
`);

const hunters = [
  {
    name: "Tom Riordan",
    email: "tom@example.com",
    phone: "0411 111 111",
    password_hash: hashPassword(DEMO_PASSWORD),
    bio: "Ten years harvesting Sambar and Fallow across the King Valley. Full field depot rig, quiet on approach.",
    latitude: -37.0, longitude: 146.05,
    thermal_capable: 1, suppressed_capable: 1,
  },
  {
    name: "Jess McAllister",
    email: "jess@example.com",
    phone: "0422 222 222",
    password_hash: hashPassword(DEMO_PASSWORD),
    bio: "Based out of Alexandra, mostly Sambar country.",
    latitude: -37.19, longitude: 145.71,
    thermal_capable: 1, suppressed_capable: 0,
  },
  {
    name: "Dale Kovac",
    email: "dale@example.com",
    phone: "0433 333 333",
    password_hash: hashPassword(DEMO_PASSWORD),
    bio: "Long-time contract shooter, five-star record.",
    latitude: -37.28, longitude: 146.32,
    thermal_capable: 0, suppressed_capable: 0,
  },
];

const hunterIds = hunters.map((h) => insertHunter.run(h).lastInsertRowid);

const insertCredential = db.prepare(`
  INSERT INTO credentials
    (hunter_id, credential_type, reference_number, issuer, issued_date, expiry_date, status, verified_by_admin, verified_at)
  VALUES (@hunter_id, @credential_type, @reference_number, @issuer, @issued_date, @expiry_date, @status, @verified_by_admin, @verified_at)
`);

const credentialSets = [
  // Tom Riordan — fully verified, suppressor permit expiring soon
  [
    { credential_type: "primesafe_field_harvester", reference_number: "PS-22841", issuer: "PrimeSafe", issued_date: "2024-03-01", expiry_date: "2027-03-01", status: "verified" },
    { credential_type: "game_licence", reference_number: "GL-88213", issuer: "Game Management Authority", issued_date: "2024-06-01", expiry_date: "2027-06-01", status: "verified" },
    { credential_type: "firearms_licence", reference_number: "FA-10234", issuer: "Victoria Police", issued_date: "2022-01-01", expiry_date: "2027-01-01", status: "verified" },
    { credential_type: "vehicle_field_depot", reference_number: "1RB-4KJ", issuer: "PrimeSafe", issued_date: "2024-03-01", expiry_date: "2027-03-01", status: "verified" },
    { credential_type: "public_liability_insurance", reference_number: "PL-556291", issuer: "Rural Insurers Co.", issued_date: "2026-01-15", expiry_date: "2027-01-15", status: "verified" },
    { credential_type: "suppressor_permit", reference_number: "F-90213", issuer: "Victoria Police", issued_date: "2025-08-15", expiry_date: "2026-08-15", status: "warning" },
  ],
  // Jess McAllister — vehicle licence close to expiry
  [
    { credential_type: "primesafe_field_harvester", reference_number: "PS-30112", issuer: "PrimeSafe", issued_date: "2023-11-01", expiry_date: "2026-11-01", status: "verified" },
    { credential_type: "game_licence", reference_number: "GL-77102", issuer: "Game Management Authority", issued_date: "2024-02-01", expiry_date: "2027-02-01", status: "verified" },
    { credential_type: "firearms_licence", reference_number: "FA-22981", issuer: "Victoria Police", issued_date: "2021-05-01", expiry_date: "2026-05-01", status: "verified" },
    { credential_type: "vehicle_field_depot", reference_number: "3XJ-991", issuer: "PrimeSafe", issued_date: "2023-08-10", expiry_date: "2026-08-10", status: "warning" },
    { credential_type: "public_liability_insurance", reference_number: "PL-99213", issuer: "AgriCover", issued_date: "2026-02-01", expiry_date: "2027-02-01", status: "verified" },
  ],
  // Dale Kovac — fully verified, no thermal/suppressor
  [
    { credential_type: "primesafe_field_harvester", reference_number: "PS-11029", issuer: "PrimeSafe", issued_date: "2022-04-01", expiry_date: "2027-04-01", status: "verified" },
    { credential_type: "game_licence", reference_number: "GL-55210", issuer: "Game Management Authority", issued_date: "2024-09-01", expiry_date: "2027-09-01", status: "verified" },
    { credential_type: "firearms_licence", reference_number: "FA-30871", issuer: "Victoria Police", issued_date: "2020-03-01", expiry_date: "2027-03-01", status: "verified" },
    { credential_type: "vehicle_mtv", reference_number: "8KP-220", issuer: "PrimeSafe", issued_date: "2024-01-01", expiry_date: "2027-01-01", status: "verified" },
    { credential_type: "public_liability_insurance", reference_number: "PL-40021", issuer: "Rural Insurers Co.", issued_date: "2026-03-01", expiry_date: "2027-03-01", status: "verified" },
  ],
];

hunterIds.forEach((hunterId, i) => {
  credentialSets[i].forEach((c) =>
    insertCredential.run({
      hunter_id: hunterId,
      verified_by_admin: c.status === "verified" || c.status === "warning" ? "admin" : null,
      verified_at: c.status === "verified" || c.status === "warning" ? c.issued_date : null,
      ...c,
    })
  );
});

// Dale has no dense booking run to conflict with (unlike Tom/Jess below),
// so he's a clean demo of a weekly availability pattern: hunts Mon-Thu only.
db.prepare(`
  UPDATE hunters SET availability_mode = 'weekly', availability_days = 'mon,tue,wed,thu' WHERE id = ?
`).run(hunterIds[2]);

const insertBooking = db.prepare(`
  INSERT INTO bookings (property_id, hunter_id, requested_date, start_time, end_time, status, farmer_note)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const bookingId = insertBooking.run(
  propertyId, hunterIds[0], "2026-08-15", "05:30", "09:00", "approved",
  "Livestock in the north paddock this week"
).lastInsertRowid;

db.prepare(`INSERT INTO reviews (booking_id, author_type, rating, comment) VALUES (?, ?, ?, ?)`)
  .run(bookingId, "farmer", 5, "Always closes the gates behind him.");

// bump rating rollups
db.prepare(`
  UPDATE hunters SET rating_avg = 4.9, rating_count = 21 WHERE id = ?
`).run(hunterIds[0]);
db.prepare(`UPDATE hunters SET rating_avg = 4.7, rating_count = 12 WHERE id = ?`).run(hunterIds[1]);
db.prepare(`UPDATE hunters SET rating_avg = 5.0, rating_count = 34 WHERE id = ?`).run(hunterIds[2]);

db.prepare(`
  INSERT INTO referrals (referring_farmer_id, hunter_id, referred_name, referred_contact, referred_property, note, status)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(farmerId, hunterIds[2], "Neighbouring Farmer", "0455 555 555", "Hillcrest Angus, Jamieson", null, "signed_up");

const ADMIN_PASSWORD = "admin12345"; // demo account only — never do this for real admins
db.prepare(`INSERT INTO admins (username, password_hash) VALUES (?, ?)`)
  .run("admin", hashPassword(ADMIN_PASSWORD));

db.prepare(`INSERT INTO news (title, body, audience, posted_by) VALUES (?, ?, ?, ?)`).run(
  "Deer season opens 1 March",
  "The 2026 season opens across all public and private land. Make sure your Game Licence and PrimeSafe approval are current before your first booking.",
  "both",
  "admin"
);
db.prepare(`INSERT INTO news (title, body, audience, posted_by) VALUES (?, ?, ?, ?)`).run(
  "New: report sightings straight from your property map",
  "You can now log a sighting or damage report directly from the Farmer dashboard — no more emailing us photos. Urgent reports are flagged to nearby hunters automatically.",
  "farmer",
  "admin"
);
db.prepare(`INSERT INTO news (title, body, audience, posted_by) VALUES (?, ?, ?, ?)`).run(
  "ATCW renewals — get in early",
  "We're seeing longer turnaround times on Authority to Control Wildlife renewals this quarter. If a property's kangaroo or wombat permit expires in the next 8 weeks, ask the farmer to start their renewal now.",
  "hunter",
  "admin"
);

// ============================================================
// BULK DEMO DATA — 20 more farmers (each with one property) and
// 20 more hunters, spread across Victoria, then one booking per
// new hunter against one of their nearest properties, spread over
// consecutive days. Seeded PRNG so `npm run seed` is reproducible
// instead of spraying different data on every run.
// ============================================================
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260804);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const randRange = (min, max) => min + rand() * (max - min);
const jitter = (v, spread) => v + (rand() - 0.5) * spread;
function randomMobile() {
  const d = () => Math.floor(rand() * 10);
  return `04${d()}${d()} ${d()}${d()}${d()} ${d()}${d()}${d()}`;
}
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// A spread of real Victorian towns — High Country, Gippsland, the
// Wimmera/Grampians and the Western District — farmer/hunter
// locations are jittered around these so distances vary naturally.
const VIC_TOWNS = [
  { name: "Bright", lat: -36.73, lng: 146.96 },
  { name: "Omeo", lat: -37.1, lng: 147.6 },
  { name: "Corryong", lat: -36.1961, lng: 147.9008 },
  { name: "Beechworth", lat: -36.3583, lng: 146.6883 },
  { name: "Wangaratta", lat: -36.3583, lng: 146.3167 },
  { name: "Benalla", lat: -36.55, lng: 145.9833 },
  { name: "Euroa", lat: -36.75, lng: 145.5667 },
  { name: "Yea", lat: -37.2167, lng: 145.4333 },
  { name: "Marysville", lat: -37.5083, lng: 145.75 },
  { name: "Warburton", lat: -37.75, lng: 145.69 },
  { name: "Heyfield", lat: -37.9667, lng: 146.7833 },
  { name: "Traralgon", lat: -38.1958, lng: 146.5406 },
  { name: "Yarram", lat: -38.5667, lng: 146.6833 },
  { name: "Foster", lat: -38.6667, lng: 146.2 },
  { name: "Leongatha", lat: -38.4833, lng: 145.95 },
  { name: "Warragul", lat: -38.1667, lng: 145.9333 },
  { name: "Bairnsdale", lat: -37.8167, lng: 147.6167 },
  { name: "Orbost", lat: -37.7, lng: 148.45 },
  { name: "Daylesford", lat: -37.3417, lng: 144.1467 },
  { name: "Ararat", lat: -37.2833, lng: 142.9333 },
  { name: "Stawell", lat: -37.0578, lng: 142.7756 },
  { name: "Horsham", lat: -36.7167, lng: 142.2 },
  { name: "Hamilton", lat: -37.75, lng: 142.0333 },
  { name: "Camperdown", lat: -38.2333, lng: 143.15 },
  { name: "Colac", lat: -38.34, lng: 143.5844 },
];

const FIRST_NAMES = [
  "Liam", "Noah", "Oliver", "Jack", "William", "James", "Ethan", "Henry", "Alexander", "Mason",
  "Charlotte", "Olivia", "Amelia", "Isla", "Mia", "Grace", "Chloe", "Ruby", "Ella", "Sophie",
  "Hannah", "Zoe", "Lucas", "Thomas", "Samuel", "Isabella", "Matilda", "Georgia", "Emily", "Lily",
];
const LAST_NAMES = [
  "Smith", "Jones", "Williams", "Brown", "Wilson", "Taylor", "Anderson", "Thompson", "White", "Harris",
  "Martin", "Clarke", "Walker", "Robinson", "Wright", "King", "Scott", "Baker", "Carter", "Mitchell",
  "Turner", "Phillips", "Campbell", "Parker", "Evans", "Reid", "Murphy", "Bell", "Cooper", "Ward",
];
const PROPERTY_WORDS = ["Run", "Station", "Downs", "Ridge", "Creek Farm", "Paddocks", "Flats", "Rise"];
const CREDENTIAL_ISSUERS = {
  primesafe_field_harvester: "PrimeSafe",
  game_licence: "Game Management Authority",
  firearms_licence: "Victoria Police",
  vehicle_field_depot: "PrimeSafe",
  vehicle_mtv: "PrimeSafe",
  public_liability_insurance: "Rural Insurers Co.",
  suppressor_permit: "Victoria Police",
};

const usedNames = new Set();
function uniqueName() {
  let first, last, key;
  do {
    first = pick(FIRST_NAMES);
    last = pick(LAST_NAMES);
    key = `${first} ${last}`;
  } while (usedNames.has(key));
  usedNames.add(key);
  return { first, last };
}

// ---- 20 more farmers, each with one property ----
const bulkFarmerIds = [];
for (let i = 0; i < 20; i++) {
  const { first, last } = uniqueName();
  const town = pick(VIC_TOWNS);
  const lat = jitter(town.lat, 0.3);
  const lng = jitter(town.lng, 0.3);

  const fid = insertFarmer.run(
    `${first} ${last}`,
    `${first.toLowerCase()}.${last.toLowerCase()}${i + 1}@example.com`,
    randomMobile(),
    hashPassword(DEMO_PASSWORD)
  ).lastInsertRowid;
  bulkFarmerIds.push(fid);

  insertProperty.run({
    farmer_id: fid,
    name: `${last}'s ${pick(PROPERTY_WORDS)}`,
    pic_code: `3${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + ((i * 3) % 26))}${String(10000 + i).padStart(5, "0")}`,
    lot_number: null,
    plan_number: null,
    address: `${100 + i} ${town.name} Rd`,
    suburb: town.name,
    latitude: lat,
    longitude: lng,
    size_hectares: Math.round(randRange(40, 900)),
    access_notes: "Contact owner for gate code before arrival.",
    permitted_hours: "05:30-09:00,16:00-dusk",
    allow_spotlighting: rand() > 0.7 ? 1 : 0,
  });
}

// A few explicit "neighbour" properties close to Riverbend, owned by
// 3 of the bulk farmers above (a farmer can list more than one
// property), each with a sighting — so the "regional pest pressure"
// view has real nearby data for Nathan out of the box. None of the 20
// randomly-placed bulk properties land within a realistic same-district
// radius of Mansfield, since it's fairly isolated in the High Country,
// so picking "nearest of the random 20" doesn't work here.
const NEIGHBOUR_LOCALITIES = ["Merrijig", "Bonnie Doon", "Maindample"];
const neighbourSightings = [
  { species: "Sambar", estimated_count: 4, damage_notes: "Fence line pushed through near the creek.", urgent: 0 },
  { species: "Sambar", estimated_count: 2, damage_notes: null, urgent: 0 },
  { species: "Fallow", estimated_count: 5, damage_notes: "Heavy grazing pressure on new pasture.", urgent: 1 },
];
NEIGHBOUR_LOCALITIES.forEach((locality, i) => {
  const pid = insertProperty.run({
    farmer_id: bulkFarmerIds[i],
    name: `${locality} Block`,
    pic_code: `3NB${String(20000 + i).padStart(5, "0")}`,
    lot_number: null,
    plan_number: null,
    address: `${200 + i} ${locality} Rd`,
    suburb: locality,
    latitude: jitter(-37.0503, 0.2),
    longitude: jitter(146.0888, 0.2),
    size_hectares: Math.round(randRange(60, 300)),
    access_notes: "Contact owner for gate code before arrival.",
    permitted_hours: "05:30-09:00,16:00-dusk",
    allow_spotlighting: 0,
  }).lastInsertRowid;

  const s = neighbourSightings[i];
  insertSighting.run(pid, s.species, s.estimated_count, s.damage_notes, s.urgent);
});

// ---- 20 more hunters, spread independently across the same towns ----
const bulkHunterIds = [];
for (let i = 0; i < 20; i++) {
  const { first, last } = uniqueName();
  const town = pick(VIC_TOWNS);
  const lat = jitter(town.lat, 0.6);
  const lng = jitter(town.lng, 0.6);
  const thermal = rand() > 0.4 ? 1 : 0;
  const suppressed = thermal && rand() > 0.5 ? 1 : 0;

  const hid = insertHunter.run({
    name: `${first} ${last}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}${i + 1}@example.com`,
    phone: randomMobile(),
    password_hash: hashPassword(DEMO_PASSWORD),
    bio: `Based near ${town.name} — ${pick([
      "mostly Sambar country.",
      "works Sambar and Fallow.",
      "experienced with mixed terrain.",
      "quiet on approach, own field depot rig.",
    ])}`,
    latitude: lat,
    longitude: lng,
    thermal_capable: thermal,
    suppressed_capable: suppressed,
  }).lastInsertRowid;
  bulkHunterIds.push(hid);

  // insertHunter always sets is_active = 1; most stay that way, a
  // few get put back to pending-review to keep that state populated.
  if (rand() < 0.15) {
    db.prepare(`UPDATE hunters SET is_active = 0 WHERE id = ?`).run(hid);
  }
  db.prepare(`UPDATE hunters SET rating_avg = ?, rating_count = ? WHERE id = ?`).run(
    Math.round(randRange(3.5, 5) * 10) / 10,
    Math.floor(randRange(0, 40)),
    hid
  );

  const types = ["primesafe_field_harvester", "game_licence", "firearms_licence", "public_liability_insurance"];
  if (rand() > 0.3) types.push(rand() > 0.5 ? "vehicle_field_depot" : "vehicle_mtv");
  if (suppressed) types.push("suppressor_permit");

  types.forEach((type) => {
    const status = rand() > 0.85 ? "pending" : rand() > 0.9 ? "warning" : "verified";
    insertCredential.run({
      hunter_id: hid,
      credential_type: type,
      reference_number: `${type.slice(0, 2).toUpperCase()}-${Math.floor(randRange(10000, 99999))}`,
      issuer: CREDENTIAL_ISSUERS[type],
      issued_date: "2024-01-01",
      expiry_date: "2027-01-01",
      status,
      verified_by_admin: status !== "pending" ? "admin" : null,
      verified_at: status !== "pending" ? "2024-01-01" : null,
    });
  });
}

// Two more availability-pattern demos, on bulk hunters (each only has
// their single bulk booking below, so little chance of it visibly
// clashing with the pattern): weekends-only, and every-2nd-day.
db.prepare(`
  UPDATE hunters SET availability_mode = 'weekly', availability_days = 'fri,sat,sun' WHERE id = ?
`).run(bulkHunterIds[0]);
db.prepare(`
  UPDATE hunters SET availability_mode = 'interval', availability_interval = 2, availability_anchor_date = '2026-08-01' WHERE id = ?
`).run(bulkHunterIds[1]);

// ---- one booking per new hunter, against one of their 3 nearest
// properties (across every farmer, old and new), spread over
// consecutive calendar days ----
const allProperties = db.prepare(`SELECT id, latitude, longitude FROM properties`).all();
// Built from Date.UTC + a plain ms counter (not `new Date("...T00:00:00")`,
// which parses as local time) so the resulting date strings don't shift by
// a day depending on the host machine's timezone.
let bookingDateMs = Date.UTC(2026, 7, 20); // month is 0-indexed: 7 = August
bulkHunterIds.forEach((hid) => {
  const hunter = db.prepare(`SELECT latitude, longitude FROM hunters WHERE id = ?`).get(hid);
  const nearest = [...allProperties]
    .sort(
      (a, b) =>
        distanceKm(hunter.latitude, hunter.longitude, a.latitude, a.longitude) -
        distanceKm(hunter.latitude, hunter.longitude, b.latitude, b.longitude)
    )
    .slice(0, 3);
  const property = pick(nearest);

  insertBooking.run(
    property.id,
    hid,
    new Date(bookingDateMs).toISOString().slice(0, 10),
    "05:30",
    "09:00",
    pick(["requested", "requested", "approved", "approved", "declined"]),
    pick([null, "Livestock nearby this week.", "Please stay clear of the house paddock.", null])
  );

  bookingDateMs += 24 * 60 * 60 * 1000;
});

// ---- 2 hunters booked solid for 3 weeks straight — Tom and Jess,
// working a mix of their nearest properties each day. A clear
// "in high demand" demo state, distinct from the 20 one-off bulk
// bookings above (different date range, all approved not a mix). ----
const BUSY_DAYS = 21;
const BUSY_HUNTER_IDS = [hunterIds[0], hunterIds[1]]; // Tom Riordan, Jess McAllister
const busyStartMs = Date.UTC(2026, 8, 9); // month is 0-indexed: 8 = September
BUSY_HUNTER_IDS.forEach((hid) => {
  const hunter = db.prepare(`SELECT latitude, longitude FROM hunters WHERE id = ?`).get(hid);
  const nearest = [...allProperties]
    .sort(
      (a, b) =>
        distanceKm(hunter.latitude, hunter.longitude, a.latitude, a.longitude) -
        distanceKm(hunter.latitude, hunter.longitude, b.latitude, b.longitude)
    )
    .slice(0, 3);

  for (let d = 0; d < BUSY_DAYS; d++) {
    const property = pick(nearest);
    insertBooking.run(
      property.id,
      hid,
      new Date(busyStartMs + d * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      "05:30",
      "09:00",
      "approved",
      null
    );
  }
});

console.log(`Seeded ${dbPath}`);
console.log(`Farmer #${farmerId}, Property #${propertyId}, Hunters: ${hunterIds.join(", ")}`);
console.log(`Plus ${bulkFarmerIds.length} bulk farmers, ${bulkHunterIds.length} bulk hunters, and a booking per bulk hunter across ${bulkHunterIds.length} consecutive days from 2026-08-20.`);
console.log(`Tom Riordan and Jess McAllister are each booked solid for ${BUSY_DAYS} consecutive days from 2026-09-09.`);
console.log(`Demo logins (password: ${DEMO_PASSWORD}):`);
console.log(`  Farmer — nathan@example.com (plus 20 more, e.g. firstname.lastnameN@example.com)`);
console.log(`  Hunter — tom@example.com / jess@example.com / dale@example.com (plus 20 more)`);
console.log(`Admin login — username "admin", password "${ADMIN_PASSWORD}"`);

db.close();

// Node's normal shutdown sequence runs a final GC/cleanup pass, which is
// what triggered the RemoveEnvironmentCleanupHook crash on Render's Linux
// runtime (better-sqlite3 Statement objects being finalized after the
// environment starts tearing down). Exiting immediately skips that pass.
process.exit(0);
