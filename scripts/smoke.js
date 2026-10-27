'use strict';
// Live-site check. Runs real requests against a deployed (or local) copy of the
// blog and reports PASS/FAIL for every feature.
//
//   BASE_URL=https://your-app.onrender.com \
//   ADMIN_PASSWORD=... EDITOR_PASSWORD=... npm run smoke
//
// It creates a few clearly named test posts and deletes them again.

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const EDITOR_USER = process.env.EDITOR_USERNAME || 'editor';
const EDITOR_PASSWORD = process.env.EDITOR_PASSWORD || '';
const TAG = `smoketest${Date.now().toString(36)}`;

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition) });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${!condition && detail ? `  (${detail})` : ''}`);
}

class Client {
  constructor() {
    this.cookies = new Map();
  }

  async req(path, { method = 'GET', form, headers = {} } = {}) {
    const h = { ...headers };
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    let body;
    if (form) {
      body = new URLSearchParams(form).toString();
      h['content-type'] = 'application/x-www-form-urlencoded';
    }
    const res = await fetch(BASE + path, { method, headers: h, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(';')[0];
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (/max-age=0/i.test(c) || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return { status: res.status, headers: res.headers, text: await res.text(), location: res.headers.get('location') };
  }

  async csrf(path = '/') {
    const r = await this.req(path);
    const m = r.text.match(/name="_csrf" value="([^"]+)"/);
    if (!m) throw new Error(`no CSRF token on ${path} (HTTP ${r.status})`);
    return m[1];
  }

  async login(username, password) {
    const token = await this.csrf('/login');
    return this.req('/login', { method: 'POST', form: { _csrf: token, username, password } });
  }

  async post(path, form = {}) {
    return this.req(path, { method: 'POST', form: { _csrf: await this.csrf('/'), ...form } });
  }
}

// A sleeping free-tier service takes about a minute to wake up.
async function waitUntilAwake() {
  const started = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(20000) });
      if (r.status === 200) return Date.now() - started;
    } catch { /* still starting */ }
    if (Date.now() - started > 180000) throw new Error('site did not wake up within 3 minutes');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

// Posts on a page: the featured article (front page only) plus the cards.
const countCards = (text) =>
  (text.match(/<article class="story /g) || []).length + (text.match(/<article class="hero-feature"/g) || []).length;
const postId = (location) => (location || '').split('/').pop();

async function main() {
  if (!ADMIN_PASSWORD) {
    console.error('Set ADMIN_PASSWORD (and EDITOR_PASSWORD) first. See README.');
    process.exit(2);
  }
  console.log(`Testing ${BASE}\n`);
  const woke = await waitUntilAwake();
  check(`site is up (answered after ${Math.round(woke / 1000)}s)`, true);

  // ---- start-up, security basics
  const visitor = new Client();
  const home = await visitor.req('/');
  check('home page loads', home.status === 200 && /<title>/.test(home.text), `HTTP ${home.status}`);
  check('mobile viewport tag present', /name="viewport" content="width=device-width/.test(home.text));
  check('security headers present',
    /default-src 'none'/.test(home.headers.get('content-security-policy') || '')
    && home.headers.get('x-content-type-options') === 'nosniff'
    && home.headers.get('x-frame-options') === 'DENY');
  if (BASE.startsWith('https://')) {
    check('HTTPS with HSTS', Boolean(home.headers.get('strict-transport-security')));
  }
  const css = await visitor.req('/static/style.css');
  check('stylesheet loads', css.status === 200 && /@media/.test(css.text));

  // ---- INKWELL: pages, topics, generated covers
  const about = await visitor.req('/about');
  check('About page loads', about.status === 200 && /About/.test(about.text));
  const topic = await visitor.req('/?category=Security');
  check('category filter works', topic.status === 200 && /in Security/.test(topic.text));
  const coverId = (home.text.match(/\/covers\/(\d+)\.svg/) || [])[1];
  const cover = coverId ? await visitor.req(`/covers/${coverId}.svg`) : { status: 0, headers: new Headers() };
  check('cover art is served', cover.status === 200 && /image\/svg\+xml/.test(cover.headers.get('content-type') || ''));
  const missing = await visitor.req('/no-such-page');
  check('custom 404 page has search', missing.status === 404 && /role="search"/.test(missing.text));

  // ---- pagination
  const totalMatch = home.text.match(/(\d+) articles?\s*<\/p>/);
  const total = totalMatch ? Number(totalMatch[1]) : 0;
  check('database works: posts are listed', total > 0 && countCards(home.text) > 0, `found ${total} posts`);
  check('page 1 shows at most 6 posts', countCards(home.text) <= 6 && countCards(home.text) > 0);
  if (total > 6) {
    const p2 = await visitor.req('/?page=2');
    check('pagination: page 2 works', p2.status === 200 && countCards(p2.text) > 0 && /Page 2 of/.test(p2.text));
    check('pagination: bad page number is handled', (await visitor.req('/?page=abc')).status === 200);
  } else {
    console.log('SKIP  pagination page 2 (fewer than 7 posts on the site)');
  }

  // ---- search (before anything is created: pick a word from a real title)
  const firstTitle = (home.text.match(/<h2><a href="\/posts\/\d+">([^<]+)<\/a>/) || [])[1] || '';
  const word = firstTitle.split(/\s+/).find((w) => /^[A-Za-z]{5,}$/.test(w));
  if (word) {
    const s = await visitor.req(`/?q=${encodeURIComponent(word)}`);
    check(`search finds "${word}"`, s.status === 200 && countCards(s.text) > 0);
  }
  const none = await visitor.req(`/?q=${TAG}nothingmatchesthis`);
  check('search with no match says so', /No articles match/.test(none.text));
  const sqli = await visitor.req(`/?q=${encodeURIComponent("' OR '1'='1")}`);
  check('SQL-injection style search is harmless', sqli.status === 200 && /0 articles matching/.test(sqli.text));

  // ---- visitor restrictions
  const gate = await visitor.req('/posts/new');
  check('visitor cannot open the write page (sent to login)', gate.status === 303 && gate.location === '/login');
  const forged = await visitor.req('/login', { method: 'POST', form: { username: 'x', password: 'y' } });
  check('form post without CSRF token is rejected', forged.status === 403);

  // ---- login
  const bad = await new Client().login(ADMIN_USER, 'definitely-the-wrong-password');
  check('wrong password is refused', bad.status === 401);
  const admin = new Client();
  const adminLogin = await admin.login(ADMIN_USER, ADMIN_PASSWORD);
  check('admin login works', adminLogin.status === 303, `HTTP ${adminLogin.status}`);
  if (adminLogin.status !== 303) throw new Error('cannot continue without an admin login (check ADMIN_PASSWORD)');
  check('logged-in page shows admin role', /badge">admin</.test((await admin.req('/')).text));

  // ---- CRUD as admin
  const title = `Smoke test ${TAG}`;
  const created = await admin.post('/posts', { title, body: 'Created by the automated live-site check.' });
  check('CREATE a post', created.status === 303 && /^\/posts\/\d+$/.test(created.location || ''), `HTTP ${created.status}`);
  const adminPostUrl = created.location;
  const read = await visitor.req(adminPostUrl);
  check('READ the post as a visitor', read.status === 200 && read.text.includes(title));
  const found = await visitor.req(`/?q=${TAG}`);
  check('SEARCH finds the new post', countCards(found.text) === 1);
  const updated = await admin.post(adminPostUrl.replace('/posts/', '/posts/'), {
    title: `${title} edited`, body: 'Edited by the automated live-site check.',
  });
  check('UPDATE the post', updated.status === 303);
  check('update is visible', (await visitor.req(adminPostUrl)).text.includes(`${title} edited`));

  const xss = await admin.post('/posts', {
    title: `<script>alert(1)</script> ${TAG}`, body: '<img src=x onerror=alert(1)> plain text body.',
  });
  const xssPage = await visitor.req(xss.location || '/');
  check('script tags are shown as text, not run',
    !xssPage.text.includes('<script>alert(1)') && xssPage.text.includes('&lt;script&gt;'));

  // ---- editor permissions
  if (EDITOR_PASSWORD) {
    const editor = new Client();
    const login = await editor.login(EDITOR_USER, EDITOR_PASSWORD);
    check('editor login works', login.status === 303, `HTTP ${login.status}`);
    if (login.status === 303) {
      const mine = await editor.post('/posts', { title: `Editor post ${TAG}`, body: 'Written by the editor account.' });
      check('editor can create a post', mine.status === 303);
      const mineUrl = mine.location;
      check('editor can edit their own post',
        (await editor.post(mineUrl, { title: `Editor post ${TAG} v2`, body: 'Edited by the editor.' })).status === 303);
      check('editor cannot open the edit page for the admin\'s post', (await editor.req(`${adminPostUrl}/edit`)).status === 403);
      check('editor cannot change the admin\'s post',
        (await editor.post(adminPostUrl, { title: 'Hacked', body: 'Editor should not manage this.' })).status === 403);
      check('editor cannot delete the admin\'s post', (await editor.post(`${adminPostUrl}/delete`)).status === 403);
      check('editor cannot open the admin area', (await editor.req('/admin/users')).status === 403);
      check('editor cannot create users',
        (await editor.post('/admin/users', { username: `x${TAG}`, password: 'Some-Long-Pass-1', role: 'admin' })).status === 403);

      const adminEdit = await admin.post(mineUrl, { title: `Editor post ${TAG} by admin`, body: 'Edited by the admin.' });
      check('admin can edit the editor\'s post', adminEdit.status === 303);
      const adminDelete = await admin.post(`${mineUrl}/delete`);
      check('admin can delete the editor\'s post', adminDelete.status === 303 && (await visitor.req(mineUrl)).status === 404);
    }
  } else {
    console.log('SKIP  editor checks (set EDITOR_PASSWORD to run them)');
  }

  // ---- admin area
  const users = await admin.req('/admin/users');
  check('admin can open the Users page', users.status === 200 && /Users/.test(users.text));

  // ---- DELETE and clean up
  const confirm = await admin.req(`${adminPostUrl}/delete`);
  check('delete asks for confirmation first', confirm.status === 200 && /Delete this post\?/.test(confirm.text));
  const del = await admin.post(`${adminPostUrl}/delete`);
  check('DELETE the post', del.status === 303 && (await visitor.req(adminPostUrl)).status === 404);
  if (xss.location) await admin.post(`${xss.location}/delete`);
  check('test posts cleaned up', countCards((await visitor.req(`/?q=${TAG}`)).text) === 0);

  // ---- logout
  const out = await admin.post('/logout');
  check('logout works', out.status === 303 && (await admin.req('/posts/new')).status === 303);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`\nStopped: ${err.message}`);
  process.exit(1);
});
