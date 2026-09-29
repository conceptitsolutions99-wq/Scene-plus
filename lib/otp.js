// lib/otp.js
// In-memory one-time-password store for password resets.
// Keyed by username (lowercased). Each entry:
//   { code, expiresAt, verified, verifiedTokenExpiresAt, attempts }
// This is a prototype-grade store: it lives only as long as the server
// process runs. Fine for a single-instance internal tool; move to a real
// database/cache (e.g. Redis) if you ever run more than one server instance.

const crypto = require('crypto');

const OTP_TTL_MS = 15 * 60 * 1000;           // 15 minutes, per requirements
const VERIFIED_TOKEN_TTL_MS = 15 * 60 * 1000; // reset window after verifying stays within the same 15 min
const MAX_ATTEMPTS = 5;                        // guard against brute-forcing a 6-digit code

const store = new Map();

function generateCode() {
  // 6-digit numeric code, zero-padded.
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function createOtp(username) {
  const key = username.toLowerCase();
  const code = generateCode();
  const now = Date.now();
  store.set(key, {
    code,
    expiresAt: now + OTP_TTL_MS,
    verified: false,
    verifiedTokenExpiresAt: null,
    resetToken: null,
    attempts: 0,
    lastSentAt: now
  });
  return { code, expiresAt: now + OTP_TTL_MS };
}

const RESEND_COOLDOWN_MS = 30 * 1000; // don't allow spamming "resend code"

function msUntilResendAllowed(username) {
  const entry = store.get(username.toLowerCase());
  if (!entry) return 0;
  return Math.max(0, RESEND_COOLDOWN_MS - (Date.now() - entry.lastSentAt));
}

function verifyOtp(username, submittedCode) {
  const key = username.toLowerCase();
  const entry = store.get(key);
  if (!entry) return { ok: false, error: 'No OTP was requested for this account, or it already expired. Request a new one.' };
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return { ok: false, error: 'This code has expired. Request a new one.' };
  }
  if (entry.attempts >= MAX_ATTEMPTS) {
    store.delete(key);
    return { ok: false, error: 'Too many incorrect attempts. Request a new code.' };
  }
  if (submittedCode !== entry.code) {
    entry.attempts += 1;
    return { ok: false, error: 'That code is incorrect. Check the code and try again.' };
  }
  // Correct: mark verified and hand back a one-time reset token, distinct
  // from the OTP itself, so the OTP can't be replayed to reset again.
  entry.verified = true;
  entry.resetToken = crypto.randomBytes(24).toString('hex');
  entry.verifiedTokenExpiresAt = entry.expiresAt; // stays inside the original 15-minute window
  return { ok: true, resetToken: entry.resetToken };
}

function consumeResetToken(username, resetToken) {
  const key = username.toLowerCase();
  const entry = store.get(key);
  if (!entry || !entry.verified || entry.resetToken !== resetToken) {
    return { ok: false, error: 'Verify your code again before resetting the password.' };
  }
  if (Date.now() > entry.verifiedTokenExpiresAt) {
    store.delete(key);
    return { ok: false, error: 'This reset session expired. Start over with a new code.' };
  }
  store.delete(key); // one-time use
  return { ok: true };
}

module.exports = { createOtp, verifyOtp, consumeResetToken, msUntilResendAllowed, OTP_TTL_MS, RESEND_COOLDOWN_MS };
