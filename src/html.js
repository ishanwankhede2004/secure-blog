'use strict';
// Tiny HTML templating with escaping ON by default.
// Every ${value} inside html`...` is escaped unless it is already a Raw
// fragment (which only html`...` and raw() can create). This is what stops
// stored and reflected XSS: user text can never become markup by accident.

const MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

const escapeHtml = (value) => String(value).replace(/[&<>"'`]/g, (c) => MAP[c]);

class Raw {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

const raw = (value) => new Raw(String(value));

function part(v) {
  if (v instanceof Raw) return v.value;
  if (Array.isArray(v)) return v.map(part).join('');
  if (v === null || v === undefined || v === false) return '';
  return escapeHtml(v);
}

function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    out += part(values[i]) + strings[i + 1];
  }
  return new Raw(out);
}

module.exports = { html, raw, escapeHtml, Raw };
