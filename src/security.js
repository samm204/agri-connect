'use strict';
// Security helpers: password hashing, session tokens, validation, rate limiting.
const crypto = require('crypto');

// ---- Password hashing (scrypt + per-user random salt) ----
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ---- Validation (server-side; the front end repeats these checks for UX) ----
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateEmail(email) {
  return typeof email === 'string' && email.length <= 120 && EMAIL_RE.test(email);
}

// Strong password: 8+ chars, at least one letter and one digit, not a very common password.
const COMMON = new Set(['password', 'password1', '12345678', 'qwerty123', 'admin123', '123456789', 'letmein1']);
function validatePassword(pw) {
  if (typeof pw !== 'string') return 'Password is required.';
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 100) return 'Password is too long.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain a letter and a number.';
  if (COMMON.has(pw.toLowerCase())) return 'That password is too common.';
  return null;
}

function cleanText(v, max = 200) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

// ---- Rate limiting for login attempts (in-memory) ----
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function tooManyAttempts(key) {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) { attempts.delete(key); return false; }
  return rec.count >= MAX_ATTEMPTS;
}
function recordFailure(key) {
  const rec = attempts.get(key);
  if (!rec || Date.now() - rec.first > WINDOW_MS) attempts.set(key, { count: 1, first: Date.now() });
  else rec.count += 1;
}
function clearFailures(key) { attempts.delete(key); }
function resetRateLimits() { attempts.clear(); }

module.exports = {
  hashPassword, verifyPassword, newToken,
  validateEmail, validatePassword, cleanText,
  tooManyAttempts, recordFailure, clearFailures, resetRateLimits,
};
