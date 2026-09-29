// lib/sessions.js
// In-memory bearer-token sessions. Simple on purpose: tokens live only for
// as long as the server process runs, which is fine for an internal tool /
// prototype. Swap for signed JWTs or a real session store for production.

const crypto = require('crypto');

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hour shift-length session
const sessions = new Map(); // token -> { userId, expiresAt }

function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { userId, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

function getUserId(token) {
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return s.userId;
}

function destroySession(token) {
  sessions.delete(token);
}

module.exports = { createSession, getUserId, destroySession };
