'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { loadConfig } = require('./config');
const { createStore } = require('./db');
const sec = require('./security');
const v = require('./validate');
const views = require('./views');
const { coverSvg } = require('./cover');
const { plainExcerpt } = require('./content');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const FAVICON = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#14161c"/>' +
  '<path d="M14 52l6-17L44 11a5.5 5.5 0 018 8L28 44z" fill="#c9a96a"/><path d="M20 35l9 9" stroke="#14161c" stroke-width="3"/></svg>',
);

// ---------------------------------------------------------------- helpers --

function parseCookies(header) {
  const out = Object.create(null);
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function clientIp(req, config) {
  if (config.trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string') {
      const hops = xff.split(',').map((s) => s.trim()).filter(Boolean);
      // The last entry is the address our own proxy saw; earlier ones can be forged.
      if (hops.length) return hops[hops.length - 1];
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new HttpError(413, 'That request was too large.'));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'That request was too large.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseForm(rawBody) {
  const form = Object.create(null); // null prototype: no prototype pollution
  let count = 0;
  for (const [key, value] of new URLSearchParams(rawBody)) {
    count += 1;
    if (count > 50 || key.length > 64) throw new HttpError(400, 'Bad request.');
    if (!(key in form)) form[key] = value;
  }
  return form;
}

// Reject cross-site form posts: the Origin (or Referer) must match our own host.
function checkOrigin(req) {
  const source = req.headers.origin || req.headers.referer;
  if (!source) return; // the CSRF token is still required
  let host;
  try {
    host = new URL(source).host;
  } catch {
    throw new HttpError(403, 'Cross-site request blocked.');
  }
  if (host !== req.headers.host) throw new HttpError(403, 'Cross-site request blocked.');
}

const canModify = (user, post) => Boolean(user) && (user.role === 'admin' || user.id === post.author_id);

function navCurrent(pathname) {
  if (pathname === '/') return 'articles';
  if (pathname === '/about') return 'about';
  if (pathname === '/posts/new') return 'write';
  if (pathname.startsWith('/admin/users')) return 'users';
  return '';
}

// -------------------------------------------------------------------- app --

function createApp(overrides = {}) {
  const config = loadConfig(overrides);
  const store = createStore(config.dbFile);

  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'));
  // Fonts are served from an exact whitelist (no directory access), long-cached.
  const FONT_FILES = {
    '/static/fonts/playfair-display.woff': 'playfair-display.woff',
    '/static/fonts/playfair-display-italic.woff': 'playfair-display-italic.woff',
  };
  const fonts = Object.fromEntries(Object.entries(FONT_FILES).map(([url, file]) =>
    [url, fs.readFileSync(path.join(__dirname, '..', 'public', 'fonts', file))]));
  const globalLimiter = new sec.RateLimiter({ windowMs: 60 * 1000, max: config.globalRateMax });
  const loginLimiter = new sec.RateLimiter({ windowMs: 15 * 60 * 1000, max: config.loginMaxAttempts });

  // Verifying against a dummy hash for unknown usernames keeps response
  // time the same, so attackers cannot tell which usernames exist.
  const dummyHash = sec.hashPassword('not-a-real-password', config.scryptN);

  const cookieName = config.cookieSecure ? '__Host-sid' : 'sid';
  const cookieFor = (token, maxAgeMs) =>
    `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${
      config.cookieSecure ? '; Secure' : ''}`;

  // ---------------------------------------------------------- responding --

  function send(ctx, status, body, type = 'text/html; charset=utf-8', extra = {}) {
    const { res } = ctx;
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    res.statusCode = status;
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', payload.length);
    if (ctx.setCookies.length) res.setHeader('Set-Cookie', ctx.setCookies);
    for (const [k, val] of Object.entries(extra)) res.setHeader(k, val);
    res.end(payload);
  }

  function render(ctx, status, main, title, extra = {}) {
    const flash = ctx.session ? store.takeFlash(ctx.session.token_hash) : null;
    const page = views.layout({
      siteName: config.siteName,
      user: ctx.user,
      csrf: ctx.session ? ctx.session.csrf : '',
      flash,
      title,
      main,
      current: navCurrent(ctx.url ? ctx.url.pathname : ''),
      ...extra,
    });
    send(ctx, status, page.value, 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
  }

  function redirect(ctx, location) {
    const { res } = ctx;
    res.statusCode = 303;
    res.setHeader('Location', location);
    res.setHeader('Cache-Control', 'no-store');
    if (ctx.setCookies.length) res.setHeader('Set-Cookie', ctx.setCookies);
    res.end();
  }

  function flashRedirect(ctx, location, type, text) {
    if (ctx.session) store.setFlash(ctx.session.token_hash, { type, text });
    redirect(ctx, location);
  }

  // ------------------------------------------------------------ sessions --

  function loadSession(ctx) {
    const token = parseCookies(ctx.req.headers.cookie)[cookieName];
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const row = store.getSession(token);
    if (!row) return;
    ctx.session = row;
    if (row.user_id) ctx.user = { id: row.user_id, username: row.username, role: row.role };
  }

  // Anonymous visitors only get a session when they need one (the login form's CSRF token).
  function ensureSession(ctx) {
    if (ctx.session) return;
    const s = store.createSession({ userId: null, ttlMs: config.anonSessionMs });
    ctx.session = { token_hash: s.tokenHash, csrf: s.csrf, user_id: null };
    ctx.setCookies.push(cookieFor(s.token, config.anonSessionMs));
  }

  function startUserSession(ctx, userId, flashText) {
    if (ctx.session) store.deleteSession(ctx.session.token_hash); // rotate: defeats session fixation
    const s = store.createSession({ userId, ttlMs: config.sessionTtlMs });
    ctx.setCookies.push(cookieFor(s.token, config.sessionTtlMs));
    store.setFlash(s.tokenHash, { type: 'ok', text: flashText });
  }

  // -------------------------------------------------------------- routes --

  const routes = [];
  const add = (method, re, auth, handler) => routes.push({ method, re, auth, handler });

  // ---- public: reading, searching, paging
  add('GET', /^\/$/, 'public', (ctx) => {
    const q = v.parseQuery(ctx.url.searchParams.get('q'));
    const category = v.parseCategory(ctx.url.searchParams.get('category'));
    const total = store.countPosts(q, category);
    const pages = Math.max(1, Math.ceil(total / config.pageSize));
    const page = Math.min(v.parsePage(ctx.url.searchParams.get('page')), pages);
    const posts = store.listPosts({ q, category, limit: config.pageSize, offset: (page - 1) * config.pageSize });
    const title = q ? 'Search' : category || undefined;
    render(ctx, 200, views.home({
      posts, q, category, page, pages, total, counts: store.categoryCounts(), siteName: config.siteName,
    }), title);
  });

  add('GET', /^\/posts\/(\d{1,9})$/, 'public', (ctx, [id]) => {
    const post = store.getPost(Number(id));
    if (!post) throw new HttpError(404, 'That article does not exist.');
    const related = store.relatedPosts(post.id, post.category, 3);
    render(ctx, 200, views.postPage({ post, canModify: canModify(ctx.user, post), related }), post.title, {
      description: plainExcerpt(post.body, 160),
      ogType: 'article',
      progress: true,
    });
  });

  // Generated cover art: no upload, no storage, nothing to lose when the disk is wiped.
  add('GET', /^\/covers\/(\d{1,9})\.svg$/, 'public', (ctx, [id]) => {
    const post = store.getPost(Number(id));
    if (!post) throw new HttpError(404, 'Page not found.');
    send(ctx, 200, coverSvg(post.id, post.category), 'image/svg+xml', { 'Cache-Control': 'public, max-age=86400' });
  });

  add('GET', /^\/about$/, 'public', (ctx) => {
    render(ctx, 200, views.about({ siteName: config.siteName }), 'About', {
      description: `About ${config.siteName}, an independent publication on building software that stays secure.`,
    });
  });

  // ---- auth
  add('GET', /^\/login$/, 'public', (ctx) => {
    if (ctx.user) return redirect(ctx, '/');
    ensureSession(ctx);
    return render(ctx, 200, views.login({ csrf: ctx.session.csrf }), 'Log in');
  });

  add('POST', /^\/login$/, 'public', async (ctx) => {
    const fail = (status, error, username = '') =>
      render(ctx, status, views.login({ csrf: ctx.session.csrf, error, username }), 'Log in');

    const attempt = loginLimiter.consume(ctx.ip);
    if (!attempt.allowed) {
      ctx.res.setHeader('Retry-After', String(attempt.retryAfter));
      return fail(429, `Too many login attempts. Try again in ${Math.ceil(attempt.retryAfter / 60)} minute(s).`);
    }

    const username = v.cleanLine(ctx.form.username, 64);
    const password = typeof ctx.form.password === 'string' ? ctx.form.password : '';
    const generic = 'Invalid username or password.';
    if (!username || !password || password.length > 128) return fail(401, generic, username);

    const user = store.getUserByUsername(username);
    const ok = await sec.verifyPassword(password, user ? user.password_hash : await dummyHash);
    if (!user || !ok) return fail(401, generic, username);

    loginLimiter.reset(ctx.ip);
    startUserSession(ctx, user.id, `Welcome back, ${user.username}.`);
    return redirect(ctx, '/');
  });

  add('POST', /^\/logout$/, 'public', (ctx) => {
    store.deleteSession(ctx.session.token_hash);
    const s = store.createSession({ userId: null, ttlMs: config.anonSessionMs });
    ctx.setCookies.push(cookieFor(s.token, config.anonSessionMs));
    store.setFlash(s.tokenHash, { type: 'ok', text: 'You have been logged out.' });
    redirect(ctx, '/');
  });

  // ---- posts: write (admin and editor)
  add('GET', /^\/posts\/new$/, 'user', (ctx) => {
    render(ctx, 200, views.postForm({ mode: 'new', values: { title: '', body: '', category: v.DEFAULT_CATEGORY }, csrf: ctx.session.csrf }), 'New article');
  });

  add('POST', /^\/posts$/, 'user', (ctx) => {
    const { values, errors } = v.validatePost(ctx.form);
    if (errors) {
      return render(ctx, 422, views.postForm({ mode: 'new', values, errors, csrf: ctx.session.csrf }), 'New article');
    }
    const id = store.createPost({
      title: values.title, body: values.body, category: values.category, authorId: ctx.user.id,
    });
    return flashRedirect(ctx, `/posts/${id}`, 'ok', 'Article published.');
  });

  // Preview: validates like a real save, shows the finished article, publishes nothing.
  add('POST', /^\/posts\/preview$/, 'user', (ctx) => {
    let post = null;
    const rawId = typeof ctx.form.post_id === 'string' ? ctx.form.post_id : '';
    if (rawId !== '') {
      if (!/^\d{1,9}$/.test(rawId)) throw new HttpError(400, 'Bad request.');
      post = ownedPost(ctx, rawId); // editing someone else's article is refused here too
    }
    const mode = post ? 'edit' : 'new';
    const { values, errors } = v.validatePost(ctx.form);
    const title = post ? 'Edit article' : 'New article';
    if (errors) {
      return render(ctx, 422, views.postForm({ mode, post, values, errors, csrf: ctx.session.csrf }), title);
    }
    if (ctx.form._action === 'edit') {
      return render(ctx, 200, views.postForm({ mode, post, values, csrf: ctx.session.csrf }), title);
    }
    return render(ctx, 200, views.previewPage({ mode, post, values, user: ctx.user, csrf: ctx.session.csrf }), 'Preview');
  });

  function ownedPost(ctx, id) {
    const post = store.getPost(Number(id));
    if (!post) throw new HttpError(404, 'That post does not exist.');
    if (!canModify(ctx.user, post)) throw new HttpError(403, 'You can only change your own posts.');
    return post;
  }

  add('GET', /^\/posts\/(\d{1,9})\/edit$/, 'user', (ctx, [id]) => {
    const post = ownedPost(ctx, id);
    render(ctx, 200, views.postForm({
      mode: 'edit', post, values: { title: post.title, body: post.body, category: post.category }, csrf: ctx.session.csrf,
    }), 'Edit article');
  });

  add('POST', /^\/posts\/(\d{1,9})$/, 'user', (ctx, [id]) => {
    const post = ownedPost(ctx, id);
    const { values, errors } = v.validatePost(ctx.form);
    if (errors) {
      return render(ctx, 422, views.postForm({ mode: 'edit', post, values, errors, csrf: ctx.session.csrf }), 'Edit article');
    }
    store.updatePost(post.id, values);
    return flashRedirect(ctx, `/posts/${post.id}`, 'ok', 'Changes saved.');
  });

  add('GET', /^\/posts\/(\d{1,9})\/delete$/, 'user', (ctx, [id]) => {
    const post = ownedPost(ctx, id);
    render(ctx, 200, views.confirmDelete({
      heading: 'Delete this post?',
      detail: `“${post.title}” will be permanently removed.`,
      action: `/posts/${post.id}/delete`,
      cancelHref: `/posts/${post.id}`,
      csrf: ctx.session.csrf,
    }), 'Delete post');
  });

  add('POST', /^\/posts\/(\d{1,9})\/delete$/, 'user', (ctx, [id]) => {
    const post = ownedPost(ctx, id);
    store.deletePost(post.id);
    flashRedirect(ctx, '/', 'ok', 'Article deleted.');
  });

  // ---- own account
  add('GET', /^\/account$/, 'user', (ctx) => {
    render(ctx, 200, views.account({ user: ctx.user, csrf: ctx.session.csrf }), 'Account');
  });

  add('POST', /^\/account\/password$/, 'user', async (ctx) => {
    const again = (errors) =>
      render(ctx, 422, views.account({ user: ctx.user, csrf: ctx.session.csrf, errors }), 'Account');

    const limitKey = `pw:${ctx.user.id}`;
    const attempt = loginLimiter.consume(limitKey);
    if (!attempt.allowed) throw new HttpError(429, 'Too many attempts. Please wait and try again.');

    const row = store.getUserById(ctx.user.id);
    const current = typeof ctx.form.current === 'string' ? ctx.form.current : '';
    if (!(await sec.verifyPassword(current, row.password_hash))) {
      return again({ current: 'Current password is incorrect.' });
    }
    const next = v.validateNewPassword(ctx.form.password, row.username);
    if (next.error) return again({ password: next.error });
    if (ctx.form.confirm !== ctx.form.password) return again({ confirm: 'Passwords do not match.' });

    loginLimiter.reset(limitKey);
    store.setUserPassword(row.id, await sec.hashPassword(next.value, config.scryptN));
    store.deleteOtherSessions(row.id, ctx.session.token_hash);
    return flashRedirect(ctx, '/account', 'ok', 'Password updated. Other devices were signed out.');
  });

  // ---- admin: user management
  const renderUsers = (ctx, status, extra = {}) =>
    render(ctx, status, views.adminUsers({
      users: store.listUsers(), me: ctx.user, csrf: ctx.session.csrf, ...extra,
    }), 'Users');

  function targetUser(id) {
    const user = store.getUserById(Number(id));
    if (!user) throw new HttpError(404, 'That user does not exist.');
    return user;
  }

  add('GET', /^\/admin\/users$/, 'admin', (ctx) => renderUsers(ctx, 200));

  add('POST', /^\/admin\/users$/, 'admin', async (ctx) => {
    const username = v.validateUsername(ctx.form.username);
    const password = v.validateNewPassword(ctx.form.password, username.value);
    const role = v.validateRole(ctx.form.role);
    const errors = {};
    if (username.error) errors.username = username.error;
    else if (store.getUserByUsername(username.value)) errors.username = 'That username is already taken.';
    if (password.error) errors.password = password.error;
    if (role.error) errors.role = role.error;
    if (Object.keys(errors).length) {
      return renderUsers(ctx, 422, { errors, values: { username: username.value, role: role.value } });
    }
    store.createUser({
      username: username.value,
      passwordHash: await sec.hashPassword(password.value, config.scryptN),
      role: role.value,
    });
    return flashRedirect(ctx, '/admin/users', 'ok', `User “${username.value}” created.`);
  });

  add('POST', /^\/admin\/users\/(\d{1,9})\/role$/, 'admin', (ctx, [id]) => {
    const target = targetUser(id);
    const back = '/admin/users';
    if (target.id === ctx.user.id) return flashRedirect(ctx, back, 'error', 'You cannot change your own role.');
    const role = v.validateRole(ctx.form.role);
    if (role.error) return flashRedirect(ctx, back, 'error', role.error);
    if (target.role === 'admin' && role.value !== 'admin' && store.countAdmins() <= 1) {
      return flashRedirect(ctx, back, 'error', 'There must always be at least one admin.');
    }
    store.setUserRole(target.id, role.value);
    return flashRedirect(ctx, back, 'ok', `${target.username} is now ${role.value}.`);
  });

  add('POST', /^\/admin\/users\/(\d{1,9})\/password$/, 'admin', async (ctx, [id]) => {
    const target = targetUser(id);
    const back = '/admin/users';
    if (target.id === ctx.user.id) {
      return flashRedirect(ctx, back, 'error', 'Use your account page to change your own password.');
    }
    const password = v.validateNewPassword(ctx.form.password, target.username);
    if (password.error) return flashRedirect(ctx, back, 'error', password.error);
    store.setUserPassword(target.id, await sec.hashPassword(password.value, config.scryptN));
    store.deleteUserSessions(target.id);
    return flashRedirect(ctx, back, 'ok', `Password reset for ${target.username}.`);
  });

  add('GET', /^\/admin\/users\/(\d{1,9})\/delete$/, 'admin', (ctx, [id]) => {
    const target = targetUser(id);
    if (target.id === ctx.user.id) return flashRedirect(ctx, '/admin/users', 'error', 'You cannot delete yourself.');
    return render(ctx, 200, views.confirmDelete({
      heading: `Delete ${target.username}?`,
      detail: 'Their account is removed and their posts are kept under your name.',
      action: `/admin/users/${target.id}/delete`,
      cancelHref: '/admin/users',
      csrf: ctx.session.csrf,
    }), 'Delete user');
  });

  add('POST', /^\/admin\/users\/(\d{1,9})\/delete$/, 'admin', (ctx, [id]) => {
    const target = targetUser(id);
    const back = '/admin/users';
    if (target.id === ctx.user.id) return flashRedirect(ctx, back, 'error', 'You cannot delete yourself.');
    if (target.role === 'admin' && store.countAdmins() <= 1) {
      return flashRedirect(ctx, back, 'error', 'There must always be at least one admin.');
    }
    store.deleteUser(target.id, ctx.user.id);
    return flashRedirect(ctx, back, 'ok', `User “${target.username}” deleted.`);
  });

  // --------------------------------------------------------- dispatching --

  async function dispatch(ctx) {
    const { req, res } = ctx;

    if (!['GET', 'HEAD', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD, POST');
      throw new HttpError(405, 'That method is not allowed.');
    }
    if (req.url.length > 2048) throw new HttpError(414, 'That address is too long.');

    ctx.ip = clientIp(req, config);
    const limit = globalLimiter.consume(ctx.ip);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfter));
      throw new HttpError(429, 'Too many requests. Please slow down.');
    }

    try {
      ctx.url = new URL(req.url, 'http://localhost');
    } catch {
      throw new HttpError(400, 'Bad request.');
    }
    const { pathname } = ctx.url;
    const isRead = req.method === 'GET' || req.method === 'HEAD';

    // Static files: an exact whitelist, so there is no way to walk the filesystem.
    if (isRead && pathname === '/static/style.css') {
      return send(ctx, 200, css, 'text/css; charset=utf-8', { 'Cache-Control': 'public, max-age=3600' });
    }
    if (isRead && fonts[pathname]) {
      return send(ctx, 200, fonts[pathname], 'font/woff', { 'Cache-Control': 'public, max-age=31536000, immutable' });
    }
    if (isRead && pathname === '/favicon.svg') {
      return send(ctx, 200, FAVICON, 'image/svg+xml', { 'Cache-Control': 'public, max-age=86400' });
    }
    if (isRead && pathname === '/healthz') {
      return send(ctx, 200, 'ok', 'text/plain; charset=utf-8', { 'Cache-Control': 'no-store' });
    }

    // Find the route. A path that exists under a different method is a 405, not a 404.
    const wanted = req.method === 'HEAD' ? 'GET' : req.method;
    let match = null;
    const allowed = new Set();
    for (const r of routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      allowed.add(r.method);
      if (r.method === wanted) match = { route: r, params: m.slice(1) };
    }
    if (!match) {
      if (allowed.size) {
        res.setHeader('Allow', [...allowed].join(', '));
        throw new HttpError(405, 'That method is not allowed.');
      }
      throw new HttpError(404, 'Page not found.');
    }

    loadSession(ctx);

    // Every POST: same-origin check, form content type, size cap, then the CSRF token.
    if (req.method === 'POST') {
      checkOrigin(req);
      const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/x-www-form-urlencoded') {
        throw new HttpError(415, 'Unsupported content type.');
      }
      ctx.form = parseForm(await readBody(req, config.maxBodyBytes));
      const token = typeof ctx.form._csrf === 'string' ? ctx.form._csrf : '';
      if (!ctx.session || !sec.safeEqual(token, ctx.session.csrf)) {
        throw new HttpError(403, 'Security check failed. Go back, reload the page and try again.');
      }
    }

    // Role gate.
    const { auth } = match.route;
    if (auth !== 'public') {
      if (!ctx.user) {
        ensureSession(ctx);
        return flashRedirect(ctx, '/login', 'error', 'Please log in to continue.');
      }
      if (auth === 'admin' && ctx.user.role !== 'admin') {
        throw new HttpError(403, 'Admins only.');
      }
    }

    return match.route.handler(ctx, match.params);
  }

  function handleError(ctx, err) {
    const { req, res } = ctx;
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) {
      // Details go to the server log only; the visitor sees a generic message.
      console.error(`[error] ${req.method} ${(req.url || '').slice(0, 100)}: ${err && err.stack ? err.stack : err}`);
    }
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (req.method === 'POST' && !req.readableEnded) {
      res.setHeader('Connection', 'close');
      req.resume();
    }
    const message = err instanceof HttpError ? err.message : 'Something went wrong on our side. Please try again.';
    try {
      render(ctx, status, views.errorPage({ status, message }), String(status));
    } catch {
      res.statusCode = status;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(message);
    }
  }

  async function handle(req, res) {
    const started = Date.now();
    const ctx = { req, res, config, ip: '', url: null, session: null, user: null, form: null, setCookies: [] };
    if (!config.quiet) {
      res.on('finish', () => {
        const where = ctx.url ? ctx.url.pathname : '-';
        console.log(`${req.method} ${where} ${res.statusCode} ${Date.now() - started}ms`);
      });
    }
    sec.setSecurityHeaders(res, config);
    try {
      await dispatch(ctx);
    } catch (err) {
      handleError(ctx, err);
    }
  }

  // ------------------------------------------------------------- server --

  const server = http.createServer(handle);
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;

  const timer = setInterval(() => {
    store.purgeSessions();
    globalLimiter.sweep();
    loginLimiter.sweep();
  }, 10 * 60 * 1000);
  timer.unref();

  return {
    server,
    store,
    config,
    close: () => new Promise((resolve) => {
      clearInterval(timer);
      server.close(() => {
        try { store.close(); } catch { /* already closed */ }
        resolve();
      });
      server.closeAllConnections();
    }),
  };
}

module.exports = { createApp, HttpError };
