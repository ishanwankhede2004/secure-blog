'use strict';
// Generated cover art. Every article gets its own picture, drawn from its id and
// category, so there is nothing to upload, store or lose on a host whose disk is
// wiped. Only numbers and fixed colours go into the SVG; user text never does.
//
// The canvas is square and every composition keeps its subject in the centre, so the
// same file crops cleanly to portrait (4:5), landscape (3:2, 16:9) or square.

const S = 1000;

// Four palettes drawn from the brand: ink, warm ivory, warm grey and champagne.
const PALETTES = {
  'Security':         { bg: '#14130f', ink: '#0a0907', mid: '#2a2721', soft: '#efe7d6', gold: '#c8a96a' },
  'Web Development':  { bg: '#8f887b', ink: '#16140f', mid: '#a49d90', soft: '#f3ecdd', gold: '#e3cf9f' },
  'Internship Diary': { bg: '#e6dcc4', ink: '#16140f', mid: '#d3c6a6', soft: '#6d5d3a', gold: '#a47f3a' },
  'Ideas':            { bg: '#cdb27c', ink: '#16140f', mid: '#bd9f66', soft: '#f6efe0', gold: '#16140f' },
};

// Small seeded generator: the same article always gets the same picture.
function rng(seed) {
  let t = (seed * 2654435761) >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const n = (v) => Math.round(v * 10) / 10;

// ---- compositions: each returns SVG markup and keeps its subject near the centre ----

// A low sun and its reflection over a still horizon.
function horizon(p, r) {
  const cx = n(430 + r() * 140);
  const R = n(150 + r() * 60);
  const hy = n(560 + r() * 60);
  const lines = [];
  for (let i = 0; i < 9; i += 1) {
    const y = n(hy + 22 + i * (14 + i * 3.2));
    const w = n(R * 2.2 - i * 16 + r() * 30);
    lines.push(`<line x1="${n(cx - w / 2)}" y1="${y}" x2="${n(cx + w / 2)}" y2="${y}" stroke="${p.gold}" stroke-opacity="${n(0.7 - i * 0.07)}" stroke-width="${n(2.4 - i * 0.2)}"/>`);
  }
  return `<circle cx="${cx}" cy="${n(hy - R * 0.15)}" r="${R}" fill="${p.gold}"/>`
    + `<rect x="0" y="${hy}" width="${S}" height="${S - hy}" fill="${p.mid}" fill-opacity="0.55"/>`
    + `<line x1="0" y1="${hy}" x2="${S}" y2="${hy}" stroke="${p.soft}" stroke-opacity="0.6" stroke-width="1.5"/>${lines.join('')}`;
}

// Nested arches, like an arcade seen straight on.
function arches(p, r) {
  const cx = n(470 + r() * 60);
  const base = n(760 + r() * 40);
  const parts = [];
  for (let i = 0; i < 6; i += 1) {
    const w = 120 + i * 62;
    const top = n(base - w * 1.55);
    parts.push(`<path d="M${n(cx - w)} ${base} V${n(top + w)} A${w} ${w} 0 0 1 ${n(cx + w)} ${n(top + w)} V${base}" fill="${i === 0 ? p.gold : 'none'}" stroke="${i === 0 ? 'none' : p.soft}" stroke-opacity="${n(0.85 - i * 0.12)}" stroke-width="${i === 1 ? 3 : 1.6}"/>`);
  }
  return `${parts.reverse().join('')}<line x1="0" y1="${base}" x2="${S}" y2="${base}" stroke="${p.soft}" stroke-opacity="0.5" stroke-width="1.5"/>`;
}

// Rings spreading from a single drop of ink.
function ripples(p, r) {
  const cx = n(420 + r() * 160);
  const cy = n(420 + r() * 160);
  const parts = [];
  for (let i = 0; i < 9; i += 1) {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${n(70 + i * (42 + r() * 12))}" fill="none" stroke="${p.soft}" stroke-opacity="${n(0.7 - i * 0.07)}" stroke-width="${i === 0 ? 3 : 1.3}"/>`);
  }
  return `${parts.join('')}<circle cx="${cx}" cy="${cy}" r="46" fill="${p.gold}"/>`;
}

// A field of fine vertical lines with one disc and one bold stroke.
function pillars(p, r) {
  const parts = [];
  const gap = 22 + Math.floor(r() * 8);
  for (let x = 90; x < S - 60; x += gap) {
    parts.push(`<line x1="${x}" y1="${n(200 + r() * 40)}" x2="${x}" y2="${n(760 + r() * 40)}" stroke="${p.soft}" stroke-opacity="0.38" stroke-width="1.2"/>`);
  }
  const bx = n(380 + r() * 240);
  return `${parts.join('')}<rect x="${bx}" y="180" width="14" height="650" fill="${p.gold}"/>`
    + `<circle cx="${n(bx + 7)}" cy="${n(380 + r() * 120)}" r="${n(90 + r() * 40)}" fill="${p.gold}"/>`;
}

// Two overlapping discs: a quiet eclipse.
function eclipse(p, r) {
  const cx = n(450 + r() * 100);
  const cy = n(450 + r() * 100);
  const R = n(230 + r() * 50);
  const off = n(60 + r() * 50);
  return `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${p.gold}"/>`
    + `<circle cx="${n(cx + off)}" cy="${n(cy - off * 0.4)}" r="${R}" fill="${p.bg}"/>`
    + `<circle cx="${n(cx + off)}" cy="${n(cy - off * 0.4)}" r="${R}" fill="none" stroke="${p.soft}" stroke-opacity="0.7" stroke-width="1.6"/>`
    + `<circle cx="${cx}" cy="${cy}" r="${n(R + 56)}" fill="none" stroke="${p.soft}" stroke-opacity="0.3" stroke-width="1.2"/>`;
}

const COMPOSITIONS = [horizon, arches, ripples, pillars, eclipse];

function coverSvg(id, category) {
  const p = PALETTES[category] || PALETTES.Ideas;
  const seed = Number(id) || 1;
  const r = rng(seed);
  const art = COMPOSITIONS[seed % COMPOSITIONS.length](p, r);
  // frame: a hairline inset border, like a printed plate
  const frame = `<rect x="44" y="44" width="${S - 88}" height="${S - 88}" fill="none" stroke="${p.soft}" stroke-opacity="0.32" stroke-width="1.5"/>`;
  // paper grain
  const grain = `<filter id="g" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="${seed % 97}" result="n"/>`
    + '<feColorMatrix in="n" type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 0.09"/></feComponentTransfer></filter>';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true">`
    + `<defs>${grain}</defs><rect width="${S}" height="${S}" fill="${p.bg}"/>${art}${frame}`
    + `<rect width="${S}" height="${S}" filter="url(#g)"/></svg>`;
}

module.exports = { coverSvg };
