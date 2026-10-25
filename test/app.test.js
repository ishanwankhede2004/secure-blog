'use strict';
// End-to-end tests: real HTTP requests against a real server on a random port,
// using an in-memory database. Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createApp } = require('../src/app');
const { hashPassword, verifyPassword } = require('../src/security');

const PASSWORD = 'Correct-Horse-9';

async function boot(overrides = {}) {
  const app = createApp({
    dbFile: ':memory:',
    quiet: true,
    isProd: false, // tests must not depend on the NODE_ENV of whoever runs them
    cookieSecure: false,
    scryptN: 1024, // fast hashing for tests only
    globalRateMax: 100000,
    loginMaxAttempts: 1000,
    pageSize: 6,
    ...overrides,
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const addUser = async (username, role, password = PASSWORD) =>
    app.store.createUser({ username, role, passwordHash: await hashPassword(password, 1024) });

  const admin = await addUser('alice', 'admin');
  const editor = await addUser('erin', 'editor');
  const editor2 = await addUser('evan', 'editor');
  return { app, base, addUser, ids: { admin, editor, editor2 }, close: () => app.close() };
}

// A tiny browser: keeps cookies, never follows redirects, can fetch CSRF tokens.
class Client {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
  }

  async req(path, { method = 'GET', form, headers = {}, body, contentType } = {}) {
    const h = { ...headers };
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, val]) => `${k}=${val}`).join('; ');
    let payload = body;
    if (form) {
      payload = new URLSearchParams(form).toString();
      h['content-type'] = 'application/x-www-form-urlencoded';
    }
    if (contentType) h['content-type'] = contentType;
    const res = await fetch(this.base + path, { method, headers: h, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(';')[0];
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const val = pair.slice(i + 1);
      if (/max-age=0/i.test(c) || val === '') this.cookies.delete(name);
      else this.cookies.set(name, val);
    }
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, location: res.headers.get('location') };
  }

  async csrf(path) {
    const r = await this.req(path);
    const m = r.text.match(/name="_csrf" value="([^"]+)"/);
    assert.ok(m, `no CSRF token on ${path} (status ${r.status})`);
    return m[1];
  }

  async login(username, password = PASSWORD) {
    const token = await this.csrf('/login');
    return this.req('/login', { method: 'POST', form: { _csrf: token, username, password } });
  }

  // POST with a valid CSRF token taken from the home page (logged-in users have one in the nav).
  async post(path, form = {}) {
    const token = await this.csrf('/');
    return this.req(path, { method: 'POST', form: { _csrf: token, ...form } });
  }

  get sid() {
    return this.cookies.get('sid');
  }
}

async function loggedIn(ctx, username) {
  const c = new Client(ctx.base);
  const r = await c.login(username);
  assert.equal(r.status, 303, `login as ${username} should redirect`);
  return c;
}

// Sends the path exactly as given (fetch would tidy "/../" away before sending).
function rawGet(base, path) {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    http.get({ host: url.hostname, port: url.port, path }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    }).on('error', reject);
  });
}

const countCards = (text) => (text.match(/<li class="card">/g) || []).length;

// ------------------------------------------------------------------------ 1
test('passwords are stored as salted scrypt hashes, never plain text', async () => {
  const ctx = await boot();
  try {
    const row = ctx.app.store.getUserByUsername('alice');
    assert.match(row.password_hash, /^scrypt\$\d+\$8\$1\$/);
    assert.ok(!row.password_hash.includes(PASSWORD));

    const a = await hashPassword('same-password-1', 1024);
    const b = await hashPassword('same-password-1', 1024);
    assert.notEqual(a, b, 'the salt must make equal passwords hash differently');
    assert.equal(await verifyPassword('same-password-1', a), true);
    assert.equal(await verifyPassword('wrong-password-1', a), false);
    assert.equal(await verifyPassword('x', 'garbage'), false);

    // Default production strength (N=32768) also works.
    const strong = await hashPassword('production-strength-1');
    assert.match(strong, /^scrypt\$32768\$/);
    assert.equal(await verifyPassword('production-strength-1', strong), true);
  } finally { await ctx.close(); }
});

test('login: wrong credentials fail with one generic message; correct ones succeed', async () => {
  const ctx = await boot();
  try {
    const c = new Client(ctx.base);
    const badPass = await c.login('alice', 'nope-nope-nope');
    const badUser = await c.login('nobody', 'nope-nope-nope');
    assert.equal(badPass.status, 401);
    assert.equal(badUser.status, 401);
    assert.match(badPass.text, /Invalid username or password/);
    assert.match(badUser.text, /Invalid username or password/);

    const ok = await c.login('ALICE'); // usernames are case-insensitive
    assert.equal(ok.status, 303);
    const home = await c.req('/');
    assert.match(home.text, /Welcome back, alice/);
    assert.match(home.text, /Log out/);
  } finally { await ctx.close(); }
});

test('sessions: cookie flags, rotation on login, invalidation on logout', async () => {
  const ctx = await boot();
  try {
    const c = new Client(ctx.base);
    const page = await c.req('/login');
    const setCookie = page.headers.getSetCookie()[0];
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    const before = c.sid;
    assert.ok(before);

    await c.login('alice');
    const after = c.sid;
    assert.notEqual(before, after, 'session id must change after login (fixation defence)');

    const stolen = new Client(ctx.base);
    stolen.cookies.set('sid', before);
    assert.equal((await stolen.req('/account')).status, 303, 'pre-login id must not be a valid session');

    const keep = new Client(ctx.base);
    keep.cookies.set('sid', after);
    assert.equal((await keep.req('/account')).status, 200);

    const out = await c.post('/logout');
    assert.equal(out.status, 303);
    assert.equal((await keep.req('/account')).status, 303, 'old session must die on logout');
  } finally { await ctx.close(); }
});

test('production cookie is __Host- prefixed and Secure, with HSTS', async () => {
  const ctx = await boot({ cookieSecure: true, isProd: true });
  try {
    const r = await new Client(ctx.base).req('/login');
    const cookie = r.headers.getSetCookie()[0];
    assert.match(cookie, /^__Host-sid=/);
    assert.match(cookie, /; Secure/);
    assert.match(r.headers.get('strict-transport-security'), /max-age=/);
  } finally { await ctx.close(); }
});

// ------------------------------------------------------------------------ 2
test('CRUD: an editor can create, read, update and delete their own post', async () => {
  const ctx = await boot();
  try {
    const c = await loggedIn(ctx, 'erin');

    const created = await c.post('/posts', { title: 'My first post', body: 'Hello world, this is the body.' });
    assert.equal(created.status, 303);
    const url = created.location;
    assert.match(url, /^\/posts\/\d+$/);

    const read = await c.req(url);
    assert.equal(read.status, 200);
    assert.match(read.text, /My first post/);
    assert.match(read.text, /Hello world/);

    const id = url.split('/').pop();
    const edit = await c.req(`/posts/${id}/edit`);
    assert.equal(edit.status, 200);
    assert.match(edit.text, /value="My first post"/);

    const updated = await c.post(`/posts/${id}`, { title: 'Edited title', body: 'Edited body text here.' });
    assert.equal(updated.status, 303);
    const reread = await c.req(url);
    assert.match(reread.text, /Edited title/);
    assert.ok(!/My first post/.test(reread.text));

    const confirm = await c.req(`/posts/${id}/delete`);
    assert.equal(confirm.status, 200);
    assert.match(confirm.text, /Delete this post\?/);
    const del = await c.post(`/posts/${id}/delete`);
    assert.equal(del.status, 303);
    assert.equal((await c.req(url)).status, 404);
  } finally { await ctx.close(); }
});

test('roles: visitors, editors and admins are held to their permissions', async () => {
  const ctx = await boot();
  try {
    const { store } = ctx.app;
    const alicePost = store.createPost({ title: 'Alice post', body: 'Written by the admin user.', authorId: ctx.ids.admin });
    const erinPost = store.createPost({ title: 'Erin post', body: 'Written by editor erin.', authorId: ctx.ids.editor });

    // Visitor: can read, cannot write.
    const visitor = new Client(ctx.base);
    assert.equal((await visitor.req(`/posts/${alicePost}`)).status, 200);
    const gate = await visitor.req('/posts/new');
    assert.equal(gate.status, 303);
    assert.equal(gate.location, '/login');
    assert.equal((await visitor.req('/admin/users')).status, 303);

    // Editor: own posts only, no admin area.
    const evan = await loggedIn(ctx, 'evan');
    assert.equal((await evan.req(`/posts/${erinPost}/edit`)).status, 403);
    assert.equal((await evan.post(`/posts/${erinPost}`, { title: 'Hacked title', body: 'Overwritten by evan.' })).status, 403);
    assert.equal((await evan.post(`/posts/${erinPost}/delete`)).status, 403);
    assert.equal((await evan.req('/admin/users')).status, 403);
    assert.equal((await evan.post('/admin/users', { username: 'mallory', password: PASSWORD, role: 'admin' })).status, 403);
    assert.equal(store.getUserByUsername('mallory'), undefined);
    assert.equal(store.getPost(erinPost).title, 'Erin post');

    // Admin: can edit anyone's post and use the admin area.
    const alice = await loggedIn(ctx, 'alice');
    assert.equal((await alice.post(`/posts/${erinPost}`, { title: 'Admin edit', body: 'Edited by the admin.' })).status, 303);
    assert.equal(store.getPost(erinPost).title, 'Admin edit');
    assert.equal((await alice.req('/admin/users')).status, 200);
  } finally { await ctx.close(); }
});

test('admin user management: create, change role, reset password, delete', async () => {
  const ctx = await boot();
  try {
    const { store } = ctx.app;
    const alice = await loggedIn(ctx, 'alice');

    const weak = await alice.post('/admin/users', { username: 'newbie', password: 'short', role: 'editor' });
    assert.equal(weak.status, 422);
    assert.match(weak.text, /at least 10 characters/);
    const badName = await alice.post('/admin/users', { username: "x'; DROP TABLE users;--", password: PASSWORD, role: 'editor' });
    assert.equal(badName.status, 422);
    const dup = await alice.post('/admin/users', { username: 'ERIN', password: PASSWORD, role: 'editor' });
    assert.equal(dup.status, 422);
    assert.match(dup.text, /already taken/);

    const made = await alice.post('/admin/users', { username: 'newbie', password: PASSWORD, role: 'editor' });
    assert.equal(made.status, 303);
    const newbie = store.getUserByUsername('newbie');
    assert.equal(newbie.role, 'editor');
    assert.ok(newbie.password_hash.startsWith('scrypt$'));

    assert.equal((await alice.post(`/admin/users/${newbie.id}/role`, { role: 'admin' })).status, 303);
    assert.equal(store.getUserById(newbie.id).role, 'admin');
    assert.equal((await alice.post(`/admin/users/${newbie.id}/role`, { role: 'superuser' })).status, 303);
    assert.equal(store.getUserById(newbie.id).role, 'admin', 'invalid role must be ignored');

    const before = store.getUserById(newbie.id).password_hash;
    assert.equal((await alice.post(`/admin/users/${newbie.id}/password`, { password: 'A-brand-new-pass-1' })).status, 303);
    assert.notEqual(store.getUserById(newbie.id).password_hash, before);

    // Self-protection
    await alice.post(`/admin/users/${ctx.ids.admin}/role`, { role: 'editor' });
    assert.equal(store.getUserById(ctx.ids.admin).role, 'admin');
    await alice.post(`/admin/users/${ctx.ids.admin}/delete`);
    assert.ok(store.getUserById(ctx.ids.admin));

    // Deleting an author keeps their posts.
    const post = store.createPost({ title: 'Keep me', body: 'This post must survive its author.', authorId: ctx.ids.editor });
    assert.equal((await alice.post(`/admin/users/${ctx.ids.editor}/delete`)).status, 303);
    assert.equal(store.getUserById(ctx.ids.editor), undefined);
    assert.equal(store.getPost(post).author_id, ctx.ids.admin);
  } finally { await ctx.close(); }
});

test('changing your password signs out other sessions', async () => {
  const ctx = await boot();
  try {
    const laptop = await loggedIn(ctx, 'erin');
    const phone = await loggedIn(ctx, 'erin');
    assert.equal((await phone.req('/account')).status, 200);

    const wrong = await laptop.post('/account/password', { current: 'wrong-wrong-1', password: 'Another-Pass-77', confirm: 'Another-Pass-77' });
    assert.equal(wrong.status, 422);
    const mismatch = await laptop.post('/account/password', { current: PASSWORD, password: 'Another-Pass-77', confirm: 'different' });
    assert.equal(mismatch.status, 422);

    const ok = await laptop.post('/account/password', { current: PASSWORD, password: 'Another-Pass-77', confirm: 'Another-Pass-77' });
    assert.equal(ok.status, 303);
    assert.equal((await laptop.req('/account')).status, 200, 'current session stays signed in');
    assert.equal((await phone.req('/account')).status, 303, 'other session is signed out');

    assert.equal((await new Client(ctx.base).login('erin', PASSWORD)).status, 401);
    assert.equal((await new Client(ctx.base).login('erin', 'Another-Pass-77')).status, 303);
  } finally { await ctx.close(); }
});

// ------------------------------------------------------------------------ 3
test('pagination: page size, clamping and bad page values', async () => {
  const ctx = await boot();
  try {
    for (let i = 1; i <= 15; i += 1) {
      ctx.app.store.createPost({ title: `Entry number ${i}`, body: 'Some filler text for pagination.', authorId: ctx.ids.admin });
    }
    const c = new Client(ctx.base);

    const p1 = await c.req('/');
    assert.equal(countCards(p1.text), 6);
    assert.match(p1.text, /Page 1 of 3/);
    assert.match(p1.text, /15 posts/);
    assert.match(p1.text, /href="\/\?page=2"/);

    assert.equal(countCards((await c.req('/?page=2')).text), 6);
    const p3 = await c.req('/?page=3');
    assert.equal(countCards(p3.text), 3);
    assert.match(p3.text, /Page 3 of 3/);

    assert.match((await c.req('/?page=999')).text, /Page 3 of 3/, 'too-high page clamps to the last page');
    for (const bad of ['abc', '-5', '0', '1e9', "1' OR '1'='1"]) {
      const r = await c.req(`/?page=${encodeURIComponent(bad)}`);
      assert.equal(r.status, 200);
      assert.match(r.text, /Page 1 of 3/);
    }
  } finally { await ctx.close(); }
});

test('search: matches title and body, ignores case, keeps the query across pages', async () => {
  const ctx = await boot();
  try {
    const { store } = ctx.app;
    for (let i = 1; i <= 8; i += 1) {
      store.createPost({ title: `Gardening tip ${i}`, body: 'Water the tomatoes early in the day.', authorId: ctx.ids.admin });
    }
    store.createPost({ title: 'Totally unrelated', body: 'This mentions a Zeppelin in the body.', authorId: ctx.ids.admin });
    store.createPost({ title: 'Discount: 100% sure', body: 'Percent sign in the title.', authorId: ctx.ids.admin });
    const c = new Client(ctx.base);

    const byTitle = await c.req('/?q=GARDENING');
    assert.equal(countCards(byTitle.text), 6);
    assert.match(byTitle.text, /8 posts matching “GARDENING”/);
    assert.match(byTitle.text, /href="\/\?q=GARDENING&amp;page=2"/);
    assert.equal(countCards((await c.req('/?q=GARDENING&page=2')).text), 2);

    assert.match((await c.req('/?q=zeppelin')).text, /Totally unrelated/);

    // LIKE wildcards are literal: "%" only matches the post that really contains "%".
    const pct = await c.req(`/?q=${encodeURIComponent('%')}`);
    assert.equal(countCards(pct.text), 1);
    assert.match(pct.text, /100% sure/);
    assert.match((await c.req(`/?q=${encodeURIComponent('_')}`)).text, /0 posts matching/);

    const none = await c.req('/?q=doesnotexist');
    assert.match(none.text, /No posts match your search/);
  } finally { await ctx.close(); }
});

test('mobile friendly: viewport meta tag and responsive stylesheet', async () => {
  const ctx = await boot();
  try {
    const c = new Client(ctx.base);
    assert.match((await c.req('/')).text, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    const css = await c.req('/static/style.css');
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);
    assert.match(css.text, /@media \(min-width: 40rem\)/);
    assert.match(css.text, /min-height: 44px/, 'touch targets are at least 44px');
  } finally { await ctx.close(); }
});

// ------------------------------------------------------------------------ 4
test('XSS: scripts in titles, bodies and search terms are shown as text', async () => {
  const ctx = await boot();
  try {
    const c = await loggedIn(ctx, 'erin');
    const created = await c.post('/posts', {
      title: '<img src=x onerror=alert(1)> "quoted"',
      body: '<script>alert("xss")</script>\n\n<b>bold?</b>',
    });
    assert.equal(created.status, 303);

    for (const page of [created.location, '/']) {
      const r = await c.req(page);
      assert.ok(!r.text.includes('<script>alert'), `raw script tag leaked on ${page}`);
      assert.ok(!r.text.includes('<img src=x'), `raw img tag leaked on ${page}`);
      assert.match(r.text, /&lt;img src=x onerror=alert\(1\)&gt;/);
    }
    const post = await c.req(created.location);
    assert.match(post.text, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/);
    assert.ok(!post.text.includes('<b>bold?</b>'));

    const reflected = await c.req(`/?q=${encodeURIComponent('"><svg onload=alert(1)>')}`);
    assert.ok(!reflected.text.includes('<svg onload'));
    assert.ok(!reflected.text.includes('"><svg'));

    const login = await new Client(ctx.base).login('"><script>x</script>', 'whatever-123');
    assert.ok(!login.text.includes('<script>x</script>'));
  } finally { await ctx.close(); }
});

test('SQL injection attempts are treated as plain text', async () => {
  const ctx = await boot();
  try {
    ctx.app.store.createPost({ title: 'Normal post', body: 'Nothing special in here.', authorId: ctx.ids.admin });
    const c = new Client(ctx.base);

    for (const q of ["' OR '1'='1", "'; DROP TABLE posts;--", "%' UNION SELECT username, password_hash FROM users--"]) {
      const r = await c.req(`/?q=${encodeURIComponent(q)}`);
      assert.equal(r.status, 200);
      assert.match(r.text, /0 posts matching/);
      assert.ok(!r.text.includes('scrypt$'));
    }
    assert.equal(ctx.app.store.countPosts(''), 1, 'posts table must be intact');

    assert.equal((await c.login("alice' --", 'x-x-x-x-x-x-x')).status, 401);
    assert.equal((await new Client(ctx.base).login("' OR '1'='1", "' OR '1'='1")).status, 401);
    assert.ok(ctx.app.store.getUserByUsername('alice'), 'users table must be intact');
  } finally { await ctx.close(); }
});

test('CSRF: forged or token-less POSTs are rejected', async () => {
  const ctx = await boot();
  try {
    const noToken = await new Client(ctx.base).req('/login', { method: 'POST', form: { username: 'alice', password: PASSWORD } });
    assert.equal(noToken.status, 403);

    const c = await loggedIn(ctx, 'erin');
    const before = ctx.app.store.countPosts('');
    const missing = await c.req('/posts', { method: 'POST', form: { title: 'Forged post', body: 'Created without a token.' } });
    const wrong = await c.req('/posts', { method: 'POST', form: { _csrf: 'x'.repeat(43), title: 'Forged post', body: 'Created with a wrong token.' } });
    assert.equal(missing.status, 403);
    assert.equal(wrong.status, 403);
    assert.equal(ctx.app.store.countPosts(''), before);

    // Cross-site Origin is blocked even when the token is valid.
    const token = await c.csrf('/');
    const cross = await c.req('/posts', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
      form: { _csrf: token, title: 'Cross-site post', body: 'Sent from another origin.' },
    });
    assert.equal(cross.status, 403);
    assert.equal(ctx.app.store.countPosts(''), before);

    // Logout is a POST too, so a hostile image tag cannot log you out.
    assert.equal((await c.req('/logout')).status, 405);
  } finally { await ctx.close(); }
});

test('input validation: lengths, control characters and malformed bodies', async () => {
  const ctx = await boot();
  try {
    const c = await loggedIn(ctx, 'erin');

    const empty = await c.post('/posts', { title: '', body: '' });
    assert.equal(empty.status, 422);
    assert.match(empty.text, /Title must be at least 3/);
    assert.match(empty.text, /Body must be at least 10/);

    assert.equal((await c.post('/posts', { title: 'a'.repeat(121), body: 'valid body text' })).status, 422);
    assert.equal((await c.post('/posts', { title: 'Valid title', body: 'b'.repeat(20001) })).status, 422);
    assert.equal((await c.post('/posts', { title: '   ', body: 'valid body text' })).status, 422);

    // The user's input is kept in the form after an error.
    const kept = await c.post('/posts', { title: 'Kept title', body: 'short' });
    assert.match(kept.text, /value="Kept title"/);

    // Control characters (such as NUL) are stripped before saving.
    const ok = await c.post('/posts', { title: 'Nul\u0000 byte\u0007 title', body: 'Body with\u0000 hidden control chars.' });
    assert.equal(ok.status, 303);
    const saved = ctx.app.store.getPost(Number(ok.location.split('/').pop()));
    assert.equal(saved.title, 'Nul byte title');
    assert.equal(saved.body, 'Body with hidden control chars.');

    // Wrong content type, oversized body, absurd URL, unknown method.
    const json = await c.req('/posts', { method: 'POST', contentType: 'application/json', body: '{"title":"x"}' });
    assert.equal(json.status, 415);
    const big = await c.req('/posts', { method: 'POST', form: { _csrf: 'x', body: 'z'.repeat(70 * 1024) } });
    assert.equal(big.status, 413);
    assert.equal((await rawGet(ctx.base, `/${'a'.repeat(3000)}`)).status, 414);
    const put = await c.req('/', { method: 'PUT' });
    assert.equal(put.status, 405);
    assert.match(put.headers.get('allow'), /GET/);

    // Non-numeric and huge ids are plain 404s.
    assert.equal((await c.req('/posts/abc')).status, 404);
    assert.equal((await c.req('/posts/99999999999999999999')).status, 404);
    assert.equal((await c.req('/posts/0')).status, 404);
  } finally { await ctx.close(); }
});

test('rate limiting: repeated failed logins are blocked', async () => {
  const ctx = await boot({ loginMaxAttempts: 5 });
  try {
    const c = new Client(ctx.base);
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await c.login('alice', `wrong-guess-${i}`)).status, 401);
    }
    const blocked = await c.login('alice', PASSWORD); // even the right password is refused now
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    assert.match(blocked.text, /Too many login attempts/);
  } finally { await ctx.close(); }
});

test('global rate limit returns 429 when a client floods the server', async () => {
  const ctx = await boot({ globalRateMax: 20 });
  try {
    const c = new Client(ctx.base);
    const statuses = [];
    for (let i = 0; i < 25; i += 1) statuses.push((await c.req('/healthz')).status);
    assert.ok(statuses.slice(0, 20).every((s) => s === 200));
    assert.ok(statuses.slice(20).every((s) => s === 429));
  } finally { await ctx.close(); }
});

test('security headers are present on every response', async () => {
  const ctx = await boot();
  try {
    for (const path of ['/', '/login', '/nope', '/static/style.css']) {
      const r = await new Client(ctx.base).req(path);
      const csp = r.headers.get('content-security-policy');
      assert.match(csp, /default-src 'none'/, path);
      assert.match(csp, /frame-ancestors 'none'/, path);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff', path);
      assert.equal(r.headers.get('x-frame-options'), 'DENY', path);
      assert.equal(r.headers.get('referrer-policy'), 'same-origin', path);
    }
    assert.equal((await new Client(ctx.base).req('/')).headers.get('x-powered-by'), null);
  } finally { await ctx.close(); }
});

test('files outside the whitelist cannot be reached (path traversal)', async () => {
  const ctx = await boot();
  try {
    for (const path of [
      '/static/../src/app.js',
      '/static/../../etc/passwd',
      '/static/%2e%2e/src/db.js',
      '/src/app.js',
      '/data/blog.db',
      '/package.json',
      '/static/',
    ]) {
      const r = await rawGet(ctx.base, path);
      assert.equal(r.status, 404, path);
      assert.ok(!r.text.includes('createStore'), path);
    }
  } finally { await ctx.close(); }
});

test('errors are generic: 404 pages leak nothing', async () => {
  const ctx = await boot();
  try {
    const r = await new Client(ctx.base).req('/definitely-missing');
    assert.equal(r.status, 404);
    assert.match(r.text, /Page not found/);
    assert.ok(!/node_modules|\.js:\d+|at \w+/.test(r.text));
  } finally { await ctx.close(); }
});
