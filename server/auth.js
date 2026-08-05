const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// Dev-only secret. For anything beyond your own local testing,
// set a real JWT_SECRET environment variable instead — never
// ship this hardcoded fallback to production.
const JWT_SECRET = process.env.JWT_SECRET || "muster-local-dev-secret-change-me";
const TOKEN_EXPIRY = "7d";
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// Two independent sessions, each its own httpOnly cookie, so an admin
// can be logged in without disturbing (or requiring) a farmer/hunter
// session in the same browser.
const COOKIE_NAME = "muster_token";
const ADMIN_COOKIE_NAME = "muster_admin_token";
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  secure: false, // dev over plain http — set true once this is served over https
  maxAge: TOKEN_EXPIRY_MS,
};

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function signToken(user) {
  // user: { id, role: 'farmer' | 'hunter' | 'admin' }
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

function setSessionCookie(res, user) {
  res.cookie(COOKIE_NAME, signToken(user), COOKIE_OPTS);
}
function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "lax", secure: false });
}
function setAdminSessionCookie(res, admin) {
  res.cookie(ADMIN_COOKIE_NAME, signToken(admin), COOKIE_OPTS);
}
function clearAdminSessionCookie(res) {
  res.clearCookie(ADMIN_COOKIE_NAME, { httpOnly: true, sameSite: "lax", secure: false });
}

// Express middleware: requires a valid session cookie, optionally of a
// specific role. Attaches { id, role } to req.user.
function requireAuth(role) {
  return (req, res, next) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: "Not logged in" });

    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ error: "Session expired — please log in again" });

    if (role && payload.role !== role) {
      return res.status(403).json({ error: `This action requires a ${role} account` });
    }
    req.user = payload;
    next();
  };
}

// Same idea, but for the separate admin session cookie. Attaches
// { id, role: 'admin' } to req.admin.
function requireAdminAuth(req, res, next) {
  const token = req.cookies?.[ADMIN_COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "Not logged in as admin" });

  const payload = verifyToken(token);
  if (!payload || payload.role !== "admin") {
    return res.status(401).json({ error: "Admin session expired — please log in again" });
  }
  req.admin = payload;
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  requireAuth,
  requireAdminAuth,
  setSessionCookie,
  clearSessionCookie,
  setAdminSessionCookie,
  clearAdminSessionCookie,
};
