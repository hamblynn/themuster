import React, { useState } from "react";
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
} from "lucide-react";

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

// Node backend (see /server) — run `npm run seed && npm start` in that folder
const API_BASE = "http://localhost:4000/api";
// Seeded IDs from server/seed.js
const DEMO_FARMER_ID = 1;
const DEMO_PROPERTY_ID = 1;

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
        VIC · DEER ACCESS
      </span>
    </div>
  );
}

function Divider({ mt = 16, mb = 16 }) {
  return <div style={{ height: 1, background: C.line, marginTop: mt, marginBottom: mb }} />;
}

function Pill({ children, tone = "mist" }) {
  const bg = tone === "mist" ? C.mist : tone === "gold" ? "#F1E3C4" : C.paperDim;
  const fg = tone === "gold" ? C.goldDeep : C.bark;
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

/* ---------------------------------------------------------
   PROPERTY MAP — paddock outline, no-go zones, access point,
   nearby hunter markers by direction/distance
--------------------------------------------------------- */
function PropertyMap({ property }) {
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
        </div>
        <span style={{ ...fontMono, fontSize: 10.5, color: C.steel }}>
          {property?.size_hectares ?? "—"} ha · PIC {property?.pic_code ?? "—"}
        </span>
      </div>
      {/* Illustrative boundary/zones below — swap for a real mapping
          library (Mapbox/Leaflet) reading property lat/lng + zone
          geometry once you're past the mockup stage. */}

      <svg viewBox="0 0 400 260" style={{ width: "100%", height: "auto", display: "block" }}>
        {/* paddock boundary */}
        <polygon
          points="30,50 250,25 375,90 350,215 120,235 20,160"
          fill={C.paperDim}
          stroke={C.bark}
          strokeWidth="1.75"
          strokeDasharray="6 4"
        />

        {/* internal fence lines */}
        <line x1="120" y1="235" x2="150" y2="95" stroke={C.line} strokeWidth="1.5" />
        <line x1="150" y1="95" x2="250" y2="25" stroke={C.line} strokeWidth="1.5" />

        {/* dam */}
        <ellipse cx="190" cy="170" rx="26" ry="15" fill="#B9C7D6" opacity="0.7" />
        <text x="190" y="173" textAnchor="middle" style={{ ...fontMono, fontSize: 8, fill: C.steel }}>
          DAM
        </text>

        {/* no-go zone: house paddock */}
        <polygon
          points="30,50 150,95 120,235 20,160"
          fill={C.rust}
          opacity="0.08"
        />
        <polygon
          points="30,50 150,95 120,235 20,160"
          fill="none"
          stroke={C.rust}
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />
        <text x="70" y="150" textAnchor="middle" style={{ ...fontMono, fontSize: 8, fill: C.rust }}>
          NO-GO
        </text>
        <text x="70" y="160" textAnchor="middle" style={{ ...fontMono, fontSize: 8, fill: C.rust }}>
          HOUSE PADDOCK
        </text>

        {/* house icon */}
        <rect x="55" y="90" width="16" height="12" fill={C.bark} rx="1" />
        <polygon points="53,90 63,80 73,90" fill={C.bark} />

        {/* gate / access point */}
        <circle cx="250" cy="25" r="5" fill={C.eucalyptDeep} />
        <text x="262" y="22" style={{ ...fontMono, fontSize: 8, fill: C.eucalyptDeep }}>
          GATE + CODE
        </text>

        {/* recent sighting markers */}
        {[
          [220, 120],
          [280, 160],
          [200, 200],
        ].map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r="5" fill={C.gold} opacity="0.85" />
            <circle cx={x} cy={y} r="9" fill="none" stroke={C.gold} strokeWidth="1" opacity="0.4" />
          </g>
        ))}
        <text x="300" y="235" textAnchor="end" style={{ ...fontMono, fontSize: 8, fill: C.goldDeep }}>
          ● RECENT SIGHTINGS
        </text>
      </svg>

      <div style={{ display: "flex", gap: 14, marginTop: 6, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: C.eucalyptDeep, display: "inline-block" }} />
          <span style={{ ...fontMono, fontSize: 9.5, color: C.steel }}>ACCESS POINT</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: C.rust, opacity: 0.4, display: "inline-block" }} />
          <span style={{ ...fontMono, fontSize: 9.5, color: C.steel }}>NO-GO ZONE</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: C.gold, display: "inline-block" }} />
          <span style={{ ...fontMono, fontSize: 9.5, color: C.steel }}>SIGHTING</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   SCREEN 1 — FARMER DASHBOARD (matched hunters for a property)
--------------------------------------------------------- */
function FarmerDashboard({ goRefer, goProfile }) {
  const [property, setProperty] = useState(null);
  const [hunters, setHunters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  React.useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE}/properties/${DEMO_PROPERTY_ID}`).then((r) => {
        if (!r.ok) throw new Error("Could not load property");
        return r.json();
      }),
      fetch(`${API_BASE}/properties/${DEMO_PROPERTY_ID}/matches`).then((r) => {
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
  }, []);

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ ...fontMono, fontSize: 11, color: C.steel, letterSpacing: 0.5, marginBottom: 4 }}>
            PROPERTY · PIC {property.pic_code}
          </div>
          <div style={{ ...fontDisplay, fontSize: 26, color: C.charcoal }}>
            {property.name}, {property.suburb}
          </div>
        </div>
        <Pill tone="gold">
          {property.sightings.length} sighting{property.sightings.length === 1 ? "" : "s"} logged
          {urgentCount > 0 ? ` · ${urgentCount} urgent` : ""}
        </Pill>
      </div>

      <Divider mt={14} mb={14} />

      <PropertyMap property={property} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ ...fontBody, fontWeight: 600, fontSize: 14, color: C.charcoal }}>
          Matched harvesters, nearest first
        </div>
        <div style={{ ...fontMono, fontSize: 11, color: C.steel }}>SORT: DISTANCE</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
  const [hunter, setHunter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  React.useEffect(() => {
    if (!hunterId) return;
    setLoading(true);
    fetch(`${API_BASE}/hunters/${hunterId}`)
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
  }, [hunterId]);

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
      </div>

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
const BOOKING_DATE_OPTIONS = ["2026-08-14", "2026-08-15", "2026-08-16"];
function formatShortDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric" });
}

function BookingRequest({ hunterId, hunterName, propertyId, propertyName, goBack }) {
  const [selectedDate, setSelectedDate] = useState(BOOKING_DATE_OPTIONS[1]);
  const [booking, setBooking] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  function submitBooking() {
    setSubmitting(true);
    fetch(`${API_BASE}/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        property_id: propertyId,
        hunter_id: hunterId,
        requested_date: selectedDate,
        start_time: "05:30",
        end_time: "09:00",
        farmer_note: "Livestock in the north paddock this week",
      }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("Could not create booking");
        return r.json();
      })
      .then((created) =>
        fetch(`${API_BASE}/bookings/${created.id}`).then((r) => r.json())
      )
      .then((full) => {
        setBooking(full);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSubmitting(false));
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
        <div style={{ marginTop: 10 }}>
          <GhostButton icon={FileText} full>
            Generate printable carcass tags
          </GhostButton>
        </div>

        <Divider />
        <GhostButton icon={MessageSquare} full onClick={goBack}>
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
        with {hunterName}, at {propertyName}
      </div>

      <Divider />

      <div style={{ ...fontBody, fontWeight: 600, fontSize: 13, color: C.charcoal, marginBottom: 8 }}>
        Select a date
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {BOOKING_DATE_OPTIONS.map((d) => (
          <div
            key={d}
            onClick={() => setSelectedDate(d)}
            style={{
              flex: 1,
              textAlign: "center",
              padding: "10px 0",
              borderRadius: 8,
              cursor: "pointer",
              border: `1.5px solid ${d === selectedDate ? C.eucalyptDeep : C.line}`,
              background: d === selectedDate ? C.mist : "transparent",
              ...fontMono,
              fontSize: 12,
              color: C.charcoal,
            }}
          >
            {formatShortDate(d)}
          </div>
        ))}
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
function TextField({ label, value, onChange, placeholder, multiline }) {
  const Tag = multiline ? "textarea" : "input";
  return (
    <div>
      <div style={{ ...fontMono, fontSize: 10.5, color: C.steel, marginBottom: 4 }}>{label}</div>
      <Tag
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
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [propertyNote, setPropertyNote] = useState("");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);

  React.useEffect(() => {
    fetch(`${API_BASE}/referrals?farmer_id=${DEMO_FARMER_ID}`)
      .then((r) => r.json())
      .then(setHistory)
      .catch(() => {});
  }, [sent]);

  function submitReferral() {
    if (!name || !contact) {
      setError("Neighbour's name and contact are required.");
      return;
    }
    setSubmitting(true);
    fetch(`${API_BASE}/referrals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        referring_farmer_id: DEMO_FARMER_ID,
        hunter_id: hunterId,
        referred_name: name,
        referred_contact: contact,
        referred_property: propertyNote,
        note,
      }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("Could not send referral");
        return r.json();
      })
      .then(() => {
        setSent(name);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSubmitting(false));
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
   SCREEN 5 — FARMER SIGN-UP (add farmer + property)
--------------------------------------------------------- */
function FarmerSignup() {
  const [farmerName, setFarmerName] = useState("");
  const [farmerEmail, setFarmerEmail] = useState("");
  const [farmerPhone, setFarmerPhone] = useState("");
  const [propertyName, setPropertyName] = useState("");
  const [picCode, setPicCode] = useState("");
  const [address, setAddress] = useState("");
  const [suburb, setSuburb] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [sizeHa, setSizeHa] = useState("");
  const [accessNotes, setAccessNotes] = useState("");
  const [permittedHours, setPermittedHours] = useState("");
  const [allowSpotlighting, setAllowSpotlighting] = useState(false);
  const [noGoLabel, setNoGoLabel] = useState("");
  const [noGoDescription, setNoGoDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  function submit() {
    if (!farmerName || !farmerEmail || !propertyName || !picCode || !latitude || !longitude) {
      setError("Name, email, property name, PIC and coordinates are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    fetch(`${API_BASE}/farmers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: farmerName, email: farmerEmail, phone: farmerPhone }),
    })
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then((farmer) =>
        fetch(`${API_BASE}/properties`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            farmer_id: farmer.id,
            name: propertyName,
            pic_code: picCode,
            address, suburb,
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            size_hectares: sizeHa ? parseFloat(sizeHa) : null,
            access_notes: accessNotes,
            permitted_hours: permittedHours,
            allow_spotlighting: allowSpotlighting,
            no_go_zones: noGoLabel ? [{ label: noGoLabel, description: noGoDescription }] : [],
          }),
        }).then((r) => {
          if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
          return r.json();
        })
      )
      .then((property) => setDone(property))
      .catch((e) => setError(e.message))
      .finally(() => setSubmitting(false));
  }

  if (done) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.eucalyptDeep }}>
          <Check size={18} />
          <span style={{ ...fontBody, fontWeight: 700, fontSize: 15 }}>Property listed</span>
        </div>
        <div style={{ ...fontBody, fontSize: 13, color: C.bark, marginTop: 6 }}>
          {done.name} (PIC {done.pic_code}) is now live. Switch to the Farmer dashboard tab —
          you'll need to update DEMO_PROPERTY_ID to {done.id} in the code to view it there,
          since this mockup doesn't have login/session switching yet.
        </div>
      </div>
    );
  }

  return (
    <div>
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
      </div>

      <Divider />
      <SectionLabel>Property details</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <TextField label="PROPERTY NAME" value={propertyName} onChange={setPropertyName} placeholder="Riverbend" />
        <TextField label="PIC CODE" value={picCode} onChange={setPicCode} placeholder="3TR00412" />
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
function HunterSignup() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
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
    if (!name || !email || !latitude || !longitude) {
      setError("Name, email and coordinates are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const credentials = CREDENTIAL_TYPES.map((c) => ({
      credential_type: c.value,
      reference_number: credValues[c.value].reference_number,
      expiry_date: credValues[c.value].expiry_date,
    })).filter((c) => c.reference_number);

    fetch(`${API_BASE}/hunters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, email, phone, bio,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        thermal_capable: thermal,
        suppressed_capable: suppressed,
        credentials,
      }),
    })
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then((hunter) => setDone(hunter))
      .catch((e) => setError(e.message))
      .finally(() => setSubmitting(false));
  }

  if (done) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.eucalyptDeep }}>
          <Check size={18} />
          <span style={{ ...fontBody, fontWeight: 700, fontSize: 15 }}>Profile submitted</span>
        </div>
        <div style={{ ...fontBody, fontSize: 13, color: C.bark, marginTop: 6 }}>
          {done.name}'s profile is created but not yet visible to farmers — new hunters start
          inactive until an admin verifies the credentials submitted. Once verified, they'll
          appear in nearby farmers' matches automatically.
        </div>
      </div>
    );
  }

  return (
    <div>
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
   APP SHELL
--------------------------------------------------------- */
export default function App() {
  const [screen, setScreen] = useState("dashboard");
  const [selectedHunterId, setSelectedHunterId] = useState(null);
  const [selectedHunterName, setSelectedHunterName] = useState(null);

  function openProfile(id, name) {
    setSelectedHunterId(id);
    if (name) setSelectedHunterName(name);
    setScreen("profile");
  }

  const tabs = [
    { id: "dashboard", label: "Farmer dashboard" },
    { id: "profile", label: "Hunter profile" },
    { id: "booking", label: "Booking request" },
    { id: "refer", label: "Refer a neighbour" },
    { id: "farmerSignup", label: "List a property" },
    { id: "hunterSignup", label: "Hunter sign-up" },
  ];

  return (
    <div
      style={{
        ...fontBody,
        background: C.paper,
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        padding: "28px 16px",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
      `}</style>

      <div style={{ width: "100%", maxWidth: 460 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 18,
          }}
        >
          <Wordmark />
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            marginBottom: 16,
            background: C.paperDim,
            borderRadius: 10,
            padding: 4,
          }}
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setScreen(t.id)}
              style={{
                flex: "1 1 30%",
                border: "none",
                background: screen === t.id ? C.white : "transparent",
                color: screen === t.id ? C.charcoal : C.steel,
                borderRadius: 7,
                padding: "8px 4px",
                ...fontMono,
                fontSize: 9.5,
                letterSpacing: 0.2,
                cursor: "pointer",
                boxShadow: screen === t.id ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div
          style={{
            background: C.paper,
            border: `1px solid ${C.line}`,
            borderRadius: 16,
            padding: 20,
          }}
        >
          {screen === "dashboard" && (
            <FarmerDashboard
              goRefer={() => setScreen("refer")}
              goProfile={openProfile}
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
              propertyId={DEMO_PROPERTY_ID}
              propertyName="Riverbend"
              goBack={() => setScreen("profile")}
            />
          )}
          {screen === "refer" && (
            <ReferNeighbour
              hunterId={selectedHunterId}
              hunterName={selectedHunterName || "this hunter"}
              goBack={() => setScreen("dashboard")}
            />
          )}
          {screen === "farmerSignup" && <FarmerSignup />}
          {screen === "hunterSignup" && <HunterSignup />}
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
