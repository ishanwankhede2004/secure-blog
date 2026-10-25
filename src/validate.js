'use strict';
// Input validation and sanitising. Every value that comes from a form or the
// query string passes through here before it touches the database or a view.

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const LIMITS = {
  titleMin: 3,
  titleMax: 120,
  bodyMin: 10,
  bodyMax: 20000,
  usernameMin: 3,
  usernameMax: 32,
  passwordMin: 10,
  passwordMax: 128,
  searchMax: 100,
};

const ROLES = ['admin', 'editor'];

const COMMON_PASSWORDS = new Set([
  'password123', 'password1234', '1234567890', '12345678910', 'qwertyuiop',
  'iloveyou123', 'admin12345', 'letmein1234', 'welcome1234', 'changeme123',
]);

// Single-line text: strips control characters, collapses whitespace.
function cleanLine(value, max = 200) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFC')
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// Multi-line text: strips control characters but keeps newlines and tabs.
function cleanText(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .trim();
}

function validatePost(input) {
  const title = cleanLine(input.title, LIMITS.titleMax + 50);
  const body = cleanText(input.body);
  const errors = {};

  if (title.length < LIMITS.titleMin) {
    errors.title = `Title must be at least ${LIMITS.titleMin} characters.`;
  } else if (title.length > LIMITS.titleMax) {
    errors.title = `Title must be at most ${LIMITS.titleMax} characters.`;
  }

  if (body.length < LIMITS.bodyMin) {
    errors.body = `Body must be at least ${LIMITS.bodyMin} characters.`;
  } else if (body.length > LIMITS.bodyMax) {
    errors.body = `Body must be at most ${LIMITS.bodyMax.toLocaleString('en-US')} characters.`;
  }

  return {
    values: { title, body },
    errors: Object.keys(errors).length ? errors : null,
  };
}

function validateUsername(input) {
  const value = cleanLine(input, 64);
  if (value.length < LIMITS.usernameMin || value.length > LIMITS.usernameMax) {
    return { value, error: `Username must be ${LIMITS.usernameMin}-${LIMITS.usernameMax} characters.` };
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) {
    return { value, error: 'Username may only contain letters, numbers, dot, dash and underscore.' };
  }
  return { value, error: null };
}

// Passwords are never trimmed or altered; only length and basic strength are checked.
function validateNewPassword(input, username = '') {
  const value = typeof input === 'string' ? input : '';
  if (value.length < LIMITS.passwordMin) {
    return { value, error: `Password must be at least ${LIMITS.passwordMin} characters.` };
  }
  if (value.length > LIMITS.passwordMax) {
    return { value, error: `Password must be at most ${LIMITS.passwordMax} characters.` };
  }
  if (COMMON_PASSWORDS.has(value.toLowerCase())) {
    return { value, error: 'That password is too common. Choose something less guessable.' };
  }
  if (username && value.toLowerCase() === String(username).toLowerCase()) {
    return { value, error: 'Password must not be the same as the username.' };
  }
  return { value, error: null };
}

function validateRole(input) {
  const value = typeof input === 'string' ? input : '';
  return ROLES.includes(value)
    ? { value, error: null }
    : { value, error: 'Choose a valid role.' };
}

function parsePage(input) {
  const n = Number.parseInt(input, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 100000);
}

function parseQuery(input) {
  return cleanLine(typeof input === 'string' ? input : '', LIMITS.searchMax);
}

// Escape LIKE wildcards so a search for "100%" or "a_b" is taken literally.
const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');

module.exports = {
  LIMITS,
  ROLES,
  cleanLine,
  cleanText,
  validatePost,
  validateUsername,
  validateNewPassword,
  validateRole,
  parsePage,
  parseQuery,
  escapeLike,
};
