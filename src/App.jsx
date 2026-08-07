import React, { useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  MapPin,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Truck,
  Thermometer,
  VolumeX,
  Star,
  Send,
  UserPlus,
  Calendar,
  ChevronRight,
  ChevronLeft,
  Check,
  Clock,
  FileText,
  MessageSquare,
  AlertTriangle,
  LogIn,
  LayoutDashboard,
  User,
  ClipboardList,
  Home,
  Pencil,
  UserCheck,
  Settings,
  ListChecks,
  X,
  Newspaper,
  Trash2,
  RefreshCw,
  Navigation,
  Siren,
  Crosshair,
} from "lucide-react";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Leaflet's default marker icon breaks under Vite/Rollup bundling unless
// explicitly re-pointed at the bundled image URLs — a well-known gotcha,
// not a Muster-specific bug.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: new URL("leaflet/dist/images/marker-icon-2x.png", import.meta.url).href,
  iconUrl: new URL("leaflet/dist/images/marker-icon.png", import.meta.url).href,
  shadowUrl: new URL("leaflet/dist/images/marker-shadow.png", import.meta.url).href,
});

/* ---------------------------------------------------------
   TOKENS
--------------------------------------------------------- */
const C = {
  paper: "#F6F3EC",
  paperDim: "#EFEADF",
  charcoal: "#2A2621",
  bark: "#5B5044",
  eucalypt: "#4B5D45",
  eucalyptDeep: "#37452F",
  gold: "#B4842A",
  goldDeep: "#8F6720",
  rust: "#A6432E",
  mist: "#E3E6DC",
  steel: "#7B7A6E",
  line: "#D8D2C2",
  white: "#FFFDF8",
};

const fontDisplay = { fontFamily: "'Fraunces', ui-serif, Georgia, serif" };
const fontBody = { fontFamily: "'IBM Plex Sans', ui-sans-serif, system-ui" };
const fontMono = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };

// Node backend (see /server) — run `npm run seed && npm start` in that folder.
// Locally this defaults to localhost. Deployed, VITE_API_BASE is set to the
// relative path "/api" — vercel.json rewrites /api/* to the Render backend,
// so the browser sees same-origin requests (and same-origin cookies) even
// though the API actually lives on a different domain.
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000/api";

// ---------------------------------------------------------
// AUTH CONTEXT
// The session lives in an httpOnly cookie set by the server (see
// /server/auth.js) — the client never sees or manages the token
// directly, it just carries `user` for UI state. Every request must
// go through apiFetch (below) so the cookie is actually sent.
// ---------------------------------------------------------
const AuthContext = React.createContext(null);
function useAuth() {
  return React.useContext(AuthContext);
}

// Thin fetch wrapper used for every API call: always sends the
// session cookie, and JSON-encodes `body` if you pass a plain object
// instead of an already-stringified one.
function apiFetch(path, { body, headers, ...rest } = {}) {
  return fetch(`${API_BASE}${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

// ---------------------------------------------------------
// OFFLINE QUEUE — for the hunter live-tracker (GPS points, spot tags,
// SOS) when there's no signal, which is the whole point of a remote
// property. IndexedDB, not localStorage/memory, because it has to
// survive a tab reload or the app being backgrounded for hours while
// a hunter is out of range. A "network failure" (fetch rejects — no
// connection at all) gets queued for retry; an actual HTTP response
// that isn't ok (e.g. the session already ended) is a real rejection,
// not a connectivity problem, so it's dropped rather than retried
// forever.
// ---------------------------------------------------------
const OFFLINE_QUEUE_DB = "muster-offline-queue";
const OFFLINE_QUEUE_STORE = "items";

function offlineQueueAvailable() {
  return typeof indexedDB !== "undefined";
}

function openOfflineQueueDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_QUEUE_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(OFFLINE_QUEUE_STORE, { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function offlineQueueAll() {
  if (!offlineQueueAvailable()) return [];
  const db = await openOfflineQueueDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(OFFLINE_QUEUE_STORE, "readonly").objectStore(OFFLINE_QUEUE_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Resolves with the item's id (assigned by `put` when new) so a caller
// that might need to cancel a still-queued item later — an SOS the
// hunter wants to retract before it ever leaves the device — has
// something to delete by.
async function offlineQueuePut(item) {
  const db = await openOfflineQueueDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, "readwrite");
    const req = tx.objectStore(OFFLINE_QUEUE_STORE).put(item);
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

async function offlineQueueDelete(id) {
  const db = await openOfflineQueueDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, "readwrite");
    tx.objectStore(OFFLINE_QUEUE_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Points batch harder to keep tidy than a one-off tag/SOS: a hunter out
// of range for hours would otherwise queue one row per 15s flush
// attempt. Instead, merge into a single growing per-session row so
// reconnecting sends one request instead of dozens of tiny ones.
async function offlineQueueAddPoints(sessionId, points) {
  if (!offlineQueueAvailable()) return;
  const existing = (await offlineQueueAll()).find((i) => i.kind === "points" && i.session_id === sessionId);
  if (existing) {
    await offlineQueuePut({ ...existing, points: [...existing.points, ...points] });
  } else {
    await offlineQueuePut({ kind: "points", session_id: sessionId, points, queued_at: Date.now() });
  }
}

async function offlineQueueAddOne(kind, sessionId, body) {
  if (!offlineQueueAvailable()) return null;
  return offlineQueuePut({ kind, session_id: sessionId, body, queued_at: Date.now() });
}

// Attempts every queued item once, in queued order. Stops at the first
// network failure (further items would fail identically — no point
// hammering all of them) but keeps going past a permanent per-item
// rejection so one bad item can't block everything behind it.
// `onFlushed(item, responseBody)` fires for each item that actually
// sent — responseBody matters for 'sos', so the caller can learn the
// real alert id and still let the hunter cancel it after the fact.
async function offlineQueueFlush(onFlushed) {
  if (!offlineQueueAvailable()) return 0;
  const items = await offlineQueueAll();
  for (const item of items) {
    const path =
      item.kind === "points"
        ? `/tracking/${item.session_id}/points`
        : item.kind === "tag"
        ? `/tracking/${item.session_id}/tags`
        : `/tracking/${item.session_id}/sos`;
    const body = item.kind === "points" ? { points: item.points } : item.body;
    let response;
    try {
      response = await apiFetch(path, { method: "POST", body });
    } catch {
      break; // still offline — leave this and everything after it queued
    }
    if (response.ok || response.status < 500) {
      await offlineQueueDelete(item.id);
      if (response.ok && onFlushed) {
        const data = await response.json().catch(() => null);
        onFlushed(item, data);
      }
    }
    // a 5xx leaves the item queued to retry next cycle
  }
  return (await offlineQueueAll()).length;
}

function initialsOf(name) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

function Checkbox({ label, checked, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 16, height: 16, accentColor: C.eucalyptDeep }}
      />
      <span style={{ ...fontBody, fontSize: 13, color: C.charcoal }}>{label}</span>
    </label>
  );
}

const CREDENTIAL_TYPES = [
  { value: "primesafe_field_harvester", label: "PrimeSafe Field Harvester approval" },
  { value: "game_licence", label: "Game Licence" },
  { value: "firearms_licence", label: "Firearms Licence" },
  { value: "vehicle_field_depot", label: "Vehicle — Field Depot licence" },
  { value: "vehicle_mtv", label: "Vehicle — Meat Transport Vehicle licence" },
  { value: "public_liability_insurance", label: "Public Liability Insurance" },
  { value: "suppressor_permit", label: "Suppressor permit (if applicable)" },
];

const WEEKDAYS = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
];
const AVAILABILITY_MODES = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Specific days" },
  { value: "interval", label: "Every N days" },
];
const DAY_LABEL_BY_VALUE = Object.fromEntries(WEEKDAYS.map((d) => [d.value, d.label]));

// Species a farmer can permit on their property are admin-managed data
// (see AdminPanel's "Game species" section and GET /api/species), not a
// hardcoded list — species needing an Authority to Control Wildlife
// permit on file (document link, remaining tag quantity, expiry) are
// flagged per-species via requires_atcw, enforced server-side too.

// Human-readable summary of a hunter's availability pattern — mirrors
// describeAvailability() in server/server.js.
function describeAvailability(h) {
  if (!h) return "";
  if (h.availability_mode === "weekly") {
    const days = (h.availability_days || "").split(",").map((d) => DAY_LABEL_BY_VALUE[d.trim()]).filter(Boolean);
    return days.length ? `Available ${days.join(", ")}` : "Not available";
  }
  if (h.availability_mode === "interval" && h.availability_interval && h.availability_anchor_date) {
    return `Available every ${h.availability_interval} day(s) from ${h.availability_anchor_date}`;
  }
  return "Available daily";
}

// day-of-week check mirroring isHunterAvailable() in server/server.js —
// used to grey out/skip unavailable dates in the booking date picker.
const DOW_ABBREVS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]; // matches Date#getUTCDay() index
function isHunterAvailableOn(h, dateStr) {
  if (!h || h.availability_mode === "daily" || !h.availability_mode) return true;
  if (h.availability_mode === "weekly") {
    const days = (h.availability_days || "").split(",").map((d) => d.trim()).filter(Boolean);
    const dow = DOW_ABBREVS[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
    return days.includes(dow);
  }
  if (h.availability_mode === "interval") {
    if (!h.availability_anchor_date || !h.availability_interval) return true;
    const msPerDay = 24 * 60 * 60 * 1000;
    const anchor = new Date(`${h.availability_anchor_date}T00:00:00Z`).getTime();
    const target = new Date(`${dateStr}T00:00:00Z`).getTime();
    const diffDays = Math.round((target - anchor) / msPerDay);
    return ((diffDays % h.availability_interval) + h.availability_interval) % h.availability_interval === 0;
  }
  return true;
}

function SectionLabel({ children }) {
  return (
    <div style={{ ...fontBody, fontWeight: 600, fontSize: 13, color: C.charcoal, marginBottom: 8 }}>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------
   SIGNATURE ELEMENT: ear-tag style verification badge
--------------------------------------------------------- */
function EarTag({ label, status = "verified", detail }) {
  const cfg = {
    verified: { bg: C.eucalypt, fg: C.white, Icon: ShieldCheck },
    warning: { bg: C.gold, fg: C.white, Icon: ShieldAlert },
    missing: { bg: "transparent", fg: C.rust, Icon: ShieldX, border: C.rust },
  }[status];
  const { Icon } = cfg;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: cfg.bg,
        color: cfg.fg,
        border: cfg.border ? `1.5px dashed ${cfg.border}` : "none",
        borderRadius: "3px 10px 10px 3px",
        padding: "4px 10px 4px 6px",
        position: "relative",
      }}
      title={detail}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: cfg.border ? C.rust : C.white,
          opacity: cfg.border ? 1 : 0.85,
          flexShrink: 0,
        }}
      />
      <Icon size={13} strokeWidth={2.25} />
      <span style={{ ...fontMono, fontSize: 11, letterSpacing: 0.3 }}>
        {label}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------
   SHARED BITS
--------------------------------------------------------- */
function Wordmark() {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ ...fontDisplay, fontSize: 22, fontWeight: 600, color: C.charcoal }}>
        The Muster
      </span>
      <span style={{ ...fontMono, fontSize: 10.5, color: C.steel, letterSpacing: 1 }}>
        VIC · ACCREDITED VERMIN CONTROL
      </span>
    </div>
  );
}

function Divider({ mt = 16, mb = 16 }) {
  return <div style={{ height: 1, background: C.line, marginTop: mt, marginBottom: mb }} />;
}

function Pill({ children, tone = "mist" }) {
  const bg = tone === "mist" ? C.mist : tone === "gold" ? "#F1E3C4" : tone === "rust" ? "#F1DCD6" : C.paperDim;
  const fg = tone === "gold" ? C.goldDeep : tone === "rust" ? C.rust : C.bark;
  return (
    <span
      style={{
        ...fontMono,
        fontSize: 10.5,
        background: bg,
        color: fg,
        padding: "3px 8px",
        borderRadius: 20,
        letterSpacing: 0.3,
      }}
    >
      {children}
    </span>
  );
}

// Shared between HunterBookings and FarmerBookings — a booking's
// property.atcw_expiry_warnings (from GET /api/bookings), so a hunter
// knows before they turn up that the permit covering a species is
// about to lapse, rather than finding out on a manually-posted news item.
function AtcwWarnings({ warnings }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10 }}>
      {warnings.map((w, i) => (
        <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
          <AlertTriangle size={13} color={C.rust} style={{ marginTop: 1, flexShrink: 0 }} />
          <span style={{ ...fontBody, fontSize: 12, color: C.rust }}>
            {w.label} ATCW permit {w.status === "expired" ? "expired" : "expires"} {w.expiry_date} — confirm
            before the visit.
          </span>
        </div>
      ))}
    </div>
  );
}

// Shared between HunterBookings and FarmerBookings — shows nothing
// until the booking actually opted into geofencing; once a tracking
// session exists, shows whether check-in/out actually happened within
// the property's radius. Never implies enforcement (it isn't one) —
// just visibility, per the "flag, don't block" decision.
function GeofenceStatus({ booking }) {
  if (!booking.geofence_required) return null;
  const session = booking.tracking_session;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
      <MapPin size={12} color={C.steel} style={{ flexShrink: 0 }} />
      <span style={{ ...fontMono, fontSize: 10, color: C.steel }}>
        GEOFENCED
        {session && session.checkin_in_geofence != null && (
          <span style={{ color: session.checkin_in_geofence ? C.eucalyptDeep : C.rust }}>
            {" "}
            · check-in {session.checkin_in_geofence ? "on-site" : "OFF-SITE"}
          </span>
        )}
        {session && session.ended_at && session.checkout_in_geofence != null && (
          <span style={{ color: session.checkout_in_geofence ? C.eucalyptDeep : C.rust }}>
            {" "}
            · check-out {session.checkout_in_geofence ? "on-site" : "OFF-SITE"}
          </span>
        )}
      </span>
    </div>
  );
}

function Avatar({ initials, size = 44 }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: C.eucalyptDeep,
        color: C.white,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...fontDisplay,
        fontWeight: 600,
        fontSize: size * 0.36,
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}

function PrimaryButton({ children, icon: Icon, onClick, full }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        background: C.eucalyptDeep,
        color: C.white,
        border: "none",
        borderRadius: 8,
        padding: "10px 16px",
        ...fontBody,
        fontWeight: 600,
        fontSize: 13.5,
        cursor: "pointer",
        width: full ? "100%" : "auto",
      }}
    >
      {Icon && <Icon size={15} />}
      {children}
    </button>
  );
}

function GhostButton({ children, icon: Icon, onClick, full, tone }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        background: "transparent",
        color: tone === "rust" ? C.rust : C.charcoal,
        border: `1.5px solid ${tone === "rust" ? C.rust : C.line}`,
        borderRadius: 8,
        padding: "9px 16px",
        ...fontBody,
        fontWeight: 600,
        fontSize: 13.5,
        cursor: "pointer",
        width: full ? "100%" : "auto",
      }}
    >
      {Icon && <Icon size={15} />}
      {children}
    </button>
  );
}

// Read-only star rating, e.g. a review's score on a hunter's profile.
function StarRow({ rating, size = 12 }) {
  return (
    <div style={{ display: "flex", gap: 1 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          fill={n <= rating ? C.gold : "none"}
          color={C.gold}
          strokeWidth={1.5}
        />
      ))}
    </div>
  );
}

// Clickable star rating, for the "leave a review" form.
function StarRatingInput({ value, onChange, size = 18 }) {
  return (
    <div style={{ display: "flex", gap: 3 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          style={{ background: "none", border: "none", padding: 2, cursor: "pointer" }}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
        >
          <Star size={size} fill={n <= value ? C.gold : "none"} color={C.gold} strokeWidth={1.75} />
        </button>
      ))}
    </div>
  );
}

function CapabilityIcon({ Icon, active, label }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        opacity: active ? 1 : 0.32,
      }}
      title={label}
    >
      <Icon size={15} color={active ? C.eucalyptDeep : C.steel} strokeWidth={2} />
      <span style={{ ...fontMono, fontSize: 10.5, color: active ? C.charcoal : C.steel }}>
        {label}
      </span>
    </div>
  );
}

// Simple average-of-vertices centroid of a GeoJSON [lng, lat] ring —
// good enough to centre a map on a paddock-scale parcel, not a true
// area-weighted polygon centroid.
function ringCentroid(ring) {
  if (!ring || ring.length === 0) return null;
  const pts =
    ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1) // drop the closing duplicate point
      : ring;
  const sum = pts.reduce((acc, [lng, lat]) => ({ lng: acc.lng + lng, lat: acc.lat + lat }), { lng: 0, lat: 0 });
  return { lat: sum.lat / pts.length, lng: sum.lng / pts.length };
}

/* ---------------------------------------------------------
   PROPERTY MAP — an embedded Google Map. Centred on the real
   cadastral parcel (from VicPlan, matched by lot/plan when on
   file) when that lookup succeeds; falls back to the property's
   saved coordinates otherwise.
   Uses the key-less Google Maps embed (maps.google.com/maps
   ?...&output=embed) so it works with no API key/billing
   setup — swap to the Maps JavaScript API + a real key later
   if you want the parcel boundary and sighting pins drawn
   directly on the map instead of listed as text below it.
--------------------------------------------------------- */
function PropertyMap({ property, onSightingAdded }) {
  const [parcel, setParcel] = useState(null);
  const [loadingParcel, setLoadingParcel] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [species, setSpecies] = useState(SPECIES_OPTIONS[0]);
  const [estimatedCount, setEstimatedCount] = useState("1");
  const [damageNotes, setDamageNotes] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [submittingSighting, setSubmittingSighting] = useState(false);
  const [sightingError, setSightingError] = useState(null);
  const [dispatchNotice, setDispatchNotice] = useState(null);

  function submitSighting() {
    setSubmittingSighting(true);
    setSightingError(null);
    apiFetch("/sightings", {
      method: "POST",
      body: {
        property_id: property.id,
        species,
        estimated_count: parseInt(estimatedCount, 10) || null,
        damage_notes: damageNotes || null,
        urgent,
      },
    })
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then((sighting) => {
        onSightingAdded(sighting);
        setReportOpen(false);
        setDamageNotes("");
        setUrgent(false);
        setEstimatedCount("1");
        setDispatchNotice(sighting.urgent ? sighting.dispatched_hunter_count : null);
      })
      .catch((e) => setSightingError(e.message))
      .finally(() => setSubmittingSighting(false));
  }

  React.useEffect(() => {
    if (!property?.id) return;
    setLoadingParcel(true);
    apiFetch(`/properties/${property.id}/parcel`)
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then((data) => setParcel(data))
      .catch(() => {}) // no lot/plan match is a normal, expected outcome — just skip the SPI caption
      .finally(() => setLoadingParcel(false));
  }, [property?.id]);

  // Only re-centre on the parcel when it was actually matched by lot/plan —
  // a plain coordinate lookup returns a ring too, but centring on that just
  // reproduces the pin we already have, not anything lot/plan-derived.
  const parcelCenter =
    parcel?.matched_by === "lot_plan" && parcel?.ring ? ringCentroid(parcel.ring) : null;
  const mapLat = parcelCenter?.lat ?? property?.latitude;
  const mapLng = parcelCenter?.lng ?? property?.longitude;
  const hasCoords = mapLat != null && mapLng != null;

  return (
    <div
      style={{
        background: C.white,
        border: `1px solid ${C.line}`,
        borderRadius: 12,
        padding: 14,
        marginBottom: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ ...fontBody, fontWeight: 600, fontSize: 13, color: C.charcoal }}>
          Property map
          {parcelCenter && (
            <span style={{ ...fontMono, fontSize: 9.5, color: C.eucalyptDeep }}> · ON PARCEL (LOT/PLAN)</span>
          )}
        </div>
        <span style={{ ...fontMono, fontSize: 10.5, color: C.steel }}>
          {property?.size_hectares ?? "—"} ha · PIC {property?.pic_code ?? "—"}
        </span>
      </div>

      {hasCoords ? (
        <div style={{ borderRadius: 8, overflow: "hidden", border: `1px solid ${C.line}` }}>
          <iframe
            title="Property location"
            src={`https://maps.google.com/maps?q=${mapLat},${mapLng}&z=${parcelCenter ? 16 : 15}&t=h&output=embed`}
            width="100%"
            height="240"
            style={{ border: 0, display: "block" }}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      ) : (
        <div style={{ ...fontBody, fontSize: 12, color: C.steel, fontStyle: "italic" }}>
          No coordinates on file for this property.
        </div>
      )}

      {loadingParcel && (
        <div style={{ ...fontMono, fontSize: 10.5, color: C.steel, marginTop: 6 }}>
          Looking up cadastral parcel details (VicPlan)…
        </div>
      )}
      {parcel?.spi && (
        <div style={{ ...fontMono, fontSize: 10, color: C.steel, marginTop: 6 }}>
          SPI {parcel.spi}
          {parcel.lot_number ? ` · Lot ${parcel.lot_number}` : ""}
          {parcel.plan_number ? ` on ${parcel.plan_number}` : ""}
        </div>
      )}

      {hasCoords && (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${mapLat},${mapLng}`}
          target="_blank"
          rel="noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            marginTop: 10,
            ...fontMono,
            fontSize: 10.5,
            color: C.eucalyptDeep,
            textDecoration: "none",
          }}
        >
          <MapPin size={11} /> OPEN IN GOOGLE MAPS (FULL VIEW) →
        </a>
      )}

      {property?.species?.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ ...fontMono, fontSize: 10, color: C.eucalyptDeep, marginBottom: 4 }}>SPECIES PERMITTED</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {property.species.map((s) => {
              const label = s.is_other ? s.other_description || "Other" : s.label;
              const isAtcw = !!s.requires_atcw;
              const expired = s.atcw_expiry_status === "expired";
              const expiringSoon = s.atcw_expiry_status === "expiring_soon";
              return (
                <Pill key={s.id} tone={expired ? "rust" : isAtcw ? "gold" : "mist"}>
                  {(expired || expiringSoon) && (
                    <AlertTriangle size={10} style={{ verticalAlign: -1, marginRight: 3 }} />
                  )}
                  {label}
                  {isAtcw ? ` · ${s.atcw_remaining_quantity ?? "?"} left · exp ${s.atcw_expiry_date || "?"}` : ""}
                  {expired ? " · EXPIRED" : expiringSoon ? " · expiring soon" : ""}
                </Pill>
              );
            })}
          </div>
        </div>
      )}

      {property?.no_go_zones?.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ ...fontMono, fontSize: 10, color: C.rust, marginBottom: 4 }}>NO-GO ZONES ON FILE</div>
          {property.no_go_zones.map((z) => (
            <div key={z.id} style={{ ...fontBody, fontSize: 12, color: C.bark, marginBottom: 2 }}>
              • {z.label}{z.description ? ` — ${z.description}` : ""}
            </div>
          ))}
        </div>
      )}

      {property?.sightings?.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ ...fontMono, fontSize: 10, color: C.goldDeep, marginBottom: 4 }}>RECENT SIGHTINGS</div>
          {property.sightings.slice(0, 3).map((s) => (
            <div key={s.id} style={{ ...fontBody, fontSize: 12, color: C.bark, marginBottom: 2 }}>
              • {s.species || "Unspecified"}{s.estimated_count ? ` × ${s.estimated_count}` : ""}
              {s.urgent ? " — URGENT" : ""}{s.damage_notes ? ` (${s.damage_notes})` : ""}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px dashed ${C.line}` }}>
        {reportOpen ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div>
              <div style={{ ...fontMono, fontSize: 10.5, color: C.steel, marginBottom: 4 }}>SPECIES</div>
              <select
                value={species}
                onChange={(e) => setSpecies(e.target.value)}
                style={{
                  border: `1.5px solid ${C.line}`,
                  borderRadius: 8,
                  padding: "9px 12px",
                  ...fontBody,
                  fontSize: 13,
                  color: C.charcoal,
                  background: C.white,
                  width: "100%",
                }}
              >
                {SPECIES_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <TextField
              label="ESTIMATED COUNT"
              value={estimatedCount}
              onChange={setEstimatedCount}
              type="number"
            />
            <TextField
              label="DAMAGE NOTES (OPTIONAL)"
              value={damageNotes}
              onChange={setDamageNotes}
              placeholder="Fence damage along the eastern boundary"
              multiline
            />
            <Checkbox label="Urgent — needs attention soon" checked={urgent} onChange={setUrgent} />
            {sightingError && (
              <div style={{ ...fontBody, fontSize: 12, color: C.rust }}>{sightingError}</div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <PrimaryButton icon={AlertTriangle} onClick={submitSighting}>
                {submittingSighting ? "Saving…" : "Save sighting"}
              </PrimaryButton>
              <GhostButton onClick={() => setReportOpen(false)}>Cancel</GhostButton>
            </div>
          </div>
        ) : (
          <>
            {dispatchNotice != null && (
              <div style={{ ...fontBody, fontSize: 12, color: C.eucalyptDeep, marginBottom: 8 }}>
                {dispatchNotice > 0
                  ? `Urgent sighting saved — ${dispatchNotice} hunter${dispatchNotice === 1 ? "" : "s"} nearby notified.`
                  : "Urgent sighting saved — no available hunters within range to notify."}
              </div>
            )}
            <GhostButton
              icon={AlertTriangle}
              full
              onClick={() => {
                setDispatchNotice(null);
                setReportOpen(true);
              }}
            >
              Report a sighting
            </GhostButton>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   REGIONAL PRESSURE — pest sightings aggregated across *other*
   properties within range, so a farmer can see district-wide
   activity before it's their own problem. Counts only, never which
   property/farmer reported what.
--------------------------------------------------------- */
function RegionalPressure({ propertyId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  React.useEffect(() => {
    if (!propertyId) return;
    apiFetch(`/properties/${propertyId}/regional-pressure`)
      .then((r) => {
        if (!r.ok) throw new Error("Could not load regional pest data");
        return r.json();
      })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [propertyId]);

  if (error || !data) return null;

  return (
    <div
      style={{
        background: C.white,
        border: `1px solid ${C.line}`,
        borderRadius: 12,
        padding: 14,
        marginBottom: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ ...fontBody, fontWeight: 600, fontSize: 13, color: C.charcoal }}>Regional pest pressure</div>
        <span style={{ ...fontMono, fontSize: 10, color: C.steel }}>
          {data.property_count} propert{data.property_count === 1 ? "y" : "ies"} within {data.radius_km}km · last{" "}
          {data.window_days}d
        </span>
      </div>

      {data.property_count === 0 && (
        <div style={{ ...fontBody, fontSize: 12.5, color: C.steel, fontStyle: "italic" }}>
          No other properties within {data.radius_km}km yet — this fills in as more farmers nearby join.
        </div>
      )}
      {data.property_count > 0 && data.species.length === 0 && (
        <div style={{ ...fontBody, fontSize: 12.5, color: C.steel }}>
          No sightings reported nearby in the last {data.window_days} days.
        </div>
      )}
      {data.species.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.species.map((s) => (
            <div key={s.species} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ ...fontBody, fontSize: 12.5, color: C.charcoal }}>
                {s.species}
                {s.urgent_count > 0 && (
                  <span style={{ ...fontMono, fontSize: 10, color: C.rust }}> · {s.urgent_count} urgent</span>
                )}
              </span>
              <span style={{ ...fontMono, fontSize: 10.5, color: C.steel }}>
                {s.sighting_count} sighting{s.sighting_count === 1 ? "" : "s"} · {s.reporting_property_count}{" "}
                propert{s.reporting_property_count === 1 ? "y" : "ies"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   SCREEN 0 — LANDING (guest marketing page)
--------------------------------------------------------- */
function DeerGlyph({ size = 32, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <ellipse cx="19" cy="30" rx="11" ry="7" fill={color} />
      <circle cx="35" cy="17" r="6" fill={color} />
      <path d="M26 24 Q31 20 33 12" stroke={color} strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M32 12 L29 4 M29 4 L26 2 M29 4 L27 6.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M38 12 L41 4 M41 4 L44 2 M41 4 L43 6.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M11 36 L9 45 M16 37 L15 45 M22 37 L23 45 M28 35 L31 44" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <ellipse cx="9" cy="28" rx="2" ry="1.4" fill={color} />
    </svg>
  );
}
function FoxGlyph({ size = 32, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <path d="M10 32 Q2 27 5 17" stroke={color} strokeWidth="6" strokeLinecap="round" fill="none" />
      <ellipse cx="21" cy="31" rx="12" ry="6.5" fill={color} />
      <circle cx="36" cy="23" r="6.5" fill={color} />
      <path d="M32 18 L29 9 L36 16 Z" fill={color} />
      <path d="M40 18 L44 9 L38 16 Z" fill={color} />
      <ellipse cx="42.5" cy="25" rx="2.6" ry="1.8" fill={color} />
      <path d="M13 36 L11 45 M19 37 L18 45 M25 37 L26 45 M30 35 L33 44" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
function RabbitGlyph({ size = 32, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <ellipse cx="24" cy="33" rx="11" ry="8" fill={color} />
      <circle cx="24" cy="18" r="7" fill={color} />
      <ellipse cx="20" cy="7" rx="2.1" ry="7.5" fill={color} />
      <ellipse cx="28" cy="7" rx="2.1" ry="7.5" fill={color} />
      <circle cx="34" cy="35" r="2.4" fill={color} />
      <path d="M17 41 L16 46 M31 41 L32 46" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
function HareGlyph({ size = 32, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <ellipse cx="22" cy="31" rx="10" ry="6" fill={color} />
      <circle cx="35" cy="21" r="6" fill={color} />
      <ellipse cx="31" cy="9" rx="1.9" ry="8" fill={color} transform="rotate(-18 31 9)" />
      <ellipse cx="37" cy="10" rx="1.9" ry="8" fill={color} transform="rotate(10 37 10)" />
      <path d="M10 35 L4 42 M17 38 L14 46 M27 37 L28 45 M33 34 L38 42" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
function KangarooGlyph({ size = 32, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <path d="M18 40 Q10 44 12 34" stroke={color} strokeWidth="5" strokeLinecap="round" fill="none" />
      <ellipse cx="22" cy="27" rx="8" ry="12" fill={color} />
      <circle cx="26" cy="11" r="5.5" fill={color} />
      <path d="M24 7 L22 2" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M17 24 L11 27" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <path d="M25 36 L31 41 L28 46" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M18 37 L14 43 L18 46" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
function WombatGlyph({ size = 32, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <ellipse cx="26" cy="27" rx="15" ry="9.5" fill={color} />
      <ellipse cx="11" cy="23" rx="6" ry="5.5" fill={color} />
      <circle cx="8" cy="17" r="1.6" fill={color} />
      <circle cx="14" cy="17" r="1.6" fill={color} />
      <path d="M15 36 L14 42 M23 37 L23 43 M31 37 L32 43 M38 35 L40 41" stroke={color} strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}
function WildDogGlyph({ size = 32, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <ellipse cx="21" cy="30" rx="12" ry="6.5" fill={color} />
      <circle cx="37" cy="21" r="6" fill={color} />
      <path d="M33 17 L31 9 L36 15 Z" fill={color} />
      <path d="M40 17 L43 9 L38 15 Z" fill={color} />
      <ellipse cx="43.5" cy="23" rx="2.4" ry="1.6" fill={color} />
      <path d="M10 33 Q4 36 4 30" stroke={color} strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M12 36 L10 45 M18 37 L17 45 M25 37 L26 45 M31 35 L34 44" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const GAME_SPECIES_GRAPHICS = [
  { label: "Deer", Icon: DeerGlyph },
  { label: "Fox", Icon: FoxGlyph },
  { label: "Rabbit", Icon: RabbitGlyph },
  { label: "Hare", Icon: HareGlyph },
  { label: "Wild Dog", Icon: WildDogGlyph },
  { label: "Kangaroo", Icon: KangarooGlyph },
  { label: "Wombat", Icon: WombatGlyph },
];

function AnimalBadge({ label, Icon }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, width: 68 }}>
      <div
        style={{
          width: 54,
          height: 54,
          borderRadius: "50%",
          background: C.mist,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={32} color={C.eucalyptDeep} />
      </div>
      <span style={{ ...fontMono, fontSize: 10, color: C.bark, letterSpacing: 0.3, textAlign: "center" }}>
        {label}
      </span>
    </div>
  );
}

function PerspectiveList({ title, Icon, accent, items }) {
  return (
    <div style={{ flex: 1, background: C.white, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: accent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon size={16} color={C.white} />
        </div>
        <span style={{ ...fontDisplay, fontSize: 17, fontWeight: 600, color: C.charcoal }}>{title}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((line, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <Check size={14} color={accent} style={{ marginTop: 2, flexShrink: 0 }} />
            <span style={{ ...fontBody, fontSize: 12.5, color: C.bark, lineHeight: 1.5 }}>{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LandingPage({ goLogin, goFarmerSignup, goHunterSignup }) {
  return (
    <div>
      <div style={{ textAlign: "center", padding: "6px 4px 26px" }}>
        <div style={{ ...fontMono, fontSize: 10.5, color: C.goldDeep, letterSpacing: 1.6, marginBottom: 10 }}>
          VIC · ACCREDITED VERMIN CONTROL
        </div>
        <h1
          style={{
            ...fontDisplay,
            fontSize: 28,
            fontWeight: 600,
            color: C.charcoal,
            margin: "0 0 12px",
            lineHeight: 1.2,
          }}
        >
          Connecting farmers with licensed hunters
        </h1>
        <p style={{ ...fontBody, fontSize: 13.5, color: C.steel, lineHeight: 1.6, maxWidth: 440, margin: "0 auto" }}>
          The Muster matches Victorian landholders carrying deer, fox, rabbit and other pest pressure with
          vetted, accredited hunters ready to help control it — safely, on your terms.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 22 }}>
          <PrimaryButton icon={LogIn} onClick={goLogin}>Log in</PrimaryButton>
          <GhostButton icon={Home} onClick={goFarmerSignup}>List a property</GhostButton>
          <GhostButton icon={UserCheck} onClick={goHunterSignup}>Become a hunter</GhostButton>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 16,
          flexWrap: "wrap",
          padding: "20px 8px",
          borderTop: `1px solid ${C.line}`,
          borderBottom: `1px solid ${C.line}`,
          marginBottom: 26,
        }}
      >
        {GAME_SPECIES_GRAPHICS.map((s) => (
          <AnimalBadge key={s.label} label={s.label} Icon={s.Icon} />
        ))}
      </div>

      <div className="muster-two-col" style={{ marginBottom: 22 }}>
        <PerspectiveList
          title="For farmers"
          Icon={Home}
          accent={C.eucalyptDeep}
          items={[
            "List your property, define access rules, no-go zones and permitted hunting hours.",
            "Choose which species you'll allow — deer, fox, rabbit, hare, wild dog, kangaroo and wombat, with ATCW permits tracked for you.",
            "Browse hunters matched by distance, with verified credentials shown up front.",
            "Approve or decline booking requests and message hunters directly.",
            "See harvest declarations and leave a review after each visit.",
            "Track regional pest pressure from sightings reported nearby.",
          ]}
        />
        <PerspectiveList
          title="For hunters"
          Icon={UserCheck}
          accent={C.goldDeep}
          items={[
            "Submit your licences and insurance once — verified by an admin, shown as ear-tag badges.",
            "Get matched to properties nearest you that allow the species you hunt.",
            "Set your own availability — daily, specific days, or every N days.",
            "Request bookings and message farmers about access details.",
            "Log harvest declarations and build a public rating from farmer reviews.",
            "Stay across news and regional updates relevant to hunters.",
          ]}
        />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   SCREEN 1 — FARMER DASHBOARD (matched hunters for a property)
--------------------------------------------------------- */
function FarmerDashboard({ goRefer, goProfile, goListProperty, goEditProperty }) {
  const { user } = useAuth();
  const [property, setProperty] = useState(null);
  const [hunters, setHunters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const myProperty = user?.properties?.[0];

  React.useEffect(() => {
    if (!myProperty) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      apiFetch(`/properties/${myProperty.id}`).then((r) => {
        if (!r.ok) throw new Error("Could not load property");
        return r.json();
      }),
      apiFetch(`/properties/${myProperty.id}/matches`).then((r) => {
        if (!r.ok) throw new Error("Could not load matches");
        return r.json();
      }),
    ])
      .then(([propertyData, matchData]) => {
        setProperty(propertyData);
        setHunters(matchData);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [myProperty?.id]);

  if (!user) {
    return (
      <div style={{ ...fontBody, fontSize: 13, color: C.steel }}>
        Log in as a farmer to see your dashboard.
      </div>
    );
  }
  if (user.role !== "farmer") {
    return (
      <div style={{ ...fontBody, fontSize: 13, color: C.steel }}>
        This dashboard is for farmer accounts. You're logged in as a hunter.
      </div>
    );
  }
  if (!myProperty) {
    return (
      <div>
        <div style={{ ...fontBody, fontSize: 13, color: C.steel, marginBottom: 12 }}>
          You haven't listed a property yet.
        </div>
        <GhostButton full onClick={goListProperty}>List your first property</GhostButton>
      </div>
    );
  }
  if (loading) {
    return <div style={{ ...fontMono, fontSize: 12, color: C.steel }}>Loading property…</div>;
  }
  if (error) {
    return (
      <div style={{ ...fontBody, fontSize: 13, color: C.rust }}>
        {error}. Is the backend running? (`npm start` in /server, on port 4000)
      </div>
    );
  }

  const urgentCount = property.sightings.filter((s) => s.urgent).length;

  return (
    <div>
      <EnableAlertsBanner />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ ...fontMono, fontSize: 11, color: C.steel, letterSpacing: 0.5, marginBottom: 4 }}>
            PROPERTY · PIC {property.pic_code}
            {property.lot_number && property.plan_number
              ? ` · LOT ${property.lot_number} ON ${property.plan_number}`
              : ""}
          </div>
          <div style={{ ...fontDisplay, fontSize: 26, color: C.charcoal }}>
            {property.name}, {property.suburb}
          </div>
          <button
            onClick={goEditProperty}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              marginTop: 4,
              ...fontMono,
              fontSize: 10.5,
              color: C.eucalyptDeep,
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            Edit property details
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <Pill tone="gold">
            {property.sightings.length} sighting{property.sightings.length === 1 ? "" : "s"} logged
            {urgentCount > 0 ? ` · ${urgentCount} urgent` : ""}
          </Pill>
          <EarTag
            label={
              property.verification_status === "verified"
                ? "OWNERSHIP VERIFIED"
                : property.verification_status === "rejected"
                ? "OWNERSHIP REJECTED"
                : "OWNERSHIP PENDING"
            }
            status={
              property.verification_status === "verified"
                ? "verified"
                : property.verification_status === "rejected"
                ? "missing"
                : "warning"
            }
          />
        </div>
      </div>

      <Divider mt={14} mb={14} />

      <PropertyMap
        property={property}
        onSightingAdded={(sighting) =>
          setProperty((prev) => ({ ...prev, sightings: [sighting, ...prev.sightings] }))
        }
      />

      <RegionalPressure propertyId={property.id} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ ...fontBody, fontWeight: 600, fontSize: 14, color: C.charcoal }}>
          Matched harvesters, nearest first
        </div>
        <div style={{ ...fontMono, fontSize: 11, color: C.steel }}>SORT: DISTANCE</div>
      </div>

      <div className="muster-hunter-list">
        {hunters.length === 0 && (
          <div style={{ ...fontBody, fontSize: 12.5, color: C.steel }}>
            No verified hunters nearby yet.
          </div>
        )}
        {hunters.map((h) => (
          <div
            key={h.id}
            onClick={() => goProfile(h.id, h.name)}
            style={{
              background: C.white,
              border: `1px solid ${C.line}`,
              borderRadius: 12,
              padding: 14,
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", gap: 12 }}>
              <Avatar initials={initialsOf(h.name)} />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div style={{ ...fontBody, fontWeight: 700, fontSize: 15, color: C.charcoal }}>
                    {h.name}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <Star size={13} fill={C.gold} color={C.gold} />
                    <span style={{ ...fontMono, fontSize: 12, color: C.charcoal }}>
                      {h.rating_avg}
                    </span>
                    <span style={{ ...fontMono, fontSize: 11, color: C.steel }}>
                      ({h.rating_count})
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
                  <MapPin size={12} color={C.steel} />
                  <span style={{ ...fontMono, fontSize: 11.5, color: C.steel }}>
                    {h.distance_km} km away
                  </span>
                </div>
                <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
                  <CapabilityIcon Icon={Thermometer} active={h.thermal_capable} label="THERMAL" />
                  <CapabilityIcon Icon={VolumeX} active={h.suppressed_capable} label="SUPPRESSED" />
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
              {h.credential_tags.map((t, j) => (
                <Pill key={j} tone={t.status === "warning" ? "gold" : "mist"}>
                  {t.label} {t.status === "verified" ? "✓" : t.status === "warning" ? "⚠" : "✕"}
                </Pill>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Divider />

      <GhostButton icon={UserPlus} full onClick={goRefer}>
        Refer a hunter to a neighbouring property
      </GhostButton>
    </div>
  );
}

/* ---------------------------------------------------------
   SCREEN 2 — HUNTER PROFILE
--------------------------------------------------------- */
const CREDENTIAL_LABELS = {
  primesafe_field_harvester: "PRIMESAFE FIELD HARVESTER",
  game_licence: "GAME LICENCE",
  firearms_licence: "FIREARMS LICENCE",
  vehicle_field_depot: "VEHICLE — FIELD DEPOT",
  vehicle_mtv: "VEHICLE — MTV",
  public_liability_insurance: "PUBLIC LIABILITY",
  suppressor_permit: "SUPPRESSOR PERMIT",
};

function HunterProfile({ hunterId, goBooking, goBack }) {
  const { user } = useAuth();
  const [hunter, setHunter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const nearPropertyId = user?.role === "farmer" ? user?.properties?.[0]?.id : null;

  React.useEffect(() => {
    if (!hunterId) return;
    setLoading(true);
    const qs = nearPropertyId ? `?near_property_id=${nearPropertyId}` : "";
    apiFetch(`/hunters/${hunterId}${qs}`)
      .then((r) => {
        if (!r.ok) throw new Error("Could not load hunter");
        return r.json();
      })
      .then((data) => {
        setHunter(data);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [hunterId, nearPropertyId]);

  const BackLink = () => (
    <button
      onClick={goBack}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        background: "none",
        border: "none",
        color: C.steel,
        ...fontMono,
        fontSize: 11.5,
        cursor: "pointer",
        padding: 0,
        marginBottom: 14,
      }}
    >
      <ChevronLeft size={13} /> BACK TO MATCHES
    </button>
  );

  if (!hunterId) {
    return (
      <div>
        <BackLink />
        <div style={{ ...fontBody, fontSize: 13, color: C.steel }}>
          Pick a hunter from the Farmer dashboard tab first.
        </div>
      </div>
    );
  }
  if (loading) {
    return (
      <div>
        <BackLink />
        <div style={{ ...fontMono, fontSize: 12, color: C.steel }}>Loading profile…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <BackLink />
        <div style={{ ...fontBody, fontSize: 13, color: C.rust }}>{error}</div>
      </div>
    );
  }

  return (
    <div>
      <BackLink />

      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <Avatar initials={initialsOf(hunter.name)} size={58} />
        <div>
          <div style={{ ...fontDisplay, fontSize: 24, color: C.charcoal }}>{hunter.name}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
            <Star size={13} fill={C.gold} color={C.gold} />
            <span style={{ ...fontMono, fontSize: 12 }}>
              {hunter.rating_avg} · {hunter.rating_count} reviews
            </span>
          </div>
        </div>
      </div>

      {hunter.bio && (
        <div
          style={{
            ...fontBody,
            fontSize: 13.5,
            color: C.bark,
            lineHeight: 1.5,
            marginTop: 14,
            fontStyle: "italic",
          }}
        >
          "{hunter.bio}"
        </div>
      )}

      <Divider />

      <div style={{ ...fontBody, fontWeight: 600, fontSize: 13, color: C.charcoal, marginBottom: 10 }}>
        Verified credentials
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {hunter.credentials.map((c) => {
          const expiring =
            c.status === "warning" &&
            c.expiry_date &&
            `expires ${c.expiry_date}`;
          return (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <EarTag
                label={CREDENTIAL_LABELS[c.credential_type] || c.credential_type}
                status={c.status === "expired" || c.status === "rejected" ? "missing" : c.status === "pending" ? "warning" : c.status}
              />
              <span style={{ ...fontMono, fontSize: 10.5, color: expiring ? C.gold : C.steel }}>
                {expiring || `#${c.reference_number}`}
              </span>
            </div>
          );
        })}
      </div>

      <Divider />

      <div style={{ ...fontBody, fontWeight: 600, fontSize: 13, color: C.charcoal, marginBottom: 10 }}>
        Field capability
      </div>
      <div style={{ display: "flex", gap: 20 }}>
        <CapabilityIcon Icon={Thermometer} active={hunter.thermal_capable} label="FULL THERMAL" />
        <CapabilityIcon Icon={VolumeX} active={hunter.suppressed_capable} label="SUPPRESSED" />
        <CapabilityIcon Icon={Truck} active={true} label="OWN TRANSPORT" />
      </div>

      <Divider />

      <div style={{ ...fontBody, fontWeight: 600, fontSize: 13, color: C.charcoal, marginBottom: 8 }}>
        From neighbouring properties
      </div>
      <div
        style={{
          background: C.paperDim,
          borderRadius: 10,
          padding: 12,
          ...fontBody,
          fontSize: 12.5,
          color: C.bark,
        }}
      >
        {hunter.referral_count > 0
          ? `Referred by ${hunter.referral_count} farmer${hunter.referral_count === 1 ? "" : "s"} nearby.`
          : "No referrals from neighbouring farmers yet."}
        {hunter.nearby_host_count != null && (
          <div style={{ marginTop: hunter.referral_count > 0 ? 6 : 0 }}>
            {hunter.nearby_host_count > 0
              ? `Hosted by ${hunter.nearby_host_count} farmer${hunter.nearby_host_count === 1 ? "" : "s"} within ${hunter.nearby_radius_km}km of you.`
              : `No farmers within ${hunter.nearby_radius_km}km of you have hosted them yet.`}
          </div>
        )}
      </div>

      <Divider />

      <div style={{ ...fontBody, fontWeight: 600, fontSize: 13, color: C.charcoal, marginBottom: 8 }}>
        Recent reviews
      </div>
      {hunter.reviews.length === 0 ? (
        <div style={{ ...fontBody, fontSize: 12.5, color: C.steel }}>
          No reviews yet — farmers can leave one after a completed booking.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {hunter.reviews.map((r) => (
            <div key={r.id} style={{ background: C.paperDim, borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Avatar initials={initialsOf(r.farmer_name)} size={24} />
                  <span style={{ ...fontBody, fontWeight: 600, fontSize: 12, color: C.charcoal }}>
                    {r.farmer_name}
                  </span>
                </div>
                <span style={{ ...fontMono, fontSize: 10, color: C.steel }}>
                  {new Date(r.created_at).toLocaleDateString("en-AU")}
                </span>
              </div>
              <div style={{ marginTop: 6 }}>
                <StarRow rating={r.rating} />
              </div>
              {r.comment && (
                <div style={{ ...fontBody, fontSize: 12.5, color: C.bark, marginTop: 6 }}>{r.comment}</div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <PrimaryButton icon={Calendar} full onClick={goBooking}>
          Request a booking
        </PrimaryButton>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   SCREEN 3 — BOOKING REQUEST + AUTO-GENERATED TAG
--------------------------------------------------------- */
function formatShortDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric" });
}

// Plain local-calendar-date arithmetic (no UTC conversion) so the
// window is "today" in the browser's own timezone, not shifted by a
// day depending on where the server/browser happens to be.
function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function nextDates(count) {
  const start = new Date();
  return Array.from({ length: count }, (_, i) =>
    toDateStr(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  );
}

function BookingRequest({ hunterId, hunterName, goBack, goMessages }) {
  const { user } = useAuth();
  const myProperty = user?.properties?.[0];
  const dateOptions = nextDates(21);
  const [selectedDate, setSelectedDate] = useState(dateOptions[0]);
  const [hunter, setHunter] = useState(null);
  const [booking, setBooking] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [geofenceRequired, setGeofenceRequired] = useState(false);

  React.useEffect(() => {
    if (!hunterId) return;
    apiFetch(`/hunters/${hunterId}`)
      .then((r) => r.json())
      .then(setHunter)
      .catch(() => {});
  }, [hunterId]);

  // Once we know the hunter's availability, jump off an unavailable
  // default onto the first date they'll actually take.
  React.useEffect(() => {
    if (!hunter || isHunterAvailableOn(hunter, selectedDate)) return;
    const firstAvailable = dateOptions.find((d) => isHunterAvailableOn(hunter, d));
    if (firstAvailable) setSelectedDate(firstAvailable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hunter]);

  function submitBooking() {
    setSubmitting(true);
    apiFetch("/bookings", {
      method: "POST",
      body: {
        property_id: myProperty.id,
        hunter_id: hunterId,
        requested_date: selectedDate,
        start_time: "05:30",
        end_time: "09:00",
        farmer_note: "Livestock in the north paddock this week",
        geofence_required: geofenceRequired,
      },
    })
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then((created) => apiFetch(`/bookings/${created.id}`).then((r) => r.json()))
      .then((full) => {
        setBooking(full);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSubmitting(false));
  }

  if (!user || user.role !== "farmer") {
    return (
      <div style={{ ...fontBody, fontSize: 13, color: C.steel }}>
        Log in as a farmer to request a booking.
      </div>
    );
  }
  if (!myProperty) {
    return (
      <div style={{ ...fontBody, fontSize: 13, color: C.steel }}>
        List a property first, then you can request bookings.
      </div>
    );
  }
  if (!hunterId) {
    return (
      <div style={{ ...fontBody, fontSize: 13, color: C.steel }}>
        Pick a hunter from the Farmer dashboard tab, then request a booking from their profile.
      </div>
    );
  }

  if (booking) {
    const d = booking.declaration_prefill;
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.eucalyptDeep }}>
          <Check size={18} />
          <span style={{ ...fontBody, fontWeight: 700, fontSize: 15 }}>Booking requested</span>
        </div>
        <div style={{ ...fontBody, fontSize: 13, color: C.bark, marginTop: 6 }}>
          {hunterName} will access {d.property_name} on {formatShortDate(booking.requested_date)},{" "}
          {booking.start_time}–{booking.end_time}. Status: {booking.status}.
          {booking.geofence_required && " Geofenced check-in required."}
        </div>

        <Divider />

        <div style={{ ...fontBody, fontWeight: 600, fontSize: 13, color: C.charcoal, marginBottom: 10 }}>
          Harvest declaration — pre-filled
        </div>
        <div
          style={{
            background: C.white,
            border: `1.5px dashed ${C.line}`,
            borderRadius: 10,
            padding: 16,
          }}
        >
          {[
            ["PROPERTY PIC", d.pic_code],
            ["HARVESTER APPROVAL", d.harvester_approval_no || "— not on file"],
            ["DATE OF HARVEST", "— to be applied at time of tag"],
            ["BOOKING ID", `#${booking.id}`],
          ].map(([k, v], i) => (
            <div
              key={i}
              style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}
            >
              <span style={{ ...fontMono, fontSize: 11, color: C.steel }}>{k}</span>
              <span style={{ ...fontMono, fontSize: 11, color: C.charcoal }}>{v}</span>
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 10,
            ...fontBody,
            fontSize: 12,
            color: C.steel,
            fontStyle: "italic",
          }}
        >
          Carcass tags unlock once {hunterName.split(" ")[0]} accepts — log the harvest from the
          "Booking requests" tab (hunter) once it's {booking.status === "requested" ? "approved" : "done"}.
        </div>

        <Divider />
        <GhostButton icon={MessageSquare} full onClick={() => goMessages(booking.id, hunterName)}>
          Message {hunterName.split(" ")[0]} about gate access
        </GhostButton>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={goBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: "none",
          color: C.steel,
          ...fontMono,
          fontSize: 11.5,
          cursor: "pointer",
          padding: 0,
          marginBottom: 14,
        }}
      >
        <ChevronLeft size={13} /> BACK TO PROFILE
      </button>

      <div style={{ ...fontDisplay, fontSize: 22, color: C.charcoal }}>Request a booking</div>
      <div style={{ ...fontBody, fontSize: 13, color: C.steel, marginTop: 2 }}>
        with {hunterName}, at {myProperty.name}
      </div>

      <Divider />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <div style={{ ...fontBody, fontWeight: 600, fontSize: 13, color: C.charcoal }}>Select a date</div>
        {hunter && (
          <span style={{ ...fontMono, fontSize: 10, color: C.steel }}>{describeAvailability(hunter)}</span>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {dateOptions.map((d) => {
          const available = isHunterAvailableOn(hunter, d);
          const selected = d === selectedDate;
          return (
            <div
              key={d}
              onClick={() => available && setSelectedDate(d)}
              title={available ? undefined : `${hunterName.split(" ")[0]} isn't available this day`}
              style={{
                textAlign: "center",
                padding: "8px 10px",
                borderRadius: 8,
                cursor: available ? "pointer" : "not-allowed",
                opacity: available ? 1 : 0.35,
                border: `1.5px solid ${selected ? C.eucalyptDeep : C.line}`,
                background: selected ? C.mist : "transparent",
                ...fontMono,
                fontSize: 11.5,
                color: C.charcoal,
              }}
            >
              {formatShortDate(d)}
            </div>
          );
        })}
      </div>

      <Divider />

      <div style={{ ...fontBody, fontWeight: 600, fontSize: 13, color: C.charcoal, marginBottom: 8 }}>
        Access conditions — set by the property owner
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[
          [Clock, "Permitted hours", "5:30am – 9:00am, 4:00pm – dusk"],
          [MapPin, "No-go zone", "House paddock & dam frontage excluded"],
          [AlertTriangle, "Note from farmer", "Livestock in the north paddock this week"],
        ].map(([Icon, label, val], i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <Icon size={14} color={C.steel} style={{ marginTop: 2 }} />
            <div>
              <div style={{ ...fontMono, fontSize: 10.5, color: C.steel }}>{label}</div>
              <div style={{ ...fontBody, fontSize: 12.5, color: C.charcoal }}>{val}</div>
            </div>
          </div>
        ))}
      </div>

      <Divider />
      <Checkbox
        label="Require geofenced check-in"
        checked={geofenceRequired}
        onChange={setGeofenceRequired}
      />
      <div style={{ ...fontBody, fontSize: 11.5, color: C.steel, marginTop: 4 }}>
        {hunterName.split(" ")[0]} will see this before deciding whether to accept. Their check-in/out
        location is recorded against the property boundary — never blocked, just flagged if it's off-site.
      </div>

      {error && (
        <div style={{ ...fontBody, fontSize: 12.5, color: C.rust, marginTop: 10 }}>{error}</div>
      )}

      <Divider />
      <PrimaryButton icon={Send} full onClick={submitBooking}>
        {submitting ? "Sending…" : "Send booking request"}
      </PrimaryButton>
    </div>
  );
}

/* ---------------------------------------------------------
   SCREEN 4 — REFER A HUNTER TO A NEIGHBOUR
--------------------------------------------------------- */
/* ---------------------------------------------------------
   MESSAGES THREAD — tied to a booking
--------------------------------------------------------- */
function MessagesThread({ bookingId, otherPartyName, goBack }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);

  function loadMessages() {
    apiFetch(`/bookings/${bookingId}/messages`)
      .then((r) => {
        if (!r.ok) throw new Error("Could not load messages");
        return r.json();
      })
      .then((data) => {
        setMessages(data);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  React.useEffect(() => {
    if (!bookingId) return;
    setLoading(true);
    loadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  function send() {
    if (!draft.trim()) return;
    setSending(true);
    apiFetch(`/bookings/${bookingId}/messages`, {
      method: "POST",
      body: { content: draft.trim() },
    })
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then((msg) => {
        setMessages((prev) => [...prev, msg]);
        setDraft("");
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSending(false));
  }

  if (!bookingId) {
    return (
      <div style={{ ...fontBody, fontSize: 13, color: C.steel }}>
        Open a booking first (from "Booking request") to message about it.
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={goBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: "none",
          color: C.steel,
          ...fontMono,
          fontSize: 11.5,
          cursor: "pointer",
          padding: 0,
          marginBottom: 14,
        }}
      >
        <ChevronLeft size={13} /> BACK
      </button>

      <div style={{ ...fontDisplay, fontSize: 20, color: C.charcoal }}>
        Booking #{bookingId} {otherPartyName ? `— ${otherPartyName}` : ""}
      </div>

      <Divider />

      {loading && <div style={{ ...fontMono, fontSize: 12, color: C.steel }}>Loading…</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 320, overflowY: "auto" }}>
        {!loading && messages.length === 0 && (
          <div style={{ ...fontBody, fontSize: 12.5, color: C.steel }}>
            No messages yet — say hello.
          </div>
        )}
        {messages.map((m) => {
          const mine = m.sender_type === user.role && m.sender_id === user.id;
          return (
            <div
              key={m.id}
              style={{
                alignSelf: mine ? "flex-end" : "flex-start",
                maxWidth: "80%",
                background: mine ? C.mist : C.paperDim,
                borderRadius: 10,
                padding: "8px 12px",
              }}
            >
              <div style={{ ...fontMono, fontSize: 9.5, color: C.steel, marginBottom: 2 }}>
                {m.sender_type.toUpperCase()} · {new Date(m.created_at).toLocaleString("en-AU")}
              </div>
              <div style={{ ...fontBody, fontSize: 13, color: C.charcoal }}>{m.content}</div>
            </div>
          );
        })}
      </div>

      {error && <div style={{ ...fontBody, fontSize: 12.5, color: C.rust, marginTop: 10 }}>{error}</div>}

      <Divider />

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Write a message…"
          style={{
            flex: 1,
            border: `1.5px solid ${C.line}`,
            borderRadius: 8,
            padding: "9px 12px",
            ...fontBody,
            fontSize: 13,
            color: C.charcoal,
          }}
        />
        <PrimaryButton icon={Send} onClick={send}>
          {sending ? "…" : "Send"}
        </PrimaryButton>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   HARVEST TAG FORM — logs a harvest_declarations row against an
   approved/completed booking and shows the ones already logged,
   styled like a printable carcass tag.
--------------------------------------------------------- */
const SPECIES_OPTIONS = ["Sambar", "Fallow", "Red", "Hog Deer", "Chital", "Rusa"];

function HarvestTagForm({ booking, onCreated }) {
  const [open, setOpen] = useState(false);
  const [species, setSpecies] = useState(SPECIES_OPTIONS[0]);
  const [carcassCount, setCarcassCount] = useState("1");
  const [dateOfHarvest, setDateOfHarvest] = useState(booking.requested_date);
  const [tagNumbers, setTagNumbers] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  function submit() {
    setSubmitting(true);
    apiFetch(`/bookings/${booking.id}/harvest-declarations`, {
      method: "POST",
      body: {
        species,
        carcass_count: parseInt(carcassCount, 10) || 1,
        date_of_harvest: dateOfHarvest,
        tag_numbers: tagNumbers || null,
      },
    })
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then((declaration) => {
        onCreated(booking.id, declaration);
        setOpen(false);
        setTagNumbers("");
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSubmitting(false));
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${C.line}` }}>
      {(booking.harvest_declarations || []).map((d) => (
        <div
          key={d.id}
          style={{
            background: C.white,
            border: `1.5px dashed ${C.line}`,
            borderRadius: 10,
            padding: 12,
            marginBottom: 8,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ ...fontBody, fontWeight: 600, fontSize: 12.5, color: C.charcoal }}>
              {d.species} × {d.carcass_count}
            </span>
            <span style={{ ...fontMono, fontSize: 10.5, color: C.steel }}>{d.date_of_harvest}</span>
          </div>
          <div style={{ ...fontMono, fontSize: 10, color: C.steel, marginTop: 4 }}>
            PIC {d.pic_code} · APPROVAL {d.harvester_approval_no}
            {d.tag_numbers ? ` · TAGS ${d.tag_numbers}` : ""}
          </div>
        </div>
      ))}

      {open ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div>
            <div style={{ ...fontMono, fontSize: 10.5, color: C.steel, marginBottom: 4 }}>SPECIES</div>
            <select
              value={species}
              onChange={(e) => setSpecies(e.target.value)}
              style={{
                border: `1.5px solid ${C.line}`,
                borderRadius: 8,
                padding: "9px 12px",
                ...fontBody,
                fontSize: 13,
                color: C.charcoal,
                background: C.white,
                width: "100%",
              }}
            >
              {SPECIES_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="muster-two-col">
            <TextField label="CARCASS COUNT" value={carcassCount} onChange={setCarcassCount} type="number" />
            <TextField
              label="DATE OF HARVEST"
              value={dateOfHarvest}
              onChange={setDateOfHarvest}
              placeholder="YYYY-MM-DD"
            />
          </div>
          <TextField
            label="TAG NUMBERS (OPTIONAL)"
            value={tagNumbers}
            onChange={setTagNumbers}
            placeholder="e.g. 0231, 0232"
          />
          {error && <div style={{ ...fontBody, fontSize: 12, color: C.rust }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <PrimaryButton icon={FileText} onClick={submit}>
              {submitting ? "Saving…" : "Save tag"}
            </PrimaryButton>
            <GhostButton onClick={() => setOpen(false)}>Cancel</GhostButton>
          </div>
        </div>
      ) : (
        <GhostButton icon={FileText} full onClick={() => setOpen(true)}>
          Log a harvest / generate a tag
        </GhostButton>
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   BOOKING CALENDAR — a month grid shared by FarmerBookings and
   HunterBookings, colour-coded by status. `getLabel` picks what
   text shows on each booking's chip (the other party's name).
--------------------------------------------------------- */
const BOOKING_STATUS_COLORS = {
  requested: C.gold,
  approved: C.eucalyptDeep,
  declined: C.rust,
  completed: C.steel,
  cancelled: C.steel,
};
const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Pure calculation from a known reference new moon — no API, no
// library, works for any date past or future. Handy context for a
// hunter (moon brightness affects nocturnal activity/spotlighting).
const MOON_PHASE_EMOJI = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];
function moonPhaseEmoji(dateStr) {
  const knownNewMoonMs = Date.UTC(2000, 0, 6, 18, 14, 0);
  const synodicMonthDays = 29.530588853;
  const noonUtc = new Date(`${dateStr}T12:00:00Z`).getTime();
  const daysSince = (noonUtc - knownNewMoonMs) / 86400000;
  const fraction = (((daysSince % synodicMonthDays) + synodicMonthDays) % synodicMonthDays) / synodicMonthDays;
  return MOON_PHASE_EMOJI[Math.round(fraction * 8) % 8];
}

// WMO weather codes (used by Open-Meteo, and the wider met industry),
// collapsed to one emoji each — see https://open-meteo.com/en/docs
function weatherEmojiForCode(code) {
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤️";
  if (code === 3) return "☁️";
  if (code === 45 || code === 48) return "🌫️";
  if (code >= 51 && code <= 57) return "🌦️";
  if (code >= 61 && code <= 67) return "🌧️";
  if (code >= 71 && code <= 77) return "🌨️";
  if (code >= 80 && code <= 82) return "🌦️";
  if (code >= 85 && code <= 86) return "🌨️";
  if (code >= 95) return "⛈️";
  return null;
}

function ViewModeToggle({ viewMode, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4, background: C.paperDim, borderRadius: 8, padding: 3 }}>
      {[
        { value: "list", Icon: ClipboardList, label: "List" },
        { value: "calendar", Icon: Calendar, label: "Calendar" },
      ].map(({ value, Icon, label }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            border: "none",
            borderRadius: 6,
            padding: "6px 10px",
            cursor: "pointer",
            background: viewMode === value ? C.white : "transparent",
            boxShadow: viewMode === value ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
            ...fontMono,
            fontSize: 10.5,
            color: viewMode === value ? C.charcoal : C.steel,
          }}
        >
          <Icon size={12} />
          {label}
        </button>
      ))}
    </div>
  );
}

function BookingCalendar({ bookings, getLabel, weatherLocation }) {
  const today = new Date();
  const [view, setView] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [weatherByDate, setWeatherByDate] = useState({});

  const byDate = {};
  bookings.forEach((b) => {
    (byDate[b.requested_date] = byDate[b.requested_date] || []).push(b);
  });

  // Open-Meteo needs no API key and is CORS-enabled for direct browser
  // use — only real forecasts (~16 days out) come back; anything
  // outside that window just has no weather entry, which is fine, the
  // moon phase still shows for every day regardless.
  React.useEffect(() => {
    if (!weatherLocation?.latitude || !weatherLocation?.longitude) return;
    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${weatherLocation.latitude}&longitude=${weatherLocation.longitude}&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=16`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.daily?.time) return;
        const map = {};
        data.daily.time.forEach((dateStr, i) => {
          map[dateStr] = {
            code: data.daily.weathercode[i],
            max: data.daily.temperature_2m_max[i],
            min: data.daily.temperature_2m_min[i],
          };
        });
        setWeatherByDate(map);
      })
      .catch(() => {});
  }, [weatherLocation?.latitude, weatherLocation?.longitude]);

  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const leadingBlanks = (new Date(view.year, view.month, 1).getDay() + 6) % 7; // Mon-first grid
  const cells = [...Array(leadingBlanks).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  function shiftMonth(delta) {
    setView((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  const monthLabel = new Date(view.year, view.month, 1).toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <button
          onClick={() => shiftMonth(-1)}
          style={{ background: "none", border: "none", cursor: "pointer", color: C.steel, padding: 4 }}
        >
          <ChevronLeft size={16} />
        </button>
        <div style={{ ...fontBody, fontWeight: 600, fontSize: 13, color: C.charcoal }}>{monthLabel}</div>
        <button
          onClick={() => shiftMonth(1)}
          style={{ background: "none", border: "none", cursor: "pointer", color: C.steel, padding: 4 }}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginBottom: 4 }}>
        {WEEKDAY_HEADERS.map((d) => (
          <div key={d} style={{ ...fontMono, fontSize: 9, color: C.steel, textAlign: "center" }}>
            {d}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />;
          const dateStr = `${view.year}-${String(view.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayBookings = byDate[dateStr] || [];
          const dayWeather = weatherByDate[dateStr];
          const weatherEmoji = dayWeather ? weatherEmojiForCode(dayWeather.code) : null;
          return (
            <div
              key={i}
              style={{
                minHeight: 46,
                border: `1px solid ${C.line}`,
                borderRadius: 6,
                padding: 3,
                background: dayBookings.length ? C.white : "transparent",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ ...fontMono, fontSize: 9, color: C.steel }}>{day}</span>
                <span
                  style={{ fontSize: 9, lineHeight: 1 }}
                  title={
                    dayWeather
                      ? `${Math.round(dayWeather.min)}–${Math.round(dayWeather.max)}°C`
                      : undefined
                  }
                >
                  {weatherEmoji}
                  {moonPhaseEmoji(dateStr)}
                </span>
              </div>
              {dayBookings.slice(0, 2).map((b) => (
                <div
                  key={b.id}
                  title={`${getLabel(b)} — ${b.status}`}
                  style={{
                    ...fontMono,
                    fontSize: 7.5,
                    color: C.white,
                    background: BOOKING_STATUS_COLORS[b.status] || C.steel,
                    borderRadius: 3,
                    padding: "1px 3px",
                    marginTop: 2,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                >
                  {getLabel(b)}
                </div>
              ))}
              {dayBookings.length > 2 && (
                <div style={{ ...fontMono, fontSize: 7.5, color: C.steel }}>+{dayBookings.length - 2} more</div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        {Object.entries(BOOKING_STATUS_COLORS).map(([status, color]) => (
          <div key={status} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: "inline-block" }} />
            <span style={{ ...fontMono, fontSize: 9, color: C.steel }}>{status.toUpperCase()}</span>
          </div>
        ))}
      </div>
      <div style={{ ...fontMono, fontSize: 9, color: C.steel, marginTop: 8 }}>
        Moon phase shown for every day · weather forecast where available (next 16 days)
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   HUNTER BOOKINGS — incoming requests, accept/decline, and
   past bookings. The other side of BookingRequest: a farmer
   sends a request, this is where the hunter responds to it.
--------------------------------------------------------- */
// In-app fallback for urgent-sighting dispatches — push/email delivery
// isn't guaranteed (and on this test site, email is redirected to one
// inbox rather than the hunter's own), so this is the one place a
// hunter is guaranteed to see what they were notified about.
function UrgentSightingsBanner() {
  const { user } = useAuth();
  const [dispatches, setDispatches] = useState([]);

  React.useEffect(() => {
    if (!user || user.role !== "hunter") {
      setDispatches([]);
      return;
    }
    apiFetch("/sightings/dispatched")
      .then((r) => (r.ok ? r.json() : []))
      .then(setDispatches)
      .catch(() => {});
  }, [user?.id, user?.role]);

  if (dispatches.length === 0) return null;

  return (
    <div style={{ background: C.paperDim, borderRadius: 10, padding: 12, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <Siren size={13} color={C.rust} />
        <span style={{ ...fontBody, fontWeight: 600, fontSize: 12.5, color: C.charcoal }}>
          Urgent sightings near you
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {dispatches.map((d) => (
          <div key={d.dispatch_id} style={{ ...fontBody, fontSize: 12, color: C.bark }}>
            <strong>{d.species || "Unspecified"}</strong>
            {d.estimated_count ? ` × ${d.estimated_count}` : ""} at {d.property_name}
            {d.property_suburb ? `, ${d.property_suburb}` : ""} — {d.distance_km.toFixed(1)}km away
            {d.damage_notes ? ` (${d.damage_notes})` : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

function HunterBookings({ goMessages, goLiveTracker }) {
  const { user } = useAuth();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actingId, setActingId] = useState(null);
  const [viewMode, setViewMode] = useState("calendar");

  function loadBookings() {
    setLoading(true);
    apiFetch("/bookings")
      .then((r) => {
        if (!r.ok) throw new Error("Could not load bookings");
        return r.json();
      })
      .then((data) => {
        setBookings(data);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  React.useEffect(() => {
    if (!user || user.role !== "hunter") {
      setLoading(false);
      return;
    }
    loadBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  function respond(bookingId, status) {
    setActingId(bookingId);
    apiFetch(`/bookings/${bookingId}`, {
      method: "PATCH",
      body: { status },
    })
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then(() => {
        setError(null);
        loadBookings();
      })
      .catch((e) => setError(e.message))
      .finally(() => setActingId(null));
  }

  function addDeclaration(bookingId, declaration) {
    setBookings((prev) =>
      prev.map((b) =>
        b.id === bookingId
          ? { ...b, harvest_declarations: [declaration, ...(b.harvest_declarations || [])] }
          : b
      )
    );
  }

  if (!user) {
    return (
      <div style={{ ...fontBody, fontSize: 13, color: C.steel }}>
        Log in as a hunter to see booking requests.
      </div>
    );
  }
  if (user.role !== "hunter") {
    return (
      <div style={{ ...fontBody, fontSize: 13, color: C.steel }}>
        This screen is for hunter accounts. You're logged in as a farmer.
      </div>
    );
  }
  if (loading) {
    return <div style={{ ...fontMono, fontSize: 12, color: C.steel }}>Loading bookings…</div>;
  }

  const pending = bookings.filter((b) => b.status === "requested");
  const others = bookings.filter((b) => b.status !== "requested");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ ...fontDisplay, fontSize: 22, color: C.charcoal }}>Booking requests</div>
          <div style={{ ...fontBody, fontSize: 13, color: C.steel, marginTop: 2 }}>
            Farmers who'd like you on their property.
          </div>
        </div>
        <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
      </div>

      <Divider />

      <UrgentSightingsBanner />

      {error && (
        <div style={{ ...fontBody, fontSize: 12.5, color: C.rust, marginBottom: 10 }}>{error}</div>
      )}

      {bookings.length === 0 && (
        <div style={{ ...fontBody, fontSize: 12.5, color: C.steel }}>No booking requests yet.</div>
      )}

      {viewMode === "calendar" && bookings.length > 0 && (
        <BookingCalendar
          bookings={bookings}
          getLabel={(b) => b.farmer_name}
          weatherLocation={{ latitude: user?.latitude, longitude: user?.longitude }}
        />
      )}

      {viewMode === "list" && pending.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            marginBottom: others.length ? 20 : 0,
          }}
        >
          {pending.map((b) => (
            <div
              key={b.id}
              style={{
                background: C.white,
                border: `1px solid ${C.line}`,
                borderRadius: 12,
                padding: 14,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ ...fontBody, fontWeight: 700, fontSize: 14, color: C.charcoal }}>
                    {b.property_name}, {b.property_suburb}
                  </div>
                  <div style={{ ...fontMono, fontSize: 11, color: C.steel, marginTop: 2 }}>
                    {formatShortDate(b.requested_date)}
                    {b.start_time && b.end_time ? ` · ${b.start_time}–${b.end_time}` : ""}
                  </div>
                  <div style={{ ...fontBody, fontSize: 12, color: C.steel, marginTop: 2 }}>
                    Requested by {b.farmer_name}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                  <Pill tone="gold">REQUESTED</Pill>
                  {b.geofence_required && (
                    <Pill>
                      <MapPin size={9} style={{ verticalAlign: -1, marginRight: 2 }} />
                      Geofence required
                    </Pill>
                  )}
                </div>
              </div>

              {b.farmer_note && (
                <div style={{ display: "flex", gap: 6, alignItems: "flex-start", marginTop: 10 }}>
                  <AlertTriangle size={13} color={C.steel} style={{ marginTop: 1, flexShrink: 0 }} />
                  <span style={{ ...fontBody, fontSize: 12, color: C.bark }}>{b.farmer_note}</span>
                </div>
              )}
              <AtcwWarnings warnings={b.atcw_expiry_warnings} />
              <GeofenceStatus booking={b} />

              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <PrimaryButton icon={Check} onClick={() => respond(b.id, "approved")}>
                  {actingId === b.id ? "…" : "Accept"}
                </PrimaryButton>
                <GhostButton tone="rust" onClick={() => respond(b.id, "declined")}>
                  {actingId === b.id ? "…" : "Decline"}
                </GhostButton>
                <GhostButton icon={MessageSquare} onClick={() => goMessages(b.id, b.farmer_name, "hunterBookings")}>
                  Message
                </GhostButton>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewMode === "list" && others.length > 0 && (
        <div>
          <div style={{ ...fontBody, fontWeight: 600, fontSize: 13, color: C.charcoal, marginBottom: 10 }}>
            Past &amp; other bookings
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {others.map((b) => (
              <div
                key={b.id}
                style={{
                  background: C.white,
                  border: `1px solid ${C.line}`,
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ ...fontBody, fontSize: 13, color: C.charcoal }}>
                      {b.property_name} · {formatShortDate(b.requested_date)}
                    </div>
                    <div style={{ ...fontMono, fontSize: 10.5, color: C.steel }}>with {b.farmer_name}</div>
                  </div>
                  <Pill tone={b.status === "declined" ? "gold" : "mist"}>{b.status.toUpperCase()}</Pill>
                </div>
                <AtcwWarnings warnings={b.atcw_expiry_warnings} />
                <GeofenceStatus booking={b} />

                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  {(b.status === "approved" || b.status === "completed") && (
                    <GhostButton icon={MessageSquare} onClick={() => goMessages(b.id, b.farmer_name, "hunterBookings")}>
                      Message
                    </GhostButton>
                  )}
                  {b.status === "approved" && (
                    <GhostButton onClick={() => respond(b.id, "completed")}>
                      {actingId === b.id ? "…" : "Mark completed"}
                    </GhostButton>
                  )}
                  {b.status === "approved" && (
                    <GhostButton icon={MapPin} onClick={() => goLiveTracker(b)}>
                      {b.tracking_session && !b.tracking_session.ended_at ? "Continue tracking" : "Start tracking"}
                    </GhostButton>
                  )}
                </div>

                {(b.status === "approved" || b.status === "completed") && (
                  <HarvestTagForm booking={b} onCreated={addDeclaration} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function tagDivIcon(tagType) {
  const color = { shot: C.rust, left: C.gold, processed: C.eucalyptDeep }[tagType] || C.steel;
  const letter = { shot: "S", left: "L", processed: "P" }[tagType] || "?";
  return L.divIcon({
    className: "",
    html: `<div style="width:20px;height:20px;border-radius:50%;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-family:monospace;font-size:10px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4);">${letter}</div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

// Centers the map once, the first time a GPS fix arrives — doesn't fight
// the hunter if they pan around afterward to look at where they've been.
function RecenterOnce({ position }) {
  const map = useMap();
  const centeredRef = React.useRef(false);
  React.useEffect(() => {
    if (position && !centeredRef.current) {
      map.setView(position, 16);
      centeredRef.current = true;
    }
  }, [position, map]);
  return null;
}

const TRACK_TAG_TYPES = [
  { value: "shot", label: "Shot" },
  { value: "left", label: "Left" },
  { value: "processed", label: "Processed" },
];
const SOS_HOLD_MS = 2000;

/* ---------------------------------------------------------
   SCREEN — LIVE TRACKER
   A hunter's continuous GPS track for a booking visit — private by
   default, tags along the way, a hunter-controlled opt-in to share
   with the farmer, and a hold-to-activate SOS. Reached from an
   approved booking in HunterBookings; session start/stop is the
   check-in/check-out record.
--------------------------------------------------------- */
function LiveTracker({ booking, goBack }) {
  const activeFromBooking =
    booking?.tracking_session && !booking.tracking_session.ended_at ? booking.tracking_session : null;

  const [session, setSession] = useState(activeFromBooking);
  const [points, setPoints] = useState([]); // [[lat,lng], ...]
  const [tags, setTags] = useState([]);
  const [currentPos, setCurrentPos] = useState(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [sosProgress, setSosProgress] = useState(0);
  const [sosSent, setSosSent] = useState(false);
  const [sosQueued, setSosQueued] = useState(false);
  const [sosAlertId, setSosAlertId] = useState(null); // set once the SOS has actually reached the server
  const [sosQueueItemId, setSosQueueItemId] = useState(null); // set while it's only sitting in the offline queue
  const [queueSize, setQueueSize] = useState(0);

  const watchIdRef = React.useRef(null);
  const pendingPointsRef = React.useRef([]);
  const flushTimerRef = React.useRef(null);
  const wakeLockRef = React.useRef(null);
  const sosTimerRef = React.useRef(null);
  const sosIntervalRef = React.useRef(null);
  const queueRetryTimerRef = React.useRef(null);

  // Resuming an already-active session (e.g. the page reloaded mid-hunt)
  // — hydrate the existing points/tags instead of starting from empty.
  React.useEffect(() => {
    if (!activeFromBooking) return;
    apiFetch(`/tracking/${activeFromBooking.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((full) => {
        if (!full) return;
        setPoints((full.points || []).map((p) => [p.latitude, p.longitude]));
        setTags(full.tags || []);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // For a geofence_required booking, grab a one-time GPS fix before
  // starting so the server can verify it against the property's
  // radius — soft enforcement, so a failed/denied fix just starts
  // without a position (server records that as "couldn't verify"),
  // it never blocks check-in.
  function startTracking() {
    setStarting(true);
    setError(null);

    function doStart(position) {
      const body = position
        ? { latitude: position.coords.latitude, longitude: position.coords.longitude }
        : undefined;
      apiFetch(`/bookings/${booking.id}/tracking/start`, { method: "POST", body })
        .then((r) => {
          if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
          return r.json();
        })
        .then(setSession)
        .catch((e) => setError(e.message))
        .finally(() => setStarting(false));
    }

    if (booking.geofence_required && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(doStart, () => doStart(null), {
        enableHighAccuracy: true,
        timeout: 8000,
      });
    } else {
      doStart(null);
    }
  }

  function flushPendingPoints() {
    if (!session || pendingPointsRef.current.length === 0) return;
    const batch = pendingPointsRef.current;
    pendingPointsRef.current = [];
    apiFetch(`/tracking/${session.id}/points`, { method: "POST", body: { points: batch } })
      .catch(() => offlineQueueAddPoints(session.id, batch).then(runFlushQueue));
  }

  // Retries whatever's sitting in the offline queue — leftovers from a
  // previous session included, not just this one. Runs on mount, on the
  // browser's 'online' event, and on a short interval as a backstop
  // (navigator.onLine/the 'online' event only reflect link state, not
  // real internet reachability, so a timer that just tries the request
  // is the more honest signal).
  function runFlushQueue() {
    offlineQueueFlush((item, data) => {
      if (item.kind === "sos") {
        setSosSent(true);
        setSosQueued(false);
        setSosQueueItemId(null);
        if (data?.id) setSosAlertId(data.id);
      }
    }).then(setQueueSize);
  }

  React.useEffect(() => {
    runFlushQueue();
    window.addEventListener("online", runFlushQueue);
    queueRetryTimerRef.current = setInterval(runFlushQueue, 15000);
    return () => {
      window.removeEventListener("online", runFlushQueue);
      clearInterval(queueRetryTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // GPS watch + periodic flush + screen wake lock, active only while a
  // session exists and hasn't ended.
  React.useEffect(() => {
    if (!session || session.ended_at) return;
    if (!navigator.geolocation) {
      setError("Geolocation isn't available on this device or browser.");
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const next = [pos.coords.latitude, pos.coords.longitude];
        setCurrentPos(next);
        setPoints((prev) => [...prev, next]);
        pendingPointsRef.current.push({ latitude: next[0], longitude: next[1] });
      },
      (err) => setError(`GPS error: ${err.message}`),
      { enableHighAccuracy: true, maximumAge: 5000 }
    );

    flushTimerRef.current = setInterval(flushPendingPoints, 15000);

    if ("wakeLock" in navigator) {
      navigator.wakeLock
        .request("screen")
        .then((wl) => {
          wakeLockRef.current = wl;
        })
        .catch(() => {});
    }

    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (flushTimerRef.current) clearInterval(flushTimerRef.current);
      if (wakeLockRef.current) wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.ended_at]);

  function toggleShare(next) {
    apiFetch(`/tracking/${session.id}`, { method: "PATCH", body: { share_with_farmer: next } })
      .then((r) => r.json())
      .then(setSession)
      .catch(() => {});
  }

  function addTag(tagType) {
    if (!currentPos) {
      setError("Waiting for a GPS fix before you can add a tag.");
      return;
    }
    const body = { tag_type: tagType, latitude: currentPos[0], longitude: currentPos[1], notes: noteDraft || null };
    apiFetch(`/tracking/${session.id}/tags`, { method: "POST", body })
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then((tag) => {
        setTags((prev) => [...prev, tag]);
        setNoteDraft("");
        setError(null);
      })
      .catch((e) => {
        // fetch() rejects with TypeError specifically for a network
        // failure (no connection at all) — anything else (e.g. the
        // server rejecting the request) is a real error, not a
        // connectivity problem, so it's shown rather than queued.
        if (e instanceof TypeError) {
          offlineQueueAddOne("tag", session.id, body).then(runFlushQueue);
          setTags((prev) => [...prev, { id: `local-${Date.now()}`, ...body }]);
          setNoteDraft("");
          setError(null);
          setQueueSize((n) => n + 1);
        } else {
          setError(e.message);
        }
      });
  }

  function stopTracking() {
    flushPendingPoints();

    function doStop(position) {
      const body = {
        stop: true,
        ...(position ? { latitude: position.coords.latitude, longitude: position.coords.longitude } : {}),
      };
      apiFetch(`/tracking/${session.id}`, { method: "PATCH", body })
        .then((r) => r.json())
        .then(setSession)
        .catch(() => {});
    }

    if (booking.geofence_required && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(doStop, () => doStop(null), {
        enableHighAccuracy: true,
        timeout: 8000,
      });
    } else {
      doStop(null);
    }
  }

  function triggerSos() {
    if (!currentPos || !session) return;
    const body = { latitude: currentPos[0], longitude: currentPos[1] };
    apiFetch(`/tracking/${session.id}/sos`, { method: "POST", body })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("SOS request failed"))))
      .then((alert) => {
        setSosSent(true);
        setSosAlertId(alert.id);
      })
      .catch((e) => {
        if (e instanceof TypeError) {
          offlineQueueAddOne("sos", session.id, body).then(setSosQueueItemId);
          setSosQueued(true);
          setError(null);
          setQueueSize((n) => n + 1);
        } else {
          setError("Could not send SOS — check your connection and try again.");
        }
      });
  }

  // Clears a false alarm or a hold-to-activate that fired unintentionally
  // — resolves it server-side if it already sent, or just deletes it from
  // the offline queue if it never left the device.
  function cancelSos() {
    if (sosAlertId) {
      apiFetch(`/sos/${sosAlertId}`, { method: "PATCH" })
        .then(() => {
          setSosSent(false);
          setSosAlertId(null);
        })
        .catch(() => {});
    } else if (sosQueueItemId != null) {
      offlineQueueDelete(sosQueueItemId).then(() => {
        setSosQueued(false);
        setSosQueueItemId(null);
        setQueueSize((n) => Math.max(0, n - 1));
      });
    }
  }

  function cancelSosHold() {
    setSosProgress(0);
    if (sosTimerRef.current) clearTimeout(sosTimerRef.current);
    if (sosIntervalRef.current) clearInterval(sosIntervalRef.current);
  }
  function startSosHold() {
    setSosSent(false);
    setSosQueued(false);
    setSosAlertId(null);
    setSosQueueItemId(null);
    const startedAt = Date.now();
    sosIntervalRef.current = setInterval(() => {
      setSosProgress(Math.min(1, (Date.now() - startedAt) / SOS_HOLD_MS));
    }, 50);
    sosTimerRef.current = setTimeout(() => {
      cancelSosHold();
      triggerSos();
    }, SOS_HOLD_MS);
  }

  React.useEffect(() => cancelSosHold, []); // clear any pending timers on unmount

  if (!booking) {
    return <div style={{ ...fontBody, fontSize: 13, color: C.steel }}>No booking selected.</div>;
  }

  const backLink = (
    <button
      onClick={goBack}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        background: "none",
        border: "none",
        padding: 0,
        ...fontMono,
        fontSize: 10.5,
        color: C.steel,
        cursor: "pointer",
      }}
    >
      <ChevronLeft size={12} /> BACK
    </button>
  );

  const mapView = (
    <MapContainer
      center={currentPos || [-37.05, 146.09]}
      zoom={currentPos ? 16 : 8}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <RecenterOnce position={currentPos} />
      {points.length > 1 && <Polyline positions={points} pathOptions={{ color: C.eucalyptDeep, weight: 3 }} />}
      {currentPos && <Marker position={currentPos} />}
      {tags.map((t) => (
        <Marker key={t.id} position={[t.latitude, t.longitude]} icon={tagDivIcon(t.tag_type)} />
      ))}
    </MapContainer>
  );

  // Not actively tracking (not started yet, or just ended) — the normal
  // in-flow screen. The full-viewport treatment below is only worth it
  // while GPS is actually live.
  if (!session || session.ended_at) {
    return (
      <div>
        <div style={{ marginBottom: 12 }}>{backLink}</div>

        <div style={{ ...fontDisplay, fontSize: 20, color: C.charcoal }}>{booking.property_name}</div>
        <div style={{ ...fontBody, fontSize: 12.5, color: C.steel, marginTop: 2, marginBottom: 12 }}>
          Live tracker — private to you by default. Useful as a reference in the dark, whether or not you
          choose to share it.
        </div>
        <GeofenceStatus booking={{ geofence_required: booking.geofence_required, tracking_session: session }} />

        {error && <div style={{ ...fontBody, fontSize: 12.5, color: C.rust, marginBottom: 10 }}>{error}</div>}

        {!session && (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <PrimaryButton icon={Navigation} onClick={startTracking}>
              {starting ? "Starting…" : "Start tracking"}
            </PrimaryButton>
          </div>
        )}

        {session?.ended_at && (
          <>
            <div style={{ borderRadius: 12, overflow: "hidden", border: `1px solid ${C.line}`, marginBottom: 12, height: 320 }}>
              {mapView}
            </div>
            <div style={{ ...fontBody, fontSize: 12.5, color: C.steel, textAlign: "center", padding: "12px 0" }}>
              Tracking ended. {tags.length} tag{tags.length === 1 ? "" : "s"} recorded.
            </div>
          </>
        )}
      </div>
    );
  }

  // Actively tracking — the map fills the whole screen (this is the
  // hunter's primary view in the field, not a small box in a scrolling
  // page); back/status float over the top and the tag/SOS/end-tracking
  // controls float over the bottom, both above Leaflet's own controls
  // (its zoom buttons sit at z-index 1000 inside the map).
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, background: C.paper }}>
      {mapView}

      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1001,
          padding: "calc(10px + env(safe-area-inset-top)) 14px 10px",
          background: "rgba(246,243,236,0.94)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
        }}
      >
        {backLink}
        <div style={{ ...fontDisplay, fontSize: 17, color: C.charcoal, marginTop: 4 }}>{booking.property_name}</div>
        <div style={{ marginTop: 4 }}>
          <GeofenceStatus booking={{ geofence_required: booking.geofence_required, tracking_session: session }} />
        </div>
        {queueSize > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
            <RefreshCw size={12} color={C.gold} />
            <span style={{ ...fontBody, fontSize: 11.5, color: C.goldDeep }}>
              No signal — {queueSize} item{queueSize === 1 ? "" : "s"} saved, will send once you're back in
              range.
            </span>
          </div>
        )}
        {error && <div style={{ ...fontBody, fontSize: 11.5, color: C.rust, marginTop: 6 }}>{error}</div>}
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 1001,
          maxHeight: "60vh",
          overflowY: "auto",
          background: C.paper,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          boxShadow: "0 -6px 20px rgba(0,0,0,0.15)",
          padding: "14px 16px calc(14px + env(safe-area-inset-bottom))",
        }}
      >
        <Checkbox
          label="Share live location with farmer"
          checked={!!session.share_with_farmer}
          onChange={toggleShare}
        />

        <div style={{ marginTop: 10 }}>
          <TextField
            label="TAG A SPOT (OPTIONAL NOTE)"
            value={noteDraft}
            onChange={setNoteDraft}
            placeholder="e.g. Sambar stag"
          />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          {TRACK_TAG_TYPES.map((t) => (
            <GhostButton key={t.value} icon={Crosshair} onClick={() => addTag(t.value)}>
              {t.label}
            </GhostButton>
          ))}
        </div>

        <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 12, paddingTop: 12 }}>
          <button
            onPointerDown={startSosHold}
            onPointerUp={cancelSosHold}
            onPointerLeave={cancelSosHold}
            style={{
              position: "relative",
              width: "100%",
              padding: "13px 0",
              borderRadius: 10,
              border: "none",
              background: C.rust,
              color: C.white,
              cursor: "pointer",
              overflow: "hidden",
              ...fontBody,
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                left: 0,
                width: `${sosProgress * 100}%`,
                background: "rgba(255,255,255,0.28)",
                transition: sosProgress === 0 ? "width 0.15s ease-out" : "none",
              }}
            />
            <span style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Siren size={16} /> HOLD 2s FOR SOS
            </span>
          </button>
          {sosQueued && (
            <div style={{ ...fontBody, fontSize: 12, color: C.rust, marginTop: 8, textAlign: "center" }}>
              No signal — SOS saved on this device and will send the moment you're back in range. Keep this
              screen open.
            </div>
          )}
          {sosSent && !sosQueued && (
            <div style={{ ...fontBody, fontSize: 12, color: C.rust, marginTop: 8, textAlign: "center" }}>
              SOS sent — the farmer and any nearby opted-in hunters have been alerted.
            </div>
          )}
          {(sosSent || sosQueued) && (
            <div style={{ textAlign: "center", marginTop: 8 }}>
              <GhostButton icon={X} onClick={cancelSos}>
                Cancel SOS
              </GhostButton>
            </div>
          )}
        </div>

        <div style={{ marginTop: 12 }}>
          <GhostButton full tone="rust" onClick={stopTracking}>
            End tracking
          </GhostButton>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   SCREEN — TRACKING LIVE VIEW (farmer, read-only)
   Polls a shared (or SOS-active) tracking session — the first
   polling component in the codebase, so it explicitly pauses on
   document.visibilitychange rather than burning requests in a
   background tab.
--------------------------------------------------------- */
function TrackingLiveView({ sessionId, goBack }) {
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  function load() {
    apiFetch(`/tracking/${sessionId}`)
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then((data) => {
        setSession(data);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  React.useEffect(() => {
    load();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 20000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const points = (session?.points || []).map((p) => [p.latitude, p.longitude]);
  const lastPoint = points[points.length - 1] || null;

  return (
    <div>
      <button
        onClick={goBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: "none",
          padding: 0,
          marginBottom: 12,
          ...fontMono,
          fontSize: 10.5,
          color: C.steel,
          cursor: "pointer",
        }}
      >
        <ChevronLeft size={12} /> BACK
      </button>

      <div style={{ ...fontDisplay, fontSize: 20, color: C.charcoal }}>Live location</div>

      {loading && <div style={{ ...fontMono, fontSize: 12, color: C.steel, marginTop: 10 }}>Loading…</div>}
      {error && <div style={{ ...fontBody, fontSize: 12.5, color: C.rust, marginTop: 10 }}>{error}</div>}

      {session && (
        <>
          <div style={{ ...fontBody, fontSize: 12.5, color: C.steel, marginTop: 2, marginBottom: 12 }}>
            {session.ended_at
              ? `Tracking ended ${session.ended_at}.`
              : "Live now — updates every 20 seconds while this page is open."}
          </div>
          <GeofenceStatus booking={{ geofence_required: session.geofence_required, tracking_session: session }} />
          <div style={{ borderRadius: 12, overflow: "hidden", border: `1px solid ${C.line}`, marginTop: 8 }}>
            <MapContainer
              center={lastPoint || [-37.05, 146.09]}
              zoom={lastPoint ? 15 : 8}
              style={{ height: 320, width: "100%" }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {points.length > 1 && (
                <Polyline positions={points} pathOptions={{ color: C.eucalyptDeep, weight: 3 }} />
              )}
              {lastPoint && <Marker position={lastPoint} />}
              {(session.tags || []).map((t) => (
                <Marker key={t.id} position={[t.latitude, t.longitude]} icon={tagDivIcon(t.tag_type)} />
              ))}
            </MapContainer>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   REVIEW FORM — a farmer rates the hunter once a booking is
   completed. Shows the submitted review instead of the form
   once one exists (reviews are one-per-booking, enforced by
   the API).
--------------------------------------------------------- */
function ReviewForm({ booking, onSubmitted }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  function submit() {
    setSubmitting(true);
    apiFetch("/reviews", {
      method: "POST",
      body: { booking_id: booking.id, rating, comment: comment || null },
    })
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then((review) => {
        onSubmitted(booking.id, review);
        setOpen(false);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSubmitting(false));
  }

  if (booking.my_review_rating) {
    return (
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${C.line}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StarRow rating={booking.my_review_rating} />
          <span style={{ ...fontMono, fontSize: 10, color: C.steel }}>YOUR REVIEW</span>
        </div>
        {booking.my_review_comment && (
          <div style={{ ...fontBody, fontSize: 12.5, color: C.bark, marginTop: 4 }}>
            {booking.my_review_comment}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${C.line}` }}>
      {open ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <StarRatingInput value={rating} onChange={setRating} />
          <TextField
            label="COMMENT (OPTIONAL)"
            value={comment}
            onChange={setComment}
            placeholder="Always closes the gates behind him."
            multiline
          />
          {error && <div style={{ ...fontBody, fontSize: 12, color: C.rust }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <PrimaryButton icon={Star} onClick={submit}>
              {submitting ? "Saving…" : "Submit review"}
            </PrimaryButton>
            <GhostButton onClick={() => setOpen(false)}>Cancel</GhostButton>
          </div>
        </div>
      ) : (
        <GhostButton icon={Star} full onClick={() => setOpen(true)}>
          Leave a review
        </GhostButton>
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   FARMER BOOKINGS — "My bookings": every request a farmer has
   sent, with status, the ability to cancel or mark one done,
   and — once completed — leaving a review of the hunter.
--------------------------------------------------------- */
function FarmerBookings({ goMessages, goTrackingView }) {
  const { user } = useAuth();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actingId, setActingId] = useState(null);
  const [viewMode, setViewMode] = useState("calendar");

  function loadBookings() {
    setLoading(true);
    apiFetch("/bookings")
      .then((r) => {
        if (!r.ok) throw new Error("Could not load bookings");
        return r.json();
      })
      .then((data) => {
        setBookings(data);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  React.useEffect(() => {
    if (!user || user.role !== "farmer") {
      setLoading(false);
      return;
    }
    loadBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  function updateStatus(bookingId, status) {
    setActingId(bookingId);
    apiFetch(`/bookings/${bookingId}`, {
      method: "PATCH",
      body: { status },
    })
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then(() => {
        setError(null);
        loadBookings();
      })
      .catch((e) => setError(e.message))
      .finally(() => setActingId(null));
  }

  function recordReview(bookingId, review) {
    setBookings((prev) =>
      prev.map((b) =>
        b.id === bookingId ? { ...b, my_review_rating: review.rating, my_review_comment: review.comment } : b
      )
    );
  }

  if (!user) {
    return (
      <div style={{ ...fontBody, fontSize: 13, color: C.steel }}>
        Log in as a farmer to see your booking requests.
      </div>
    );
  }
  if (user.role !== "farmer") {
    return (
      <div style={{ ...fontBody, fontSize: 13, color: C.steel }}>
        This screen is for farmer accounts. You're logged in as a hunter.
      </div>
    );
  }
  if (loading) {
    return <div style={{ ...fontMono, fontSize: 12, color: C.steel }}>Loading bookings…</div>;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ ...fontDisplay, fontSize: 22, color: C.charcoal }}>My bookings</div>
          <div style={{ ...fontBody, fontSize: 13, color: C.steel, marginTop: 2 }}>
            Requests you've sent to hunters.
          </div>
        </div>
        <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
      </div>

      <Divider />

      {error && (
        <div style={{ ...fontBody, fontSize: 12.5, color: C.rust, marginBottom: 10 }}>{error}</div>
      )}

      {bookings.length === 0 && (
        <div style={{ ...fontBody, fontSize: 12.5, color: C.steel }}>
          No booking requests sent yet — request one from a hunter's profile.
        </div>
      )}

      {viewMode === "calendar" && bookings.length > 0 && (
        <BookingCalendar
          bookings={bookings}
          getLabel={(b) => b.hunter_name}
          weatherLocation={{
            latitude: user?.properties?.[0]?.latitude,
            longitude: user?.properties?.[0]?.longitude,
          }}
        />
      )}

      {viewMode === "list" && (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {bookings.map((b) => (
          <div
            key={b.id}
            style={{ background: C.white, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ ...fontBody, fontWeight: 700, fontSize: 14, color: C.charcoal }}>
                  {b.hunter_name}
                </div>
                <div style={{ ...fontMono, fontSize: 11, color: C.steel, marginTop: 2 }}>
                  {b.property_name} · {formatShortDate(b.requested_date)}
                  {b.start_time && b.end_time ? ` · ${b.start_time}–${b.end_time}` : ""}
                </div>
              </div>
              <Pill tone={b.status === "requested" || b.status === "declined" ? "gold" : "mist"}>
                {b.status.toUpperCase()}
              </Pill>
            </div>
            <AtcwWarnings warnings={b.atcw_expiry_warnings} />
            <GeofenceStatus booking={b} />

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <GhostButton icon={MessageSquare} onClick={() => goMessages(b.id, b.hunter_name, "farmerBookings")}>
                Message
              </GhostButton>
              {(b.status === "requested" || b.status === "approved") && (
                <GhostButton icon={X} tone="rust" onClick={() => updateStatus(b.id, "cancelled")}>
                  {actingId === b.id ? "…" : "Cancel"}
                </GhostButton>
              )}
              {b.status === "approved" && (
                <GhostButton onClick={() => updateStatus(b.id, "completed")}>
                  {actingId === b.id ? "…" : "Mark completed"}
                </GhostButton>
              )}
              {b.tracking_session && (
                <GhostButton icon={MapPin} onClick={() => goTrackingView(b.tracking_session.id)}>
                  {b.tracking_session.ended_at ? "View past track" : "View live location"}
                </GhostButton>
              )}
            </div>

            {b.status === "completed" && <ReviewForm booking={b} onSubmitted={recordReview} />}
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

function TextField({ label, value, onChange, placeholder, multiline, type }) {
  const Tag = multiline ? "textarea" : "input";
  return (
    <div>
      <div style={{ ...fontMono, fontSize: 10.5, color: C.steel, marginBottom: 4 }}>{label}</div>
      <Tag
        type={multiline ? undefined : type || "text"}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        rows={multiline ? 3 : undefined}
        style={{
          border: `1.5px solid ${C.line}`,
          borderRadius: 8,
          padding: "9px 12px",
          ...fontBody,
          fontSize: 13,
          color: C.charcoal,
          background: C.white,
          width: "100%",
          resize: multiline ? "vertical" : "none",
        }}
      />
    </div>
  );
}

function ReferNeighbour({ hunterId, hunterName, goBack }) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [propertyNote, setPropertyNote] = useState("");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);

  React.useEffect(() => {
    if (!user || user.role !== "farmer") return;
    apiFetch("/referrals")
      .then((r) => r.json())
      .then(setHistory)
      .catch(() => {});
  }, [sent, user?.role]);

  function submitReferral() {
    if (!name || !contact) {
      setError("Neighbour's name and contact are required.");
      return;
    }
    setSubmitting(true);
    apiFetch("/referrals", {
      method: "POST",
      body: {
        hunter_id: hunterId,
        referred_name: name,
        referred_contact: contact,
        referred_property: propertyNote,
        note,
      },
    })
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then(() => {
        setSent(name);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSubmitting(false));
  }

  if (!user || user.role !== "farmer") {
    return (
      <div style={{ ...fontBody, fontSize: 13, color: C.steel }}>
        Log in as a farmer to send a referral.
      </div>
    );
  }
  if (!hunterId) {
    return (
      <div style={{ ...fontBody, fontSize: 13, color: C.steel }}>
        Pick a hunter from the Farmer dashboard tab first, then refer them from here.
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={goBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: "none",
          color: C.steel,
          ...fontMono,
          fontSize: 11.5,
          cursor: "pointer",
          padding: 0,
          marginBottom: 14,
        }}
      >
        <ChevronLeft size={13} /> BACK
      </button>

      <div style={{ ...fontDisplay, fontSize: 22, color: C.charcoal }}>
        Refer {hunterName} to a neighbour
      </div>
      <div style={{ ...fontBody, fontSize: 13, color: C.steel, marginTop: 2 }}>
        They'll skip straight past the cold-start vetting — your rating and{" "}
        {hunterName.split(" ")[0]}'s credentials travel with the referral.
      </div>

      <Divider />

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <TextField label="NEIGHBOUR'S NAME" value={name} onChange={setName} placeholder="Sarah Whitlock" />
        <TextField
          label="PROPERTY / MOBILE"
          value={contact}
          onChange={setContact}
          placeholder="0455 555 555"
        />
        <TextField
          label="PROPERTY NAME (OPTIONAL)"
          value={propertyNote}
          onChange={setPropertyNote}
          placeholder="High Plains Run, Bonnie Doon"
        />
        <TextField
          label="NOTE (OPTIONAL)"
          value={note}
          onChange={setNote}
          placeholder="Always closes the gates behind him, worth a call."
          multiline
        />
      </div>

      {error && (
        <div style={{ ...fontBody, fontSize: 12.5, color: C.rust, marginTop: 10 }}>{error}</div>
      )}

      <Divider />

      {sent ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: C.eucalyptDeep,
            ...fontBody,
            fontWeight: 600,
            fontSize: 13.5,
          }}
        >
          <Check size={16} /> Referral sent to {sent}
        </div>
      ) : (
        <PrimaryButton icon={Send} full onClick={submitReferral}>
          {submitting ? "Sending…" : "Send referral"}
        </PrimaryButton>
      )}

      <Divider />

      <div style={{ ...fontBody, fontWeight: 600, fontSize: 13, color: C.charcoal, marginBottom: 8 }}>
        Your past referrals
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {history.length === 0 && (
          <span style={{ ...fontBody, fontSize: 12.5, color: C.steel }}>No referrals yet.</span>
        )}
        {history.map((r) => (
          <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ ...fontBody, fontSize: 12.5, color: C.charcoal }}>
              {r.hunter_name} → {r.referred_property || r.referred_name}
            </span>
            <Pill tone={r.status === "signed_up" ? "mist" : "gold"}>
              {r.status === "signed_up" ? "SIGNED UP" : "SENT"}
            </Pill>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   SCREEN 9 — EDIT PROPERTY (farmer updates their own listing)
--------------------------------------------------------- */
function EditProperty({ goBack, onSaved }) {
  const { user, updateProperty } = useAuth();
  const myProperty = user?.properties?.[0];

  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [picCode, setPicCode] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [planNumber, setPlanNumber] = useState("");
  const [address, setAddress] = useState("");
  const [suburb, setSuburb] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [sizeHa, setSizeHa] = useState("");
  const [accessNotes, setAccessNotes] = useState("");
  const [permittedHours, setPermittedHours] = useState("");
  const [allowSpotlighting, setAllowSpotlighting] = useState(false);
  const [geofenceRadiusM, setGeofenceRadiusM] = useState("1000");
  const [ownershipDocumentUrl, setOwnershipDocumentUrl] = useState("");
  const [verificationStatus, setVerificationStatus] = useState("pending");
  const [noGoZones, setNoGoZones] = useState([]);
  const [species, setSpecies] = useState({});
  const [speciesOptions, setSpeciesOptions] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);

  const speciesByValue = React.useMemo(
    () => Object.fromEntries(speciesOptions.map((s) => [s.value, s])),
    [speciesOptions]
  );

  React.useEffect(() => {
    apiFetch("/species")
      .then((r) => (r.ok ? r.json() : []))
      .then(setSpeciesOptions)
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    if (!myProperty) return;
    apiFetch(`/properties/${myProperty.id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Could not load property");
        return r.json();
      })
      .then((p) => {
        setName(p.name || "");
        setPicCode(p.pic_code || "");
        setLotNumber(p.lot_number || "");
        setPlanNumber(p.plan_number || "");
        setAddress(p.address || "");
        setSuburb(p.suburb || "");
        setLatitude(String(p.latitude ?? ""));
        setLongitude(String(p.longitude ?? ""));
        setSizeHa(p.size_hectares != null ? String(p.size_hectares) : "");
        setAccessNotes(p.access_notes || "");
        setPermittedHours(p.permitted_hours || "");
        setAllowSpotlighting(!!p.allow_spotlighting);
        setGeofenceRadiusM(p.geofence_radius_m != null ? String(p.geofence_radius_m) : "1000");
        setOwnershipDocumentUrl(p.ownership_document_url || "");
        setVerificationStatus(p.verification_status || "pending");
        setNoGoZones((p.no_go_zones || []).map((z) => ({ label: z.label, description: z.description || "" })));
        const speciesInit = {};
        (p.species || []).forEach((s) => {
          speciesInit[s.species] = {
            checked: true,
            other_description: s.other_description || "",
            atcw_document_url: s.atcw_document_url || "",
            atcw_remaining_quantity: s.atcw_remaining_quantity != null ? String(s.atcw_remaining_quantity) : "",
            atcw_expiry_date: s.atcw_expiry_date || "",
          };
        });
        setSpecies(speciesInit);
        setLoaded(true);
        setLoadError(null);
      })
      .catch((e) => setLoadError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myProperty?.id]);

  function updateZone(index, field, value) {
    setNoGoZones((prev) => prev.map((z, i) => (i === index ? { ...z, [field]: value } : z)));
  }
  function addZone() {
    setNoGoZones((prev) => [...prev, { label: "", description: "" }]);
  }
  function removeZone(index) {
    setNoGoZones((prev) => prev.filter((_, i) => i !== index));
  }

  function toggleSpecies(value) {
    setSpecies((prev) => ({
      ...prev,
      [value]: {
        other_description: "",
        atcw_document_url: "",
        atcw_remaining_quantity: "",
        atcw_expiry_date: "",
        ...prev[value],
        checked: !prev[value]?.checked,
      },
    }));
  }
  function updateSpeciesField(value, field, fieldValue) {
    setSpecies((prev) => ({ ...prev, [value]: { ...prev[value], [field]: fieldValue } }));
  }

  function save() {
    if (!name || !picCode || !latitude || !longitude) {
      setSaveError("Name, PIC, latitude and longitude are required.");
      return;
    }
    const checkedSpecies = Object.entries(species).filter(([, v]) => v.checked);
    const missingAtcw = checkedSpecies.find(
      ([value, v]) =>
        speciesByValue[value]?.requires_atcw &&
        (!v.atcw_document_url || !v.atcw_remaining_quantity || !v.atcw_expiry_date)
    );
    if (missingAtcw) {
      setSaveError(
        `${speciesByValue[missingAtcw[0]]?.label || missingAtcw[0]} needs a document link, remaining quantity and expiry date.`
      );
      return;
    }
    setSaving(true);
    setSaveError(null);
    apiFetch(`/properties/${myProperty.id}`, {
      method: "PATCH",
      body: {
        name, pic_code: picCode,
        lot_number: lotNumber, plan_number: planNumber,
        address, suburb,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        size_hectares: sizeHa ? parseFloat(sizeHa) : null,
        access_notes: accessNotes,
        permitted_hours: permittedHours,
        allow_spotlighting: allowSpotlighting,
        geofence_radius_m: parseInt(geofenceRadiusM, 10) || 1000,
        ownership_document_url: ownershipDocumentUrl,
        no_go_zones: noGoZones.filter((z) => z.label),
        species: checkedSpecies.map(([value, v]) => ({
          species: value,
          other_description: speciesByValue[value]?.is_other ? v.other_description : null,
          atcw_document_url: speciesByValue[value]?.requires_atcw ? v.atcw_document_url : null,
          atcw_remaining_quantity: speciesByValue[value]?.requires_atcw
            ? parseInt(v.atcw_remaining_quantity, 10) || null
            : null,
          atcw_expiry_date: speciesByValue[value]?.requires_atcw ? v.atcw_expiry_date : null,
        })),
      },
    })
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then((updated) => {
        setSaved(true);
        setVerificationStatus(updated.verification_status || "pending");
        updateProperty(updated);
        if (onSaved) onSaved(updated);
      })
      .catch((e) => setSaveError(e.message))
      .finally(() => setSaving(false));
  }

  if (!user || user.role !== "farmer") {
    return (
      <div style={{ ...fontBody, fontSize: 13, color: C.steel }}>
        Log in as a farmer to edit a property.
      </div>
    );
  }
  if (!myProperty) {
    return (
      <div style={{ ...fontBody, fontSize: 13, color: C.steel }}>
        You haven't listed a property yet.
      </div>
    );
  }
  if (loadError) {
    return <div style={{ ...fontBody, fontSize: 13, color: C.rust }}>{loadError}</div>;
  }
  if (!loaded) {
    return <div style={{ ...fontMono, fontSize: 12, color: C.steel }}>Loading…</div>;
  }

  if (saved) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.eucalyptDeep }}>
          <Check size={18} />
          <span style={{ ...fontBody, fontWeight: 700, fontSize: 15 }}>Property updated</span>
        </div>
        <div style={{ marginTop: 14 }}>
          <PrimaryButton full onClick={goBack}>Back to dashboard</PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={goBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: "none",
          color: C.steel,
          ...fontMono,
          fontSize: 11.5,
          cursor: "pointer",
          padding: 0,
          marginBottom: 14,
        }}
      >
        <ChevronLeft size={13} /> BACK TO DASHBOARD
      </button>

      <div style={{ ...fontDisplay, fontSize: 22, color: C.charcoal }}>Edit property details</div>

      <Divider />
      <SectionLabel>Property details</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <TextField label="PROPERTY NAME" value={name} onChange={setName} />
        <TextField label="PIC CODE" value={picCode} onChange={setPicCode} />
        <div className="muster-two-col">
          <div style={{ flex: 1 }}>
            <TextField label="LOT NUMBER" value={lotNumber} onChange={setLotNumber} placeholder="1" />
          </div>
          <div style={{ flex: 1 }}>
            <TextField label="PLAN NUMBER" value={planNumber} onChange={setPlanNumber} placeholder="PS123456" />
          </div>
        </div>
        <TextField label="ADDRESS" value={address} onChange={setAddress} />
        <TextField label="SUBURB" value={suburb} onChange={setSuburb} />
        <div className="muster-two-col">
          <div style={{ flex: 1 }}>
            <TextField label="LATITUDE" value={latitude} onChange={setLatitude} />
          </div>
          <div style={{ flex: 1 }}>
            <TextField label="LONGITUDE" value={longitude} onChange={setLongitude} />
          </div>
        </div>
        <TextField label="SIZE (HECTARES)" value={sizeHa} onChange={setSizeHa} />
        <TextField label="PERMITTED HOURS" value={permittedHours} onChange={setPermittedHours} />
        <TextField label="ACCESS NOTES" value={accessNotes} onChange={setAccessNotes} multiline />
        <Checkbox
          label="Spotlighting permitted at night"
          checked={allowSpotlighting}
          onChange={setAllowSpotlighting}
        />
        <TextField
          label="CHECK-IN RADIUS (METRES)"
          value={geofenceRadiusM}
          onChange={setGeofenceRadiusM}
          placeholder="1000"
          type="number"
        />
        <div style={{ ...fontBody, fontSize: 11.5, color: C.steel }}>
          How close a hunter's check-in/out needs to be to count as on-site, for bookings where you've
          required geofenced check-in.
        </div>
      </div>

      <Divider />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <SectionLabel>Ownership verification</SectionLabel>
        <EarTag
          label="OWNERSHIP"
          status={
            verificationStatus === "verified"
              ? "verified"
              : verificationStatus === "rejected"
              ? "missing"
              : "warning"
          }
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <TextField
          label="PROOF OF OWNERSHIP DOCUMENT URL"
          value={ownershipDocumentUrl}
          onChange={setOwnershipDocumentUrl}
          placeholder="Link to a rates notice or title, e.g. a Drive share link"
        />
        <div style={{ ...fontBody, fontSize: 11.5, color: C.steel }}>
          {verificationStatus === "verified"
            ? "An admin has verified this document."
            : verificationStatus === "rejected"
            ? "An admin rejected the last document — update the link and save to resubmit for review."
            : "Awaiting admin review. Changing this link resubmits it for review."}
        </div>
      </div>

      <Divider />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <SectionLabel>No-go zones</SectionLabel>
        <GhostButton onClick={addZone}>+ Add zone</GhostButton>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {noGoZones.length === 0 && (
          <div style={{ ...fontBody, fontSize: 12, color: C.steel }}>None on file.</div>
        )}
        {noGoZones.map((z, i) => (
          <div key={i} style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ ...fontMono, fontSize: 10, color: C.steel }}>ZONE {i + 1}</span>
              <button
                onClick={() => removeZone(i)}
                style={{ background: "none", border: "none", color: C.rust, ...fontMono, fontSize: 10, cursor: "pointer" }}
              >
                REMOVE
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <TextField label="LABEL" value={z.label} onChange={(v) => updateZone(i, "label", v)} placeholder="House paddock" />
              <TextField
                label="DESCRIPTION"
                value={z.description}
                onChange={(v) => updateZone(i, "description", v)}
                placeholder="Excludes house paddock and dam frontage"
              />
            </div>
          </div>
        ))}
      </div>

      <Divider />
      <SectionLabel>Species permitted on this property</SectionLabel>
      <div style={{ ...fontBody, fontSize: 12, color: C.steel, marginBottom: 10 }}>
        Species marked ATCW need a current Authority to Control Wildlife permit on file, with how
        many tags are left and when it expires.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {speciesOptions.length === 0 && (
          <div style={{ ...fontBody, fontSize: 12, color: C.steel }}>Loading species…</div>
        )}
        {speciesOptions.map((s) => {
          const entry = species[s.value] || {};
          return (
            <div key={s.value}>
              <Checkbox
                label={
                  s.requires_atcw ? (
                    <>
                      {s.label} <Pill tone="gold">ATCW</Pill>
                    </>
                  ) : (
                    s.label
                  )
                }
                checked={!!entry.checked}
                onChange={() => toggleSpecies(s.value)}
              />
              {entry.checked && s.is_other && (
                <div style={{ marginTop: 8, marginLeft: 24 }}>
                  <TextField
                    label="DESCRIBE"
                    value={entry.other_description || ""}
                    onChange={(v) => updateSpeciesField(s.value, "other_description", v)}
                    placeholder="e.g. Feral goat"
                  />
                </div>
              )}
              {entry.checked && s.requires_atcw && (
                <div style={{ marginTop: 8, marginLeft: 24, display: "flex", flexDirection: "column", gap: 8 }}>
                  <TextField
                    label="ATCW DOCUMENT URL"
                    value={entry.atcw_document_url || ""}
                    onChange={(v) => updateSpeciesField(s.value, "atcw_document_url", v)}
                    placeholder="Link to the permit, e.g. a Drive share link"
                  />
                  <div className="muster-two-col">
                    <TextField
                      label="REMAINING QUANTITY"
                      value={entry.atcw_remaining_quantity || ""}
                      onChange={(v) => updateSpeciesField(s.value, "atcw_remaining_quantity", v)}
                      placeholder="40"
                      type="number"
                    />
                    <TextField
                      label="EXPIRY DATE"
                      value={entry.atcw_expiry_date || ""}
                      onChange={(v) => updateSpeciesField(s.value, "atcw_expiry_date", v)}
                      placeholder="YYYY-MM-DD"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {saveError && <div style={{ ...fontBody, fontSize: 12.5, color: C.rust, marginTop: 10 }}>{saveError}</div>}

      <Divider />
      <PrimaryButton full onClick={save}>
        {saving ? "Saving…" : "Save changes"}
      </PrimaryButton>
    </div>
  );
}

/* ---------------------------------------------------------
   SCREEN 5 — FARMER SIGN-UP (add farmer + property)
--------------------------------------------------------- */
function FarmerSignup({ goDashboard, goBack }) {
  const { login } = useAuth();
  const [farmerName, setFarmerName] = useState("");
  const [farmerEmail, setFarmerEmail] = useState("");
  const [farmerPhone, setFarmerPhone] = useState("");
  const [password, setPassword] = useState("");
  const [propertyName, setPropertyName] = useState("");
  const [picCode, setPicCode] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [planNumber, setPlanNumber] = useState("");
  const [address, setAddress] = useState("");
  const [suburb, setSuburb] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [sizeHa, setSizeHa] = useState("");
  const [accessNotes, setAccessNotes] = useState("");
  const [permittedHours, setPermittedHours] = useState("");
  const [allowSpotlighting, setAllowSpotlighting] = useState(false);
  const [ownershipDocumentUrl, setOwnershipDocumentUrl] = useState("");
  const [noGoLabel, setNoGoLabel] = useState("");
  const [noGoDescription, setNoGoDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  function submit() {
    if (!farmerName || !farmerEmail || !password || !propertyName || !picCode || !latitude || !longitude) {
      setError("Name, email, password, property name, PIC and coordinates are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    apiFetch("/auth/farmer/register", {
      method: "POST",
      body: { name: farmerName, email: farmerEmail, phone: farmerPhone, password },
    })
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then(({ user }) =>
        apiFetch("/properties", {
          method: "POST",
          body: {
            name: propertyName,
            pic_code: picCode,
            lot_number: lotNumber,
            plan_number: planNumber,
            address, suburb,
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            size_hectares: sizeHa ? parseFloat(sizeHa) : null,
            access_notes: accessNotes,
            permitted_hours: permittedHours,
            allow_spotlighting: allowSpotlighting,
            ownership_document_url: ownershipDocumentUrl,
            no_go_zones: noGoLabel ? [{ label: noGoLabel, description: noGoDescription }] : [],
          },
        }).then((r) => {
          if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
          return r.json();
        }).then((property) => ({ user, property }))
      )
      .then(({ user, property }) => {
        login({ ...user, properties: [property] });
        setDone(property);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSubmitting(false));
  }

  if (done) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.eucalyptDeep }}>
          <Check size={18} />
          <span style={{ ...fontBody, fontWeight: 700, fontSize: 15 }}>Account created & property listed</span>
        </div>
        <div style={{ ...fontBody, fontSize: 13, color: C.bark, marginTop: 6 }}>
          {done.name} (PIC {done.pic_code}) is now live and you're logged in.
        </div>
        <div style={{ marginTop: 14 }}>
          <PrimaryButton full onClick={goDashboard}>Go to your dashboard</PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div>
      {goBack && (
        <button
          onClick={goBack}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: "none",
            border: "none",
            padding: 0,
            marginBottom: 12,
            ...fontMono,
            fontSize: 10.5,
            color: C.steel,
            cursor: "pointer",
          }}
        >
          <ChevronLeft size={12} /> BACK
        </button>
      )}
      <div style={{ ...fontDisplay, fontSize: 22, color: C.charcoal }}>List a property</div>
      <div style={{ ...fontBody, fontSize: 13, color: C.steel, marginTop: 2 }}>
        For farmers — tell us about you and the property.
      </div>

      <Divider />
      <SectionLabel>Your details</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <TextField label="FULL NAME" value={farmerName} onChange={setFarmerName} placeholder="Nathan Hambly" />
        <TextField label="EMAIL" value={farmerEmail} onChange={setFarmerEmail} placeholder="you@example.com" />
        <TextField label="MOBILE" value={farmerPhone} onChange={setFarmerPhone} placeholder="0400 000 000" />
        <TextField label="PASSWORD" value={password} onChange={setPassword} placeholder="At least 8 characters" type="password" />
      </div>

      <Divider />
      <SectionLabel>Property details</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <TextField label="PROPERTY NAME" value={propertyName} onChange={setPropertyName} placeholder="Riverbend" />
        <TextField label="PIC CODE" value={picCode} onChange={setPicCode} placeholder="3TR00412" />
        <div className="muster-two-col">
          <div style={{ flex: 1 }}>
            <TextField label="LOT NUMBER" value={lotNumber} onChange={setLotNumber} placeholder="1" />
          </div>
          <div style={{ flex: 1 }}>
            <TextField label="PLAN NUMBER" value={planNumber} onChange={setPlanNumber} placeholder="PS123456" />
          </div>
        </div>
        <div style={{ ...fontBody, fontSize: 11.5, color: C.steel, marginTop: -4 }}>
          Optional, but recommended — lets us pull the exact registered parcel boundary from Victoria's
          VicPlan data instead of relying on coordinates alone. Find these on your Certificate of Title
          or Land Tax Assessment.
        </div>
        <TextField label="ADDRESS" value={address} onChange={setAddress} placeholder="1420 Mansfield-Woods Point Rd" />
        <TextField label="SUBURB" value={suburb} onChange={setSuburb} placeholder="Mansfield" />
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <TextField label="LATITUDE" value={latitude} onChange={setLatitude} placeholder="-37.0503" />
          </div>
          <div style={{ flex: 1 }}>
            <TextField label="LONGITUDE" value={longitude} onChange={setLongitude} placeholder="146.0888" />
          </div>
        </div>
        <TextField label="SIZE (HECTARES)" value={sizeHa} onChange={setSizeHa} placeholder="412" />
        <TextField
          label="PERMITTED HOURS"
          value={permittedHours}
          onChange={setPermittedHours}
          placeholder="05:30-09:00,16:00-dusk"
        />
        <TextField
          label="ACCESS NOTES"
          value={accessNotes}
          onChange={setAccessNotes}
          placeholder="Gate code, track conditions, where to park"
          multiline
        />
        <Checkbox
          label="Spotlighting permitted at night"
          checked={allowSpotlighting}
          onChange={setAllowSpotlighting}
        />
        <TextField
          label="PROOF OF OWNERSHIP DOCUMENT URL (OPTIONAL)"
          value={ownershipDocumentUrl}
          onChange={setOwnershipDocumentUrl}
          placeholder="Link to a rates notice or title, e.g. a Drive share link"
        />
        <div style={{ ...fontBody, fontSize: 11.5, color: C.steel }}>
          An admin reviews this to verify you're the owner or manager of this property. You can add
          or update it later from Edit property if you skip it now.
        </div>
      </div>

      <Divider />
      <SectionLabel>No-go zone (optional — add more later)</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <TextField label="ZONE LABEL" value={noGoLabel} onChange={setNoGoLabel} placeholder="House paddock" />
        <TextField
          label="DESCRIPTION"
          value={noGoDescription}
          onChange={setNoGoDescription}
          placeholder="Excludes house paddock and dam frontage"
        />
      </div>

      {error && <div style={{ ...fontBody, fontSize: 12.5, color: C.rust, marginTop: 10 }}>{error}</div>}

      <Divider />
      <PrimaryButton icon={Send} full onClick={submit}>
        {submitting ? "Submitting…" : "List this property"}
      </PrimaryButton>
    </div>
  );
}

/* ---------------------------------------------------------
   SCREEN 6 — HUNTER SIGN-UP (profile + credentials)
--------------------------------------------------------- */
function HunterSignup({ goBookings, goBack }) {
  const { login } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [bio, setBio] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [thermal, setThermal] = useState(false);
  const [suppressed, setSuppressed] = useState(false);
  const [credValues, setCredValues] = useState(
    Object.fromEntries(CREDENTIAL_TYPES.map((c) => [c.value, { reference_number: "", expiry_date: "" }]))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  function updateCred(type, field, value) {
    setCredValues((prev) => ({ ...prev, [type]: { ...prev[type], [field]: value } }));
  }

  function submit() {
    if (!name || !email || !password || !latitude || !longitude) {
      setError("Name, email, password and coordinates are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const credentials = CREDENTIAL_TYPES.map((c) => ({
      credential_type: c.value,
      reference_number: credValues[c.value].reference_number,
      expiry_date: credValues[c.value].expiry_date,
    })).filter((c) => c.reference_number);

    apiFetch("/auth/hunter/register", {
      method: "POST",
      body: {
        name, email, phone, password, bio,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        thermal_capable: thermal,
        suppressed_capable: suppressed,
        credentials,
      },
    })
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then(({ user }) => {
        login(user);
        setDone(user);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSubmitting(false));
  }

  if (done) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.eucalyptDeep }}>
          <Check size={18} />
          <span style={{ ...fontBody, fontWeight: 700, fontSize: 15 }}>Account created</span>
        </div>
        <div style={{ ...fontBody, fontSize: 13, color: C.bark, marginTop: 6 }}>
          {done.name}'s profile is created and you're logged in, but not yet visible to
          farmers — new hunters start inactive until an admin verifies the credentials
          submitted. Once verified, you'll appear in nearby farmers' matches automatically.
        </div>
        <div style={{ marginTop: 14 }}>
          <PrimaryButton full onClick={goBookings}>Go to your bookings</PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div>
      {goBack && (
        <button
          onClick={goBack}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: "none",
            border: "none",
            padding: 0,
            marginBottom: 12,
            ...fontMono,
            fontSize: 10.5,
            color: C.steel,
            cursor: "pointer",
          }}
        >
          <ChevronLeft size={12} /> BACK
        </button>
      )}
      <div style={{ ...fontDisplay, fontSize: 22, color: C.charcoal }}>Hunter sign-up</div>
      <div style={{ ...fontBody, fontSize: 13, color: C.steel, marginTop: 2 }}>
        For professional hunters — your profile and credentials will be reviewed
        before you appear in farmer matches.
      </div>

      <Divider />
      <SectionLabel>Your details</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <TextField label="FULL NAME" value={name} onChange={setName} placeholder="Tom Riordan" />
        <TextField label="EMAIL" value={email} onChange={setEmail} placeholder="you@example.com" />
        <TextField label="MOBILE" value={phone} onChange={setPhone} placeholder="0400 000 000" />
        <TextField label="PASSWORD" value={password} onChange={setPassword} placeholder="At least 8 characters" type="password" />
        <TextField label="BIO" value={bio} onChange={setBio} placeholder="Experience, region, rig details…" multiline />
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <TextField label="BASE LATITUDE" value={latitude} onChange={setLatitude} placeholder="-37.00" />
          </div>
          <div style={{ flex: 1 }}>
            <TextField label="BASE LONGITUDE" value={longitude} onChange={setLongitude} placeholder="146.05" />
          </div>
        </div>
        <Checkbox label="Fully thermal equipped" checked={thermal} onChange={setThermal} />
        <Checkbox label="Suppressed (requires a valid permit below)" checked={suppressed} onChange={setSuppressed} />
      </div>

      <Divider />
      <SectionLabel>Credentials</SectionLabel>
      <div style={{ ...fontBody, fontSize: 12, color: C.steel, marginBottom: 10 }}>
        Enter what you have now — reference number and expiry. Anything left blank can be
        added later from your profile. Nothing goes live until an admin sights and verifies it.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {CREDENTIAL_TYPES.map((c) => (
          <div key={c.value}>
            <div style={{ ...fontBody, fontWeight: 600, fontSize: 12.5, color: C.charcoal, marginBottom: 6 }}>
              {c.label}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 2 }}>
                <TextField
                  label="REFERENCE / LICENCE No."
                  value={credValues[c.value].reference_number}
                  onChange={(v) => updateCred(c.value, "reference_number", v)}
                  placeholder="e.g. PS-22841"
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="EXPIRY"
                  value={credValues[c.value].expiry_date}
                  onChange={(v) => updateCred(c.value, "expiry_date", v)}
                  placeholder="YYYY-MM-DD"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {error && <div style={{ ...fontBody, fontSize: 12.5, color: C.rust, marginTop: 10 }}>{error}</div>}

      <Divider />
      <PrimaryButton icon={Send} full onClick={submit}>
        {submitting ? "Submitting…" : "Submit profile for review"}
      </PrimaryButton>
    </div>
  );
}

/* ---------------------------------------------------------
   HUNTER CREDENTIALS — a hunter's own "My credentials" screen.
   The sign-up form already promises "anything left blank can be
   added later from your profile" — this is that later. Every
   save resets that credential to pending until an admin
   re-verifies it (POST /api/hunters/:id/credentials).
--------------------------------------------------------- */
function HunterCredentials() {
  const { user } = useAuth();
  const [credentials, setCredentials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [savingType, setSavingType] = useState(null);
  const [savedType, setSavedType] = useState(null);

  function loadCredentials() {
    setLoading(true);
    apiFetch("/me")
      .then((r) => {
        if (!r.ok) throw new Error("Could not load your credentials");
        return r.json();
      })
      .then((data) => {
        setCredentials(data.credentials || []);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  React.useEffect(() => {
    if (!user || user.role !== "hunter") {
      setLoading(false);
      return;
    }
    loadCredentials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  function draftFor(type) {
    if (drafts[type]) return drafts[type];
    const existing = credentials.find((c) => c.credential_type === type);
    return {
      reference_number: existing?.reference_number || "",
      issuer: existing?.issuer || "",
      issued_date: existing?.issued_date || "",
      expiry_date: existing?.expiry_date || "",
      document_url: existing?.document_url || "",
    };
  }

  function updateDraft(type, field, value) {
    setDrafts((prev) => ({ ...prev, [type]: { ...draftFor(type), [field]: value } }));
  }

  function save(type) {
    const draft = draftFor(type);
    if (!draft.reference_number) {
      setError("A reference/licence number is required to save a credential.");
      return;
    }
    setSavingType(type);
    setError(null);
    apiFetch(`/hunters/${user.id}/credentials`, {
      method: "POST",
      body: { credential_type: type, ...draft },
    })
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then((updated) => {
        setCredentials(updated);
        setDrafts((prev) => ({ ...prev, [type]: undefined }));
        setSavedType(type);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSavingType(null));
  }

  if (!user) {
    return (
      <div style={{ ...fontBody, fontSize: 13, color: C.steel }}>
        Log in as a hunter to manage your credentials.
      </div>
    );
  }
  if (user.role !== "hunter") {
    return (
      <div style={{ ...fontBody, fontSize: 13, color: C.steel }}>
        This screen is for hunter accounts. You're logged in as a farmer.
      </div>
    );
  }
  if (loading) {
    return <div style={{ ...fontMono, fontSize: 12, color: C.steel }}>Loading your credentials…</div>;
  }

  return (
    <div>
      <div style={{ ...fontDisplay, fontSize: 22, color: C.charcoal }}>My credentials</div>
      <div style={{ ...fontBody, fontSize: 13, color: C.steel, marginTop: 2 }}>
        Add or update a reference number, issuer and dates. Saving resets that credential to
        pending until an admin re-verifies it.
      </div>

      <Divider />

      {error && (
        <div style={{ ...fontBody, fontSize: 12.5, color: C.rust, marginBottom: 10 }}>{error}</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {CREDENTIAL_TYPES.map((c) => {
          const existing = credentials.find((cr) => cr.credential_type === c.value);
          const draft = draftFor(c.value);
          return (
            <div key={c.value}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <div style={{ ...fontBody, fontWeight: 600, fontSize: 12.5, color: C.charcoal }}>
                  {c.label}
                </div>
                {existing ? (
                  <EarTag
                    label={existing.status.toUpperCase()}
                    status={
                      existing.status === "expired" || existing.status === "rejected"
                        ? "missing"
                        : existing.status === "pending"
                        ? "warning"
                        : existing.status
                    }
                  />
                ) : (
                  <span style={{ ...fontMono, fontSize: 10, color: C.steel }}>NOT ON FILE</span>
                )}
              </div>
              <div className="muster-two-col">
                <TextField
                  label="REFERENCE / LICENCE No."
                  value={draft.reference_number}
                  onChange={(v) => updateDraft(c.value, "reference_number", v)}
                  placeholder="e.g. PS-22841"
                />
                <TextField
                  label="ISSUER"
                  value={draft.issuer}
                  onChange={(v) => updateDraft(c.value, "issuer", v)}
                  placeholder="e.g. PrimeSafe"
                />
              </div>
              <div className="muster-two-col" style={{ marginTop: 8 }}>
                <TextField
                  label="ISSUED"
                  value={draft.issued_date}
                  onChange={(v) => updateDraft(c.value, "issued_date", v)}
                  placeholder="YYYY-MM-DD"
                />
                <TextField
                  label="EXPIRY"
                  value={draft.expiry_date}
                  onChange={(v) => updateDraft(c.value, "expiry_date", v)}
                  placeholder="YYYY-MM-DD"
                />
              </div>
              <div style={{ marginTop: 8 }}>
                <TextField
                  label="DOCUMENT URL (OPTIONAL)"
                  value={draft.document_url}
                  onChange={(v) => updateDraft(c.value, "document_url", v)}
                  placeholder="Link to a scan/photo of the certificate, e.g. a Drive share link"
                />
              </div>
              <div style={{ marginTop: 8 }}>
                <GhostButton icon={FileText} onClick={() => save(c.value)}>
                  {savingType === c.value ? "Saving…" : savedType === c.value ? "Saved ✓" : existing ? "Update" : "Add"}
                </GhostButton>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   SCREEN 8 — ADMIN: credential verification
   A real admin login (username + password, its own httpOnly
   session cookie — see requireAdminAuth in /server/auth.js),
   entirely separate from the farmer/hunter session so an admin
   can be logged in independently of (or alongside) one.
--------------------------------------------------------- */
function AdminPanel() {
  const [adminUser, setAdminUser] = useState(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [hunters, setHunters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [news, setNews] = useState([]);
  const [newsTitle, setNewsTitle] = useState("");
  const [newsBody, setNewsBody] = useState("");
  const [newsAudience, setNewsAudience] = useState("both");
  const [postingNews, setPostingNews] = useState(false);
  const [newsError, setNewsError] = useState(null);
  const [species, setSpecies] = useState([]);
  const [newSpeciesLabel, setNewSpeciesLabel] = useState("");
  const [newSpeciesAtcw, setNewSpeciesAtcw] = useState(false);
  const [addingSpecies, setAddingSpecies] = useState(false);
  const [speciesError, setSpeciesError] = useState(null);

  function loadSpecies() {
    apiFetch("/admin/species")
      .then((r) => r.json())
      .then(setSpecies)
      .catch(() => {});
  }

  function addSpecies() {
    if (!newSpeciesLabel.trim()) {
      setSpeciesError("A label is required.");
      return;
    }
    setAddingSpecies(true);
    setSpeciesError(null);
    apiFetch("/admin/species", {
      method: "POST",
      body: { label: newSpeciesLabel, requires_atcw: newSpeciesAtcw },
    })
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then(() => {
        setNewSpeciesLabel("");
        setNewSpeciesAtcw(false);
        loadSpecies();
      })
      .catch((e) => setSpeciesError(e.message))
      .finally(() => setAddingSpecies(false));
  }

  function toggleSpeciesActive(s) {
    apiFetch(`/admin/species/${s.id}`, {
      method: "PATCH",
      body: { is_active: !s.is_active },
    })
      .then((r) => r.json())
      .then(loadSpecies);
  }

  function toggleSpeciesAtcw(s) {
    apiFetch(`/admin/species/${s.id}`, {
      method: "PATCH",
      body: { requires_atcw: !s.requires_atcw },
    })
      .then((r) => r.json())
      .then(loadSpecies);
  }

  function deleteSpecies(s) {
    setSpeciesError(null);
    apiFetch(`/admin/species/${s.id}`, { method: "DELETE" })
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then(loadSpecies)
      .catch((e) => setSpeciesError(e.message));
  }

  const [properties, setProperties] = useState([]);
  const [propertiesError, setPropertiesError] = useState(null);
  const [confirmDeletePropertyId, setConfirmDeletePropertyId] = useState(null);

  function loadProperties() {
    apiFetch("/admin/properties")
      .then((r) => r.json())
      .then(setProperties)
      .catch(() => {});
  }

  function deleteProperty(id) {
    setPropertiesError(null);
    apiFetch(`/admin/properties/${id}`, { method: "DELETE" })
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then(() => {
        setConfirmDeletePropertyId(null);
        loadProperties();
      })
      .catch((e) => setPropertiesError(e.message));
  }

  function updatePropertyVerification(id, verification_status) {
    setPropertiesError(null);
    apiFetch(`/admin/properties/${id}`, {
      method: "PATCH",
      body: { verification_status },
    })
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then(loadProperties)
      .catch((e) => setPropertiesError(e.message));
  }

  function loadHunters() {
    setLoading(true);
    apiFetch("/admin/hunters")
      .then((r) => {
        if (!r.ok) throw new Error("Could not load hunters");
        return r.json();
      })
      .then((data) => {
        setHunters(data);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  function loadNews() {
    apiFetch("/admin/news")
      .then((r) => r.json())
      .then(setNews)
      .catch(() => {});
  }

  function login() {
    setLoggingIn(true);
    setError(null);
    apiFetch("/auth/admin/login", { method: "POST", body: { username, password } })
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then(({ admin }) => {
        setAdminUser(admin);
        loadHunters();
        loadNews();
        loadSpecies();
        loadProperties();
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoggingIn(false));
  }

  function logout() {
    apiFetch("/auth/admin/logout", { method: "POST" }).finally(() => {
      setAdminUser(null);
      setHunters([]);
      setNews([]);
      setSpecies([]);
      setProperties([]);
      setConfirmDeletePropertyId(null);
      setUsername("");
      setPassword("");
    });
  }

  function postNews() {
    if (!newsTitle || !newsBody) {
      setNewsError("Title and body are required.");
      return;
    }
    setPostingNews(true);
    setNewsError(null);
    apiFetch("/admin/news", {
      method: "POST",
      body: { title: newsTitle, body: newsBody, audience: newsAudience },
    })
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then(() => {
        setNewsTitle("");
        setNewsBody("");
        loadNews();
      })
      .catch((e) => setNewsError(e.message))
      .finally(() => setPostingNews(false));
  }

  function deleteNews(id) {
    apiFetch(`/admin/news/${id}`, { method: "DELETE" }).then(loadNews);
  }

  function updateCredential(hunterId, credentialId, status) {
    apiFetch(`/hunters/${hunterId}`, {
      method: "PATCH",
      body: { credential_id: credentialId, credential_status: status },
    })
      .then((r) => r.json())
      .then(loadHunters);
  }

  function toggleActive(hunterId, nextActive) {
    apiFetch(`/hunters/${hunterId}`, {
      method: "PATCH",
      body: { is_active: nextActive },
    })
      .then((r) => r.json())
      .then(loadHunters);
  }

  if (!adminUser) {
    return (
      <div>
        <div style={{ ...fontDisplay, fontSize: 22, color: C.charcoal }}>Admin</div>
        <div style={{ ...fontBody, fontSize: 13, color: C.steel, marginTop: 2 }}>
          Log in with an admin account to review and verify hunter credentials. Local dev
          default: username <span style={fontMono}>admin</span>, password from{" "}
          <span style={fontMono}>npm run seed</span>'s output.
        </div>
        <Divider />
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <TextField label="USERNAME" value={username} onChange={setUsername} placeholder="admin" />
          <TextField label="PASSWORD" value={password} onChange={setPassword} placeholder="••••••••" type="password" />
        </div>
        {error && <div style={{ ...fontBody, fontSize: 12.5, color: C.rust, marginTop: 10 }}>{error}</div>}
        <div style={{ marginTop: 14 }}>
          <PrimaryButton full onClick={login}>
            {loggingIn ? "Logging in…" : "Log in"}
          </PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ ...fontDisplay, fontSize: 22, color: C.charcoal }}>Admin — hunters</div>
        <div style={{ display: "flex", gap: 8 }}>
          <GhostButton onClick={loadHunters}>{loading ? "…" : "Refresh"}</GhostButton>
          <GhostButton onClick={logout}>Log out</GhostButton>
        </div>
      </div>
      <div style={{ ...fontMono, fontSize: 10.5, color: C.steel, marginTop: 2 }}>
        Logged in as {adminUser.username}
      </div>
      <Divider />
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {hunters.map((h) => (
          <div key={h.id} style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ ...fontBody, fontWeight: 700, fontSize: 14, color: C.charcoal }}>{h.name}</div>
                <div style={{ ...fontMono, fontSize: 10.5, color: C.steel }}>{h.email}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Pill tone={h.is_active ? "mist" : "gold"}>{h.is_active ? "ACTIVE" : "INACTIVE"}</Pill>
                <GhostButton onClick={() => toggleActive(h.id, !h.is_active)}>
                  {h.is_active ? "Deactivate" : "Activate"}
                </GhostButton>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
              {h.credentials.length === 0 && (
                <span style={{ ...fontBody, fontSize: 12, color: C.steel }}>No credentials submitted.</span>
              )}
              {h.credentials.map((c) => (
                <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <EarTag
                      label={CREDENTIAL_LABELS[c.credential_type] || c.credential_type}
                      status={c.status === "expired" || c.status === "rejected" ? "missing" : c.status === "pending" ? "warning" : c.status}
                    />
                    <div style={{ ...fontMono, fontSize: 9.5, color: C.steel, marginTop: 2 }}>
                      #{c.reference_number} {c.expiry_date ? `· expires ${c.expiry_date}` : ""}
                      {c.document_url && (
                        <>
                          {" · "}
                          <a href={c.document_url} target="_blank" rel="noreferrer" style={{ color: C.eucalyptDeep }}>
                            view document ↗
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                  {c.status !== "verified" && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <GhostButton onClick={() => updateCredential(h.id, c.id, "verified")}>Verify</GhostButton>
                      <GhostButton tone="rust" onClick={() => updateCredential(h.id, c.id, "rejected")}>Reject</GhostButton>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Divider />
      <div style={{ ...fontDisplay, fontSize: 20, color: C.charcoal, marginBottom: 4 }}>News</div>
      <div style={{ ...fontBody, fontSize: 12.5, color: C.steel, marginBottom: 12 }}>
        Post an announcement for farmers, hunters, or everyone.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        <TextField label="TITLE" value={newsTitle} onChange={setNewsTitle} placeholder="Season opening reminder" />
        <TextField
          label="BODY"
          value={newsBody}
          onChange={setNewsBody}
          placeholder="Write the announcement…"
          multiline
        />
        <div>
          <div style={{ ...fontMono, fontSize: 10.5, color: C.steel, marginBottom: 4 }}>VISIBLE TO</div>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { value: "both", label: "Everyone" },
              { value: "farmer", label: "Farmers" },
              { value: "hunter", label: "Hunters" },
            ].map((o) => (
              <div
                key={o.value}
                onClick={() => setNewsAudience(o.value)}
                style={{
                  flex: 1,
                  textAlign: "center",
                  padding: "9px 0",
                  borderRadius: 8,
                  cursor: "pointer",
                  border: `1.5px solid ${newsAudience === o.value ? C.eucalyptDeep : C.line}`,
                  background: newsAudience === o.value ? C.mist : "transparent",
                  ...fontMono,
                  fontSize: 11.5,
                  color: C.charcoal,
                }}
              >
                {o.label}
              </div>
            ))}
          </div>
        </div>
        {newsError && <div style={{ ...fontBody, fontSize: 12.5, color: C.rust }}>{newsError}</div>}
        <PrimaryButton icon={Newspaper} onClick={postNews}>
          {postingNews ? "Posting…" : "Post news"}
        </PrimaryButton>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {news.length === 0 && (
          <div style={{ ...fontBody, fontSize: 12, color: C.steel }}>No news posted yet.</div>
        )}
        {news.map((n) => (
          <div key={n.id} style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ ...fontBody, fontWeight: 600, fontSize: 13, color: C.charcoal }}>{n.title}</div>
                <div style={{ ...fontMono, fontSize: 9.5, color: C.steel, marginTop: 2 }}>
                  {n.audience === "both" ? "EVERYONE" : n.audience.toUpperCase()} ·{" "}
                  {new Date(n.created_at).toLocaleDateString("en-AU")}
                </div>
              </div>
              <button
                onClick={() => deleteNews(n.id)}
                style={{ background: "none", border: "none", color: C.rust, cursor: "pointer", padding: 2 }}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div style={{ ...fontBody, fontSize: 12.5, color: C.bark, marginTop: 6, whiteSpace: "pre-wrap" }}>
              {n.body}
            </div>
          </div>
        ))}
      </div>

      <Divider />
      <div style={{ ...fontDisplay, fontSize: 20, color: C.charcoal, marginBottom: 4 }}>Game species</div>
      <div style={{ ...fontBody, fontSize: 12.5, color: C.steel, marginBottom: 12 }}>
        The list of animals farmers can permit on their property. Species flagged ATCW require a
        permit document, tag count and expiry before a farmer can allow them. "Other" is a fixed
        catch-all and can't be removed.
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <TextField
            label="NEW SPECIES LABEL"
            value={newSpeciesLabel}
            onChange={setNewSpeciesLabel}
            placeholder="e.g. Feral Goat"
          />
        </div>
        <div style={{ paddingBottom: 9 }}>
          <Checkbox label="ATCW" checked={newSpeciesAtcw} onChange={setNewSpeciesAtcw} />
        </div>
      </div>
      {speciesError && <div style={{ ...fontBody, fontSize: 12.5, color: C.rust, marginBottom: 8 }}>{speciesError}</div>}
      <div style={{ marginBottom: 16 }}>
        <GhostButton onClick={addSpecies}>{addingSpecies ? "Adding…" : "Add species"}</GhostButton>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {species.map((s) => (
          <div
            key={s.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              border: `1px solid ${C.line}`,
              borderRadius: 8,
              padding: "8px 10px",
              opacity: s.is_active ? 1 : 0.55,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ ...fontBody, fontSize: 13, color: C.charcoal }}>{s.label}</span>
              <span style={{ ...fontMono, fontSize: 9.5, color: C.steel }}>{s.value}</span>
              {!s.is_active && <Pill tone="gold">INACTIVE</Pill>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {!s.is_other && (
                <GhostButton onClick={() => toggleSpeciesAtcw(s)}>
                  {s.requires_atcw ? "ATCW ✓" : "ATCW"}
                </GhostButton>
              )}
              {!s.is_other && (
                <GhostButton onClick={() => toggleSpeciesActive(s)}>
                  {s.is_active ? "Deactivate" : "Activate"}
                </GhostButton>
              )}
              {!s.is_other && (
                <button
                  onClick={() => deleteSpecies(s)}
                  style={{ background: "none", border: "none", color: C.rust, cursor: "pointer", padding: 2 }}
                  title="Delete (only if unused)"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Divider />
      <div style={{ ...fontDisplay, fontSize: 20, color: C.charcoal, marginBottom: 4 }}>Properties</div>
      <div style={{ ...fontBody, fontSize: 12.5, color: C.steel, marginBottom: 12 }}>
        Every listed property, for cleaning up old test or demo listings. Deleting a property
        also removes its species, no-go zones, sightings and any bookings against it.
      </div>
      {propertiesError && (
        <div style={{ ...fontBody, fontSize: 12.5, color: C.rust, marginBottom: 8 }}>{propertiesError}</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {properties.length === 0 && (
          <div style={{ ...fontBody, fontSize: 12, color: C.steel }}>No properties.</div>
        )}
        {properties.map((p) => (
          <div
            key={p.id}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              border: `1px solid ${C.line}`,
              borderRadius: 8,
              padding: "8px 10px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div>
                <div style={{ ...fontBody, fontSize: 13, color: C.charcoal }}>
                  {p.name}{p.suburb ? `, ${p.suburb}` : ""}
                </div>
                <div style={{ ...fontMono, fontSize: 9.5, color: C.steel, marginTop: 2 }}>
                  {p.farmer_name} · {p.farmer_email} · PIC {p.pic_code} · {p.species_count} species ·{" "}
                  {p.booking_count} booking{p.booking_count === 1 ? "" : "s"}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                {confirmDeletePropertyId === p.id ? (
                  <>
                    <GhostButton tone="rust" onClick={() => deleteProperty(p.id)}>Confirm delete</GhostButton>
                    <GhostButton onClick={() => setConfirmDeletePropertyId(null)}>Cancel</GhostButton>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmDeletePropertyId(p.id)}
                    style={{ background: "none", border: "none", color: C.rust, cursor: "pointer", padding: 2 }}
                    title="Delete property"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div>
                <EarTag
                  label="OWNERSHIP"
                  status={
                    p.verification_status === "verified"
                      ? "verified"
                      : p.verification_status === "rejected"
                      ? "missing"
                      : "warning"
                  }
                />
                <div style={{ ...fontMono, fontSize: 9.5, color: C.steel, marginTop: 2 }}>
                  {p.ownership_document_url ? (
                    <a href={p.ownership_document_url} target="_blank" rel="noreferrer" style={{ color: C.eucalyptDeep }}>
                      view document ↗
                    </a>
                  ) : (
                    "no document submitted"
                  )}
                  {p.verified_by_admin && ` · reviewed by ${p.verified_by_admin}`}
                </div>
              </div>
              {p.verification_status !== "verified" && (
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <GhostButton onClick={() => updatePropertyVerification(p.id, "verified")}>Verify</GhostButton>
                  <GhostButton tone="rust" onClick={() => updatePropertyVerification(p.id, "rejected")}>Reject</GhostButton>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   NEWS FEED — farmer/hunter read-only view of admin-posted
   announcements tagged for their role (or 'both').
--------------------------------------------------------- */
function NewsFeed() {
  const { user } = useAuth();
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  React.useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    apiFetch("/news")
      .then((r) => {
        if (!r.ok) throw new Error("Could not load news");
        return r.json();
      })
      .then((data) => {
        setNews(data);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [user?.role]);

  if (!user) {
    return (
      <div style={{ ...fontBody, fontSize: 13, color: C.steel }}>
        Log in to see news for farmers and hunters.
      </div>
    );
  }
  if (loading) {
    return <div style={{ ...fontMono, fontSize: 12, color: C.steel }}>Loading news…</div>;
  }

  return (
    <div>
      <div style={{ ...fontDisplay, fontSize: 22, color: C.charcoal }}>News</div>
      <div style={{ ...fontBody, fontSize: 13, color: C.steel, marginTop: 2 }}>
        Announcements from The Muster team.
      </div>

      <Divider />

      {error && <div style={{ ...fontBody, fontSize: 12.5, color: C.rust, marginBottom: 10 }}>{error}</div>}

      {news.length === 0 && (
        <div style={{ ...fontBody, fontSize: 12.5, color: C.steel }}>No news yet.</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {news.map((n) => (
          <div
            key={n.id}
            style={{ background: C.white, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ ...fontBody, fontWeight: 700, fontSize: 14, color: C.charcoal }}>{n.title}</div>
              <Pill tone={n.audience === "both" ? "mist" : "gold"}>
                {n.audience === "both" ? "EVERYONE" : n.audience.toUpperCase()}
              </Pill>
            </div>
            <div style={{ ...fontMono, fontSize: 10, color: C.steel, marginTop: 2 }}>
              {new Date(n.created_at).toLocaleDateString("en-AU")}
            </div>
            <div style={{ ...fontBody, fontSize: 13, color: C.bark, marginTop: 8, whiteSpace: "pre-wrap" }}>
              {n.body}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   SCREEN 7 — LOG IN (either role)
--------------------------------------------------------- */
function LoginScreen({ onLoggedIn }) {
  const { user, login, updateSelf } = useAuth();
  const [role, setRole] = useState("farmer");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  function submit() {
    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    apiFetch(`/auth/${role}/login`, { method: "POST", body: { email, password } })
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then(({ user: loggedInUser }) => {
        if (loggedInUser.role === "farmer") {
          // pull in their properties for the dashboard
          return apiFetch("/me")
            .then((r) => r.json())
            .then((full) => {
              login(full);
              onLoggedIn(full.role);
            });
        }
        login(loggedInUser);
        onLoggedIn(loggedInUser.role);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSubmitting(false));
  }

  // ---- account self-edit (only reachable once already logged in) ----
  const [acctName, setAcctName] = useState(user?.name || "");
  const [acctEmail, setAcctEmail] = useState(user?.email || "");
  const [acctPhone, setAcctPhone] = useState(user?.phone || "");
  const [acctBio, setAcctBio] = useState(user?.bio || "");
  const [acctLatitude, setAcctLatitude] = useState(user?.latitude != null ? String(user.latitude) : "");
  const [acctLongitude, setAcctLongitude] = useState(user?.longitude != null ? String(user.longitude) : "");
  const [acctThermal, setAcctThermal] = useState(!!user?.thermal_capable);
  const [acctSuppressed, setAcctSuppressed] = useState(!!user?.suppressed_capable);
  const [acctAvailMode, setAcctAvailMode] = useState(user?.availability_mode || "daily");
  const [acctAvailDays, setAcctAvailDays] = useState(
    user?.availability_days ? user.availability_days.split(",").map((d) => d.trim()) : []
  );
  const [acctAvailInterval, setAcctAvailInterval] = useState(
    user?.availability_interval != null ? String(user.availability_interval) : "2"
  );
  const [acctAvailAnchor, setAcctAvailAnchor] = useState(user?.availability_anchor_date || "");
  const [acctEmergencyName, setAcctEmergencyName] = useState(user?.emergency_contact_name || "");
  const [acctEmergencyPhone, setAcctEmergencyPhone] = useState(user?.emergency_contact_phone || "");
  const [acctSosOptIn, setAcctSosOptIn] = useState(!!user?.sos_alert_opt_in);
  const [acctSaving, setAcctSaving] = useState(false);
  const [acctError, setAcctError] = useState(null);
  const [acctSaved, setAcctSaved] = useState(false);

  function toggleAcctDay(day) {
    setAcctAvailDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }

  function saveAccount() {
    setAcctSaving(true);
    setAcctError(null);
    setAcctSaved(false);
    const body = { name: acctName, email: acctEmail, phone: acctPhone };
    if (user.role === "hunter") {
      body.bio = acctBio;
      body.latitude = parseFloat(acctLatitude);
      body.longitude = parseFloat(acctLongitude);
      body.thermal_capable = acctThermal;
      body.suppressed_capable = acctSuppressed;
      body.availability_mode = acctAvailMode;
      body.availability_days = acctAvailMode === "weekly" ? acctAvailDays.join(",") : null;
      body.availability_interval = acctAvailMode === "interval" ? parseInt(acctAvailInterval, 10) || null : null;
      body.availability_anchor_date = acctAvailMode === "interval" ? acctAvailAnchor || null : null;
      body.emergency_contact_name = acctEmergencyName;
      body.emergency_contact_phone = acctEmergencyPhone;
      body.sos_alert_opt_in = acctSosOptIn;
    }
    apiFetch("/me", { method: "PATCH", body })
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then((updated) => {
        updateSelf(updated);
        setAcctSaved(true);
      })
      .catch((e) => setAcctError(e.message))
      .finally(() => setAcctSaving(false));
  }

  if (user) {
    return (
      <div>
        <div style={{ ...fontDisplay, fontSize: 22, color: C.charcoal }}>Account</div>
        <div style={{ ...fontBody, fontSize: 13, color: C.steel, marginTop: 2 }}>
          Logged in as a {user.role}. Update your own account details below.
        </div>

        <Divider />

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <TextField label="NAME" value={acctName} onChange={setAcctName} />
          <TextField label="EMAIL" value={acctEmail} onChange={setAcctEmail} />
          <TextField label="MOBILE" value={acctPhone} onChange={setAcctPhone} />
          {user.role === "hunter" && (
            <>
              <TextField label="BIO" value={acctBio} onChange={setAcctBio} multiline />
              <div className="muster-two-col">
                <TextField label="BASE LATITUDE" value={acctLatitude} onChange={setAcctLatitude} />
                <TextField label="BASE LONGITUDE" value={acctLongitude} onChange={setAcctLongitude} />
              </div>
              <Checkbox label="Fully thermal equipped" checked={acctThermal} onChange={setAcctThermal} />
              <Checkbox
                label="Suppressed (requires a valid permit)"
                checked={acctSuppressed}
                onChange={setAcctSuppressed}
              />
            </>
          )}
        </div>

        {user.role === "hunter" && (
          <>
            <Divider />
            <SectionLabel>Availability — which days will you take bookings?</SectionLabel>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              {AVAILABILITY_MODES.map((m) => (
                <div
                  key={m.value}
                  onClick={() => setAcctAvailMode(m.value)}
                  style={{
                    flex: 1,
                    textAlign: "center",
                    padding: "9px 0",
                    borderRadius: 8,
                    cursor: "pointer",
                    border: `1.5px solid ${acctAvailMode === m.value ? C.eucalyptDeep : C.line}`,
                    background: acctAvailMode === m.value ? C.mist : "transparent",
                    ...fontMono,
                    fontSize: 11.5,
                    color: C.charcoal,
                  }}
                >
                  {m.label}
                </div>
              ))}
            </div>

            {acctAvailMode === "weekly" && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {WEEKDAYS.map((d) => {
                  const active = acctAvailDays.includes(d.value);
                  return (
                    <div
                      key={d.value}
                      onClick={() => toggleAcctDay(d.value)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 8,
                        cursor: "pointer",
                        border: `1.5px solid ${active ? C.eucalyptDeep : C.line}`,
                        background: active ? C.mist : "transparent",
                        ...fontMono,
                        fontSize: 11.5,
                        color: C.charcoal,
                      }}
                    >
                      {d.label}
                    </div>
                  );
                })}
              </div>
            )}

            {acctAvailMode === "interval" && (
              <div className="muster-two-col">
                <TextField
                  label="EVERY N DAYS"
                  value={acctAvailInterval}
                  onChange={setAcctAvailInterval}
                  placeholder="2"
                  type="number"
                />
                <TextField
                  label="STARTING FROM"
                  value={acctAvailAnchor}
                  onChange={setAcctAvailAnchor}
                  placeholder="YYYY-MM-DD"
                />
              </div>
            )}
          </>
        )}

        {user.role === "hunter" && (
          <>
            <Divider />
            <SectionLabel>Live tracking &amp; SOS</SectionLabel>
            <EnableAlertsBanner />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="muster-two-col">
                <TextField
                  label="EMERGENCY CONTACT NAME"
                  value={acctEmergencyName}
                  onChange={setAcctEmergencyName}
                  placeholder="Next of kin or similar"
                />
                <TextField
                  label="EMERGENCY CONTACT PHONE"
                  value={acctEmergencyPhone}
                  onChange={setAcctEmergencyPhone}
                  placeholder="0400 000 000"
                />
              </div>
              <div style={{ ...fontBody, fontSize: 11.5, color: C.steel }}>
                Shown to the farmer during an SOS so they can call — the app itself can't ring or text
                them directly.
              </div>
              <Checkbox
                label="Alert me if another hunter nearby triggers an SOS while I'm tracking"
                checked={acctSosOptIn}
                onChange={setAcctSosOptIn}
              />
            </div>
          </>
        )}

        {acctError && <div style={{ ...fontBody, fontSize: 12.5, color: C.rust, marginTop: 10 }}>{acctError}</div>}
        {acctSaved && !acctError && (
          <div style={{ ...fontBody, fontSize: 12.5, color: C.eucalyptDeep, marginTop: 10 }}>Saved.</div>
        )}

        <Divider />
        <PrimaryButton full onClick={saveAccount}>
          {acctSaving ? "Saving…" : "Save changes"}
        </PrimaryButton>
      </div>
    );
  }

  return (
    <div>
      <div style={{ ...fontDisplay, fontSize: 22, color: C.charcoal }}>Log in</div>
      <div style={{ ...fontBody, fontSize: 13, color: C.steel, marginTop: 2 }}>
        Demo accounts (seeded): nathan@example.com (farmer) or tom@example.com (hunter),
        password "password123".
      </div>

      <Divider />

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {["farmer", "hunter"].map((r) => (
          <div
            key={r}
            onClick={() => setRole(r)}
            style={{
              flex: 1,
              textAlign: "center",
              padding: "9px 0",
              borderRadius: 8,
              cursor: "pointer",
              border: `1.5px solid ${role === r ? C.eucalyptDeep : C.line}`,
              background: role === r ? C.mist : "transparent",
              ...fontMono,
              fontSize: 11.5,
              color: C.charcoal,
              textTransform: "uppercase",
            }}
          >
            {r}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <TextField label="EMAIL" value={email} onChange={setEmail} placeholder="you@example.com" />
        <TextField label="PASSWORD" value={password} onChange={setPassword} placeholder="••••••••" type="password" />
      </div>

      {error && <div style={{ ...fontBody, fontSize: 12.5, color: C.rust, marginTop: 10 }}>{error}</div>}

      <Divider />
      <PrimaryButton full onClick={submit}>
        {submitting ? "Logging in…" : `Log in as ${role}`}
      </PrimaryButton>
    </div>
  );
}

/* ---------------------------------------------------------
   APP SHELL
--------------------------------------------------------- */
function AppShell() {
  const { user, logout } = useAuth();
  const [screen, setScreen] = useState(user ? "dashboard" : "landing");
  const [selectedHunterId, setSelectedHunterId] = useState(null);
  const [selectedHunterName, setSelectedHunterName] = useState(null);
  const [selectedBookingId, setSelectedBookingId] = useState(null);
  const [selectedBookingParty, setSelectedBookingParty] = useState(null);
  const [messagesReturnScreen, setMessagesReturnScreen] = useState("booking");
  const [trackingBooking, setTrackingBooking] = useState(null);
  const [trackingViewSessionId, setTrackingViewSessionId] = useState(null);

  function openProfile(id, name) {
    setSelectedHunterId(id);
    if (name) setSelectedHunterName(name);
    setScreen("profile");
  }

  function openMessages(bookingId, otherPartyName, returnScreen = "booking") {
    setSelectedBookingId(bookingId);
    setSelectedBookingParty(otherPartyName);
    setMessagesReturnScreen(returnScreen);
    setScreen("messages");
  }

  function openLiveTracker(booking) {
    setTrackingBooking(booking);
    setScreen("liveTracker");
  }

  function openTrackingView(sessionId) {
    setTrackingViewSessionId(sessionId);
    setScreen("trackingView");
  }

  // access controls which tabs show in the bar:
  //  "all"    — always shown once logged in
  //  "guest"  — sign-up flows, reached from the landing page rather than the tab bar
  //  "farmer" — logged in as a farmer
  //  "hunter" — logged in as a hunter
  // While logged out the bar only ever shows "Log in" — everything else
  // (including sign-up) lives on the landing page instead, since that's
  // the first thing a logged-out visitor sees.
  // (Admin isn't in this list — it's a small link in the header instead.)
  const tabs = [
    { id: "login", label: user ? "Account" : "Log in", Icon: LogIn, accent: C.charcoal, access: "all" },
    { id: "dashboard", label: "Farmer dashboard", Icon: LayoutDashboard, accent: C.eucalyptDeep, access: "farmer" },
    { id: "profile", label: "Hunter profile", Icon: User, accent: C.goldDeep, access: "farmer" },
    { id: "booking", label: "Booking request", Icon: Calendar, accent: C.eucalyptDeep, access: "farmer" },
    { id: "farmerBookings", label: "My bookings", Icon: ListChecks, accent: C.eucalyptDeep, access: "farmer" },
    { id: "hunterBookings", label: "Booking requests", Icon: ClipboardList, accent: C.goldDeep, access: "hunter" },
    { id: "hunterCredentials", label: "My credentials", Icon: ShieldCheck, accent: C.goldDeep, access: "hunter" },
    { id: "news", label: "News", Icon: Newspaper, accent: C.bark, access: "all" },
    { id: "messages", label: "Messages", Icon: MessageSquare, accent: C.bark, access: "all" },
    { id: "refer", label: "Refer a neighbour", Icon: UserPlus, accent: C.eucalyptDeep, access: "farmer" },
    { id: "farmerSignup", label: "List a property", Icon: Home, accent: C.eucalyptDeep, access: "guest" },
    { id: "editProperty", label: "Edit property", Icon: Pencil, accent: C.eucalyptDeep, access: "farmer" },
    { id: "hunterSignup", label: "Hunter sign-up", Icon: UserCheck, accent: C.goldDeep, access: "guest" },
  ];
  const visibleTabs = tabs.filter((t) => {
    if (!user) return t.id === "login";
    if (t.access === "all") return true;
    if (t.access === "guest") return false;
    return user.role === t.access;
  });

  return (
    <div
      className="muster-page"
      style={{
        ...fontBody,
        background: C.paper,
        minHeight: "100vh",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }

        .muster-page {
          display: flex;
          justify-content: center;
          padding: 20px 12px;
        }
        @media (min-width: 640px) {
          .muster-page { padding: 28px 24px; }
        }

        .muster-container {
          width: 100%;
          max-width: 460px;
        }
        @media (min-width: 720px) {
          .muster-container { max-width: 620px; }
        }
        @media (min-width: 1100px) {
          .muster-container { max-width: 860px; }
        }

        .muster-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 3px;
        }
        .muster-tab-btn {
          flex: 1 1 30%;
          background: transparent;
          transition: background 0.15s ease, transform 0.1s ease;
        }
        .muster-tab-btn:hover {
          background: rgba(255, 253, 248, 0.65);
        }
        .muster-tab-btn:active {
          transform: scale(0.97);
        }
        .muster-tab-btn.muster-tab-active,
        .muster-tab-btn.muster-tab-active:hover {
          background: ${C.white};
          box-shadow: 0 1px 4px rgba(42, 38, 33, 0.1);
        }
        @media (min-width: 720px) {
          .muster-tab-btn { flex: 1 1 auto; }
        }

        .muster-card {
          padding: 16px;
        }
        @media (min-width: 640px) {
          .muster-card { padding: 24px; }
        }

        .muster-hunter-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        @media (min-width: 720px) {
          .muster-hunter-list {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
            gap: 12px;
          }
        }

        .muster-two-col {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        @media (min-width: 560px) {
          .muster-two-col { flex-direction: row; }
        }
      `}</style>

      <div className="muster-container">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 18,
          }}
        >
          <Wordmark />
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={() => setScreen("admin")}
              title="Admin"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                background: "none",
                border: "none",
                padding: 0,
                ...fontMono,
                fontSize: 10,
                letterSpacing: 0.3,
                color: screen === "admin" ? C.rust : C.steel,
                cursor: "pointer",
              }}
            >
              <Settings size={11} /> ADMIN
            </button>
            {user ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ ...fontMono, fontSize: 10.5, color: C.steel }}>
                  {user.name} · {user.role}
                </span>
                <button
                  onClick={() => {
                    logout();
                    setScreen("landing");
                  }}
                  style={{
                    background: "none",
                    border: `1px solid ${C.line}`,
                    borderRadius: 6,
                    padding: "4px 8px",
                    ...fontMono,
                    fontSize: 10,
                    color: C.charcoal,
                    cursor: "pointer",
                  }}
                >
                  LOG OUT
                </button>
              </div>
            ) : (
              <span style={{ ...fontMono, fontSize: 10.5, color: C.steel }}>NOT LOGGED IN</span>
            )}
          </div>
        </div>

        <div
          className="muster-tabs"
          style={{
            marginBottom: 16,
            background: `linear-gradient(180deg, ${C.paperDim}, ${C.mist})`,
            border: `1px solid ${C.line}`,
            borderRadius: 12,
            padding: 5,
          }}
        >
          {visibleTabs.map((t) => {
            const active = screen === t.id;
            const Icon = t.Icon;
            return (
              <button
                key={t.id}
                className={`muster-tab-btn${active ? " muster-tab-active" : ""}`}
                onClick={() => setScreen(t.id)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  border: "none",
                  borderBottom: `2px solid ${active ? t.accent : "transparent"}`,
                  borderRadius: 8,
                  padding: "9px 4px 7px",
                  cursor: "pointer",
                }}
              >
                <Icon size={14} color={active ? t.accent : C.steel} strokeWidth={2.25} />
                <span
                  style={{
                    ...fontMono,
                    fontSize: 9,
                    letterSpacing: 0.2,
                    color: active ? C.charcoal : C.steel,
                    fontWeight: active ? 600 : 500,
                  }}
                >
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>

        <div
          className="muster-card"
          style={{
            background: C.paper,
            border: `1px solid ${C.line}`,
            borderRadius: 16,
          }}
        >
          {screen === "landing" && (
            <LandingPage
              goLogin={() => setScreen("login")}
              goFarmerSignup={() => setScreen("farmerSignup")}
              goHunterSignup={() => setScreen("hunterSignup")}
            />
          )}
          {screen === "login" && (
            <LoginScreen onLoggedIn={(role) => setScreen(role === "hunter" ? "hunterBookings" : "dashboard")} />
          )}
          {screen === "dashboard" && (
            <FarmerDashboard
              goRefer={() => setScreen("refer")}
              goProfile={openProfile}
              goListProperty={() => setScreen("farmerSignup")}
              goEditProperty={() => setScreen("editProperty")}
            />
          )}
          {screen === "profile" && (
            <HunterProfile
              hunterId={selectedHunterId}
              goBooking={() => setScreen("booking")}
              goBack={() => setScreen("dashboard")}
            />
          )}
          {screen === "booking" && (
            <BookingRequest
              hunterId={selectedHunterId}
              hunterName={selectedHunterName || "your hunter"}
              goBack={() => setScreen("profile")}
              goMessages={openMessages}
            />
          )}
          {screen === "farmerBookings" && (
            <FarmerBookings goMessages={openMessages} goTrackingView={openTrackingView} />
          )}
          {screen === "trackingView" && (
            <TrackingLiveView
              sessionId={trackingViewSessionId}
              goBack={() => setScreen("farmerBookings")}
            />
          )}
          {screen === "hunterBookings" && (
            <HunterBookings goMessages={openMessages} goLiveTracker={openLiveTracker} />
          )}
          {screen === "liveTracker" && (
            <LiveTracker booking={trackingBooking} goBack={() => setScreen("hunterBookings")} />
          )}
          {screen === "hunterCredentials" && <HunterCredentials />}
          {screen === "news" && <NewsFeed />}
          {screen === "messages" && (
            <MessagesThread
              bookingId={selectedBookingId}
              otherPartyName={selectedBookingParty}
              goBack={() => setScreen(messagesReturnScreen)}
            />
          )}
          {screen === "refer" && (
            <ReferNeighbour
              hunterId={selectedHunterId}
              hunterName={selectedHunterName || "this hunter"}
              goBack={() => setScreen("dashboard")}
            />
          )}
          {screen === "farmerSignup" && (
            <FarmerSignup
              goDashboard={() => setScreen("dashboard")}
              goBack={() => setScreen(user ? "dashboard" : "landing")}
            />
          )}
          {screen === "editProperty" && <EditProperty goBack={() => setScreen("dashboard")} />}
          {screen === "hunterSignup" && (
            <HunterSignup
              goBookings={() => setScreen("hunterBookings")}
              goBack={() => setScreen(user ? "hunterBookings" : "landing")}
            />
          )}
          {screen === "admin" && <AdminPanel />}
        </div>

        <div
          style={{
            textAlign: "center",
            marginTop: 14,
            ...fontMono,
            fontSize: 10,
            color: C.steel,
          }}
        >
          MOCKUP — TAP TABS ABOVE TO MOVE BETWEEN SCREENS
        </div>
      </div>
    </div>
  );
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

// Push permission must come from a real user gesture (a click), never
// requested on page load — this hook backs an explicit "Enable" button.
function useNotificationSetup() {
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
  const [permission, setPermission] = useState(() =>
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const [subscribing, setSubscribing] = useState(false);
  const [error, setError] = useState(null);

  function enable() {
    setSubscribing(true);
    setError(null);
    Notification.requestPermission()
      .then((perm) => {
        setPermission(perm);
        if (perm !== "granted") throw new Error("Notification permission wasn't granted.");
        return navigator.serviceWorker.ready;
      })
      .then((registration) =>
        apiFetch("/push/vapid-public-key")
          .then((r) => r.json())
          .then(({ publicKey }) =>
            registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(publicKey),
            })
          )
      )
      .then((subscription) => apiFetch("/push/subscribe", { method: "POST", body: subscription.toJSON() }))
      .catch((e) => setError(e.message))
      .finally(() => setSubscribing(false));
  }

  return { supported, permission, subscribing, error, enable };
}

// Reusable on both the farmer dashboard and the hunter account screen —
// copy differs slightly by role, but the mechanics (real Web Push, no
// third-party service) are identical.
function EnableAlertsBanner() {
  const { user } = useAuth();
  const { supported, permission, subscribing, error, enable } = useNotificationSetup();
  if (!supported || permission === "granted" || permission === "denied") return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: C.mist,
        border: `1px solid ${C.line}`,
        borderRadius: 10,
        padding: 12,
        marginBottom: 14,
      }}
    >
      <Siren size={16} color={C.rust} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ ...fontBody, fontWeight: 600, fontSize: 12.5, color: C.charcoal }}>
          Enable emergency alerts
        </div>
        <div style={{ ...fontBody, fontSize: 11.5, color: C.steel }}>
          {user?.role === "farmer"
            ? "Get notified immediately if a hunter on your property triggers an SOS."
            : "Get notified if a nearby hunter triggers an SOS (only while you're opted in below)."}
        </div>
        {error && <div style={{ ...fontBody, fontSize: 11, color: C.rust, marginTop: 4 }}>{error}</div>}
      </div>
      <GhostButton onClick={enable}>{subscribing ? "…" : "Enable"}</GhostButton>
    </div>
  );
}

// In-app SOS fallback — push delivery isn't guaranteed, so this polls
// GET /api/sos/active regardless, surfacing anything unresolved on
// every screen (fixed to the top) rather than just the tracking view.
function SosActiveBanner() {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState([]);

  function load() {
    if (!user) return;
    apiFetch("/sos/active")
      .then((r) => (r.ok ? r.json() : []))
      .then(setAlerts)
      .catch(() => {});
  }

  React.useEffect(() => {
    if (!user) {
      setAlerts([]);
      return;
    }
    load();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 20000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role]);

  function resolve(id) {
    apiFetch(`/sos/${id}`, { method: "PATCH" }).then(load);
  }

  if (!user || alerts.length === 0) return null;

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 1100 }}>
      {alerts.map((a) => (
        <div
          key={a.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            maxWidth: 460,
            margin: "0 auto",
            background: C.rust,
            color: C.white,
            padding: "10px 16px",
            ...fontBody,
            fontSize: 12,
          }}
        >
          <Siren size={14} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>
            {user.role === "farmer"
              ? `SOS — ${a.hunter_name} needs help${a.property_name ? ` at ${a.property_name}` : ""}.`
              : `SOS — ${a.hunter_name} needs help nearby.`}
            {a.emergency_contact_phone && (
              <> Contact: {a.emergency_contact_name || "—"} {a.emergency_contact_phone}</>
            )}
          </span>
          {user.role === "farmer" && (
            <button
              onClick={() => resolve(a.id)}
              style={{
                background: "rgba(255,255,255,0.18)",
                border: "none",
                borderRadius: 6,
                padding: "5px 10px",
                color: C.white,
                ...fontBody,
                fontWeight: 600,
                fontSize: 11,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              Resolve
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// A hunter may be mid-session with GPS actively streaming when a new
// version deploys — silently reloading the tab (the vite-plugin-pwa
// default) would kill that. Show a dismissible toast instead; the update
// applies whenever they choose (or next natural reload).
function PwaUpdateToast() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        left: 16,
        right: 16,
        maxWidth: 420,
        margin: "0 auto",
        background: C.charcoal,
        color: C.white,
        borderRadius: 10,
        padding: "12px 14px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        zIndex: 1000,
        boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
      }}
    >
      <RefreshCw size={15} style={{ flexShrink: 0 }} />
      <span style={{ ...fontBody, fontSize: 12.5, flex: 1 }}>A new version is available.</span>
      <button
        onClick={() => updateServiceWorker(true)}
        style={{
          background: C.eucalyptDeep,
          color: C.white,
          border: "none",
          borderRadius: 6,
          padding: "6px 10px",
          ...fontBody,
          fontWeight: 600,
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        Update
      </button>
      <button
        onClick={() => setNeedRefresh(false)}
        style={{ background: "none", border: "none", color: C.line, cursor: "pointer", padding: 4 }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [rehydrating, setRehydrating] = useState(true);

  // On first load, ask the server whether the session cookie (if any) is
  // still valid — there's nothing client-side to read, the cookie is
  // httpOnly. A 401 here just means "not logged in", not an error.
  React.useEffect(() => {
    apiFetch("/me")
      .then((r) => {
        if (!r.ok) throw new Error("Not logged in");
        return r.json();
      })
      .then((profile) => setUser(profile))
      .catch(() => {})
      .finally(() => setRehydrating(false));
  }, []);

  function login(newUser) {
    setUser(newUser);
  }
  function logout() {
    apiFetch("/auth/logout", { method: "POST" }).finally(() => setUser(null));
  }
  function updateProperty(updatedProperty) {
    setUser((prev) =>
      prev ? { ...prev, properties: [updatedProperty, ...(prev.properties || []).slice(1)] } : prev
    );
  }
  function updateSelf(updatedUser) {
    setUser(updatedUser);
  }

  if (rehydrating) {
    return (
      <div style={{ ...fontMono, padding: 24, color: C.steel, fontSize: 12 }}>
        Loading session…
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, updateProperty, updateSelf }}>
      <SosActiveBanner />
      <AppShell />
      <PwaUpdateToast />
    </AuthContext.Provider>
  );
}
