'use strict';
// Generated cover art. Every post gets a unique, consistent 16:10 picture drawn
// from its id and category, so there is no image to upload, store or lose on a
// host with a wiped disk. Only numbers go into the SVG; no user text ever does.

const PALETTES = {
  'Security':         { bg: '#14161c', a: '#c9a96a', b: '#e9dcc0', c: '#2a2f3a' },
  'Web Development':  { bg: '#1b2a26', a: '#cdb27a', b: '#e8e1cc', c: '#2f4a42' },
  'Internship Diary': { bg: '#f0e8d8', a: '#a98544', b: '#14161c', c: '#e1d5bb' },
  'Ideas':            { bg: '#2a1f1c', a: '#d3b27c', b: '#efe3cf', c: '#4a342c' },
};

// Small seeded generator: the same post always gets the same picture.
function rng(seed) {
  let t = (seed * 2654435761) >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n) => Math.round(n * 10) / 10;

function coverSvg(id, category) {
  const pal = PALETTES[category] || PALETTES.Ideas;
  const rand = rng(Number(id) || 1);
  const W = 800;
  const H = 500;
  const parts = [];

  // soft concentric rings, like a ripple in ink
  const cx = f(W * (0.55 + rand() * 0.35));
  const cy = f(H * (0.2 + rand() * 0.6));
  for (let i = 0; i < 6; i += 1) {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${f(50 + i * (28 + rand() * 14))}" fill="none" stroke="${pal.a}" stroke-opacity="${f(0.55 - i * 0.07)}" stroke-width="${i === 0 ? 2.5 : 1.2}"/>`);
  }
  // fine diagonal hatching
  const hatch = 14 + Math.floor(rand() * 10);
  for (let i = 0; i < hatch; i += 1) {
    const x = f(rand() * W * 0.7);
    parts.push(`<line x1="${x}" y1="${H}" x2="${f(x + 120 + rand() * 160)}" y2="0" stroke="${pal.b}" stroke-opacity="0.07" stroke-width="1"/>`);
  }
  // a few solid blocks
  for (let i = 0; i < 3; i += 1) {
    const w = f(90 + rand() * 160);
    parts.push(`<rect x="${f(rand() * (W - w))}" y="${f(rand() * (H - 40))}" width="${w}" height="${f(6 + rand() * 26)}" fill="${pal.c}" fill-opacity="0.55"/>`);
  }
  // champagne nib mark, bottom-left
  parts.push(`<path d="M72 430 96 398l24 32-24 18z" fill="${pal.a}"/><path d="M96 398v36" stroke="${pal.bg}" stroke-width="2"/>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true"><rect width="${W}" height="${H}" fill="${pal.bg}"/>${parts.join('')}</svg>`;
}

module.exports = { coverSvg };
