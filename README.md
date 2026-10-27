# Inkwell: a secure blog app

A small blog where logged-in users can **create, read, update and delete posts**. Built with Node.js and SQLite, with **no npm dependencies**, so there is nothing to install and very little attack surface.

| Requirement | How it is done |
|---|---|
| Login with hashed passwords | scrypt (memory-hard) with a random salt per user, constant-time comparison |
| Post search and pagination | `?q=` searches titles and text; 6 posts per page with Previous/Next and page numbers |
| Mobile-friendly design | Mobile-first CSS, 44px tap targets, responsive nav, dark mode, no horizontal scroll |
| Protection against attacks and bad input | See the security table below |
| Admin and editor roles | Admins manage every post and all users; editors manage only their own posts |

## Run it

Requires **Node.js 22.13 or newer** (uses the built-in `node:sqlite`). Developed and tested on Node 22.23.

```bash
npm run seed     # optional: demo users and 19 sample posts (prints the passwords once)
npm start        # http://localhost:3000
```

On first start with an empty database the app creates an admin account. Set `ADMIN_PASSWORD` to choose its password; otherwise a random one is printed in the console once. Log in, then change it on the **Account** page.

## Roles

| | Visitor | Editor | Admin |
|---|:-:|:-:|:-:|
| Read, search and page through posts | ✅ | ✅ | ✅ |
| Create posts | | ✅ | ✅ |
| Edit / delete own posts | | ✅ | ✅ |
| Edit / delete anyone's posts | | | ✅ |
| Add users, change roles, reset passwords, delete users | | | ✅ |

There is no public sign-up: an admin creates accounts (secure by default). Admins cannot demote or delete themselves, and the last admin can never be removed. When a user is deleted, their posts are kept and reassigned to the admin who deleted them.

## Security measures

| Threat | Defence | Where |
|---|---|---|
| Stolen database / weak storage | scrypt hashes (N=32768, r=8, p=1) with per-user salt; cost stored in the hash so it can be raised later | `src/security.js` |
| SQL injection | Prepared statements with bound parameters only; `LIKE` wildcards escaped | `src/db.js` |
| Cross-site scripting (XSS) | Every template value is HTML-escaped by default; posts render as escaped text; strict CSP (`default-src 'none'`, no scripts at all) | `src/html.js`, `src/views.js` |
| CSRF | Per-session token on every POST, constant-time check, `Origin`/`Referer` must match, `SameSite=Lax` cookies, logout is POST-only | `src/app.js` |
| Session theft / fixation | Random 256-bit tokens, only a SHA-256 of each is stored, `HttpOnly` + `Secure` + `__Host-` cookie in production, new session on login, destroyed on logout, other sessions revoked on password change | `src/app.js`, `src/db.js` |
| Brute force | 10 login attempts per IP per 15 minutes, global 300 requests/minute per IP, dummy hash for unknown users so timing does not reveal valid usernames | `src/app.js` |
| Bad input | Server-side length/format checks, control characters stripped, body capped at 64 KB, form content type enforced, field and URL length limits | `src/validate.js`, `src/app.js` |
| Clickjacking, MIME sniffing, etc. | CSP `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS in production | `src/security.js` |
| Path traversal | Static files are an exact whitelist (`/static/style.css`, `/favicon.svg`); no filesystem lookups from URLs | `src/app.js` |
| Information leaks | Generic login and error messages; stack traces only go to the server log | `src/app.js` |
| Privilege escalation | Role checked server-side on every request; ownership checked on every edit/delete | `src/app.js` |

## Tests

```bash
npm test
```

20 end-to-end tests make real HTTP requests against a real server (in-memory database). They cover hashing, login, sessions, CRUD, roles, user management, search, pagination, mobile markup, XSS, SQL injection, CSRF, validation, rate limiting, security headers and path traversal.

## Configuration

All optional except as noted. Set them as environment variables (see `.env.example`).

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | | Set to `production` online: enables Secure cookies and HSTS |
| `ADMIN_PASSWORD` | random, printed once | Password for the first admin (min 10 characters) |
| `EDITOR_PASSWORD` | none | With `SEED_DEMO=1`, creates an `editor` login |
| `SEED_DEMO` | `0` | `1` restores demo posts whenever the blog is empty at start-up |
| `ADMIN_USERNAME` | `admin` | First admin's username |
| `TRUST_PROXY` | `0` | Set `1` behind a hosting proxy so rate limiting sees real IPs |
| `DB_FILE` | `data/blog.db` | SQLite file location (use a persistent disk online) |
| `PORT` | `3000` | Render sets this itself |
| `PAGE_SIZE` | `6` | Posts per page |
| `SITE_NAME` | `Inkwell` | |

## Deploy to Render (free) and get a live link

1. **GitHub:** create a new **public** repository and upload the files (on the repo page: *uploading an existing file*, drag in the *contents* of this folder, then *Commit changes*). Passwords are never stored in the code, so a public repo is safe.
2. **Render:** *New → Blueprint*, pick the repo, and approve. `render.yaml` creates a free web service and **generates** two passwords for you.
3. **Get your logins:** Render dashboard → your service → **Environment**. Click the eye icon next to `ADMIN_PASSWORD` (user `admin`) and `EDITOR_PASSWORD` (user `editor`). Do not paste these anywhere public.
4. Open the `https://....onrender.com` address shown at the top of the service page.

### Test the live site

```bash
BASE_URL=https://your-app.onrender.com ADMIN_PASSWORD=... EDITOR_PASSWORD=... npm run smoke
```

Runs 38 checks against the real site (start-up, database, login, create/read/update/delete, search, pagination, admin/editor permissions, XSS/CSRF/SQL-injection) and deletes its own test posts.

### Free-tier behaviour (important)

- **Sleeps after 15 minutes without visitors** and takes about a minute to wake. Open the link once before showing it to anyone.
- **The database is wiped on every restart or redeploy**, because free services have no persistent disk. `SEED_DEMO=1` makes the app restore 19 sample posts and the `editor` account automatically, and the generated passwords stay the same, so the site is never blank. Posts and users you add yourself are lost on restart. For permanent data, use a paid plan with a disk and set `DB_FILE=/var/data/blog.db`.
- Run one instance only (rate limits and the database are per instance).

A `Dockerfile` is included for hosts that prefer containers (data lives in the `/data` volume).

## Known limits

- Rate limiting is in memory, so it resets on restart and is per instance.
- No email, so password resets are done by an admin.
- `node:sqlite` is still marked experimental by Node.js (it prints a one-line warning at startup). It is stable enough for this app; pin the Node version in production.
- Posts are plain text plus a tiny safe set of markers (`## heading`, `> quote`, `- list`, `**bold**`, `*italic*`, `[text](https://link)`). Text is escaped first, so raw HTML is never accepted and only `http(s)` links are made.
- No drafts, no image uploads and no theme toggle: drafts need a visibility model, uploads need persistent storage (Render's free disk is wiped), and a toggle needs JavaScript, which the strict Content-Security-Policy forbids. Cover art is generated from each post's id and category. Dark mode follows the visitor's system setting.
- No newsletter: there is no email provider configured.

## Inkwell design upgrade

Categories (`Security`, `Web Development`, `Internship Diary`, `Ideas`) are stored in an additive `posts.category` column. Older databases are migrated automatically at start-up: nothing is dropped or rewritten, existing posts get `Ideas` (diary posts titled `Task N: ...` get `Internship Diary`), and running it twice changes nothing.

## Project layout

```
server.js            start-up and graceful shutdown
src/app.js           routing, sessions, CSRF, roles, error handling
src/security.js      password hashing, tokens, rate limiter, security headers
src/validate.js      input validation and cleaning
src/db.js            SQLite schema and prepared statements
src/html.js          auto-escaping HTML templates
src/views.js         all pages
src/bootstrap.js     first-run admin creation
public/style.css     responsive stylesheet
scripts/seed.js      demo data (npm run seed)
scripts/smoke.js     live-site check (npm run smoke)
src/demo.js          demo posts and start-up restore
test/app.test.js     end-to-end tests
```

## Internship task map (suggested commits and demo videos)

1. **Environment setup:** `package.json`, `server.js`, folder structure, `/healthz`.
2. **Search, pagination and styling:** `?q=` search, paging, `public/style.css`.
3. **Login, CRUD and roles:** hashed-password login, create/edit/delete, admin and editor permissions.
4. **Security:** validation, escaping, CSRF, rate limiting, headers (table above).
5. **Final build and testing:** `npm test`, seed data, deployment.

## Typography and design notes

Headlines use **Playfair Display** (SIL Open Font License, see `public/fonts/OFL.txt`), self-hosted as WOFF and served from `/static/fonts/` so the strict Content-Security-Policy (`font-src 'self'`) needs no external requests. If the font fails to load, the stack falls back to Didot / Georgia. Article cover art is generated SVG (no photographs are bundled). Scroll-driven effects (reveals, shrinking header, reading progress) use CSS only and degrade to a static page in browsers without support or with reduced-motion on.
