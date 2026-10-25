'use strict';
// Security primitives: password hashing, tokens, CSRF comparison,
// rate limiting and HTTP security headers.

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const KEY_LEN = 64;

// ---- Password hashing (scrypt, memory-hard, per-user random salt) ----------
// Stored format: scrypt$N$r$p$salt(base64)$hash(base64)
// The cost parameters live inside the hash, so they can be raised later
// without breaking existing accounts.

async function hashPassword(password, N = 32768) {
  const r = 8;
  const p = 1;
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEY_LEN, {
    N, r, p, maxmem: 256 * N * r,
  });
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (![N, r, p].every(Number.isInteger)) return false;
    if (N < 1024 || N > 2 ** 20 || r < 1 || r > 16 || p < 1 || p > 4) return false;
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    const actual = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N, r, p, maxmem: 256 * N * r,
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ---- Tokens -----------------------------------------------------------------

const newToken = () => crypto.randomBytes(32).toString('base64url');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Constant-time string comparison (used for CSRF tokens).
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---- Rate limiting (fixed window, in memory) ---------------------------------

class RateLimiter {
  constructor({ windowMs, max, maxKeys = 10000 }) {
    this.windowMs = windowMs;
    this.max = max;
    this.maxKeys = maxKeys;
    this.hits = new Map();
  }

  consume(key) {
    const now = Date.now();
    let entry = this.hits.get(key);
    if (!entry || entry.reset <= now) {
      if (!entry && this.hits.size >= this.maxKeys) this.sweep(now);
      entry = { count: 0, reset: now + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count += 1;
    return {
      allowed: entry.count <= this.max,
      retryAfter: Math.max(1, Math.ceil((entry.reset - now) / 1000)),
    };
  }

  reset(key) {
    this.hits.delete(key);
  }

  sweep(now = Date.now()) {
    for (const [key, entry] of this.hits) {
      if (entry.reset <= now) this.hits.delete(key);
    }
    if (this.hits.size >= this.maxKeys) this.hits.clear();
  }
}

// ---- HTTP security headers ---------------------------------------------------
// The app uses no JavaScript and no third-party assets, so the CSP can be strict:
// nothing may run or load except our own stylesheet and favicon.

function setSecurityHeaders(res, config) {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  if (config.isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  newToken,
  sha256,
  safeEqual,
  RateLimiter,
  setSecurityHeaders,
};
