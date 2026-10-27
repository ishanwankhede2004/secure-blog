'use strict';
// Turns a post body into safe HTML. The text is escaped FIRST; formatting is then
// added by matching simple markers on the already-escaped text, so a post can never
// inject its own tags, attributes or scripts.
//
// Supported (all optional, plain text still works exactly as before):
//   ## Heading          > quotation          - list item
//   **bold**  *italic*  [label](https://link)

const { escapeHtml, raw } = require('./html');

const WORDS_PER_MINUTE = 200;

function readingMinutes(body) {
  const words = (body.match(/\S+/g) || []).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

function slug(text, n) {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${base || 'section'}-${n}`;
}

// Inline marks on text that is already escaped.
function inline(escaped) {
  return escaped
    .replace(/\[([^\]\n]{1,120})\]\((https?:\/\/[^\s()<>"']{1,300})\)/g,
      (_, label, url) => `<a href="${url}" rel="noopener noreferrer nofollow" target="_blank">${label}</a>`)
    .replace(/\*\*([^*\n]{1,200})\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]{1,200})\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
}

// Returns { html: Raw, toc: [{ id, text }] }.
function renderBody(body) {
  const blocks = body.split(/\n{2,}/);
  const toc = [];
  let headings = 0;

  const out = blocks.map((block) => {
    const lines = block.split('\n');

    if (lines.length === 1 && /^##\s+\S/.test(lines[0])) {
      const text = lines[0].replace(/^##\s+/, '').trim();
      headings += 1;
      const id = slug(text, headings);
      toc.push({ id, text });
      return `<h2 id="${id}">${inline(escapeHtml(text))}</h2>`;
    }
    if (lines.every((l) => /^>\s?/.test(l))) {
      const text = lines.map((l) => l.replace(/^>\s?/, '')).join(' ');
      return `<blockquote><p>${inline(escapeHtml(text))}</p></blockquote>`;
    }
    if (lines.every((l) => /^[-*]\s+\S/.test(l))) {
      const items = lines.map((l) => `<li>${inline(escapeHtml(l.replace(/^[-*]\s+/, '')))}</li>`);
      return `<ul>${items.join('')}</ul>`;
    }
    return `<p>${lines.map((l) => inline(escapeHtml(l))).join('<br>')}</p>`;
  });

  return { html: raw(out.join('\n')), toc };
}

// Short plain-text summary for cards and meta descriptions: markers removed.
function plainExcerpt(body, max = 170) {
  const blocks = String(body).split(/\n\s*\n/).map((b) => b.trim());
  const firstProse = blocks.find((b) => b && !/^(##\s|>|[-*]\s)/.test(b));
  const text = (firstProse || body)
    .replace(/^##\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/\*\*?([^*]+)\*\*?/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

module.exports = { renderBody, readingMinutes, plainExcerpt };
