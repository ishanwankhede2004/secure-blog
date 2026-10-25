'use strict';
// Central configuration. Every value can be overridden with an environment
// variable (production) or an object passed to loadConfig() (tests).

const path = require('node:path');

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

function loadConfig(overrides = {}) {
  const env = process.env;
  const isProd = env.NODE_ENV === 'production';

  return {
    siteName: env.SITE_NAME || 'Inkwell',
    port: int(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    isProd,
    dbFile: env.DB_FILE || path.join(__dirname, '..', 'data', 'blog.db'),
    pageSize: int(env.PAGE_SIZE, 6),

    // Sessions and cookies
    sessionTtlMs: int(env.SESSION_HOURS, 8) * 60 * 60 * 1000,
    anonSessionMs: 2 * 60 * 60 * 1000,
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === '1' : isProd,
    trustProxy: env.TRUST_PROXY === '1',

    // Limits
    maxBodyBytes: 64 * 1024,
    globalRateMax: int(env.RATE_LIMIT_PER_MINUTE, 300),
    loginMaxAttempts: int(env.LOGIN_MAX_ATTEMPTS, 10),

    // Password hashing cost (scrypt N). 32768 is a strong default.
    scryptN: int(env.SCRYPT_N, 32768),

    // First-run admin account
    adminUsername: env.ADMIN_USERNAME || 'admin',
    adminPassword: env.ADMIN_PASSWORD || '',

    // Hosts with a disk that is wiped on restart (Render free tier): when the
    // blog is empty at start-up, restore sample posts and an "editor" login.
    seedDemo: env.SEED_DEMO === '1',
    editorPassword: env.EDITOR_PASSWORD || '',

    quiet: false,
    ...overrides,
  };
}

module.exports = { loadConfig };
