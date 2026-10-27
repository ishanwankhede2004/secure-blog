'use strict';
// All HTML lives here. Because every template uses the escaping html`` tag,
// user-supplied text is always rendered as text, never as markup.

const { html, raw, escapeHtml } = require('./html');
const { LIMITS, CATEGORIES, DEFAULT_CATEGORY } = require('./validate');
const { renderBody, readingMinutes, plainExcerpt } = require('./content');

const csrfField = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;

function fmtDate(sqlDate) {
  const d = new Date(`${String(sqlDate).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

const isoDay = (sqlDate) => String(sqlDate).slice(0, 10);

function fmtLong(date) {
  return date.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function fieldError(id, message) {
  return message ? html`<p class="field-error" id="${id}">${message}</p>` : '';
}

const DESCRIPTIONS = {
  'Security': 'How attacks work, and how to stop them.',
  'Web Development': 'Practical engineering notes from the workbench.',
  'Internship Diary': 'A task-by-task record of building this site.',
  'Ideas': 'Shorter essays and open questions.',
};

const catHref = (c) => `/?category=${encodeURIComponent(c)}#latest`;

// The wordmark is pure typography: spaced capitals with a small gold diamond.
const wordmark = (siteName) => {
  const name = siteName.toUpperCase();
  const mid = name === 'INKWELL' ? 3 : Math.ceil(name.length / 2);
  return html`<span class="wm">${name.slice(0, mid)}<i class="wm-dot" aria-hidden="true"></i>${name.slice(mid)}</span>`;
};

// ---------------------------------------------------------------- layout --

function searchForm({ q, category, id = 'q', label = 'Search the archive' }) {
  return html`
    <form class="search" role="search" method="get" action="/#latest">
      <label class="sr-only" for="${id}">Search articles</label>
      <input id="${id}" name="q" type="search" value="${q}" maxlength="${LIMITS.searchMax}"
             placeholder="${label}" autocomplete="off">
      ${category ? html`<input type="hidden" name="category" value="${category}">` : ''}
      <button type="submit" aria-label="Search"><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="8.5" cy="8.5" r="5.8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M13 13l4.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
    </form>`;
}

function layout({ siteName, user, csrf, flash, title, description, ogType, main, progress, current }) {
  const flashHtml = flash
    ? html`<div class="flash ${flash.type === 'error' ? 'flash-error' : 'flash-ok'}" role="status">${flash.text}</div>`
    : '';

  const cur = (name) => (current === name ? raw('aria-current="page"') : '');

  const left = html`
    <li><a href="/" ${cur('articles')}>Articles</a></li>
    <li><a href="/about" ${cur('about')}>About</a></li>`;

  const logout = html`
    <li>
      <form method="post" action="/logout" class="inline">
        ${csrfField(csrf)}
        <button type="submit" class="linklike">Log out</button>
      </form>
    </li>`;

  const right = user
    ? html`
        <li><a href="/posts/new" ${cur('write')}>Write</a></li>
        ${user.role === 'admin' ? html`<li><a href="/admin/users" ${cur('users')}>Users</a></li>` : ''}
        <li><a href="/account">${user.username}</a> <span class="badge">${user.role}</span></li>
        ${logout}`
    : html`<li><a href="/login">Log in</a></li>`;

  const pageTitle = title ? `${title} · ${siteName}` : `${siteName}: notes on building software that stays secure`;
  const desc = description || `${siteName} is an independent publication about secure web development, written and edited by its own contributors.`;

  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#f6f1e7" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0f0e0b" media="(prefers-color-scheme: dark)">
  <title>${pageTitle}</title>
  <meta name="description" content="${desc}">
  <meta property="og:site_name" content="${siteName}">
  <meta property="og:type" content="${ogType || 'website'}">
  <meta property="og:title" content="${title || siteName}">
  <meta property="og:description" content="${desc}">
  <meta name="twitter:card" content="summary">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/static/style.css">
</head>
<body id="top">
  <a class="skip" href="#main">Skip to content</a>
  ${progress ? html`<div class="read-progress" aria-hidden="true"></div>` : ''}
  <div class="dateline"><p>${fmtLong(new Date())}</p><p>An independent publication</p></div>
  <header class="site-header">
    <div class="bar">
      <details class="menu">
        <summary aria-label="Menu"><span class="menu-icon" aria-hidden="true"></span><span class="menu-label">Menu</span></summary>
        <div class="menu-panel">
          ${searchForm({ q: '', category: '', id: 'q-menu', label: 'Search articles' })}
          <nav aria-label="Menu">
            <ul>${left}${right}</ul>
          </nav>
        </div>
      </details>
      <nav class="nav-left" aria-label="Main"><ul>${left}</ul></nav>
      <a class="brand" href="/" aria-label="${siteName} home">${wordmark(siteName)}</a>
      <nav class="nav-right" aria-label="Account"><ul>${right}</ul></nav>
      <a class="bar-cta" href="${user ? '/posts/new' : '/login'}">${user ? 'Write' : 'Log in'}</a>
    </div>
  </header>
  <main id="main">
    ${flashHtml}
    ${main}
  </main>
  <footer class="site-footer">
    <div class="footer-inner">
      <a class="footer-mark" href="/" aria-label="${siteName} home">${wordmark(siteName)}</a>
      <p class="footer-tag">An independent publication on building software that stays secure.</p>
      <div class="footer-grid">
        <nav aria-label="Topics">
          <h2>Topics</h2>
          <ul>${CATEGORIES.map((c) => html`<li><a href="${catHref(c)}">${c}</a></li>`)}</ul>
        </nav>
        <nav aria-label="Footer">
          <h2>${siteName}</h2>
          <ul>
            <li><a href="/">All articles</a></li>
            <li><a href="/about">About</a></li>
            <li><a href="/about#colophon">Colophon</a></li>
          </ul>
        </nav>
        <nav aria-label="Contributors">
          <h2>Contributors</h2>
          <ul>
            <li><a href="${user ? '/posts/new' : '/login'}">${user ? 'Write an article' : 'Log in'}</a></li>
            ${user ? html`<li><a href="/account">Your account</a></li>` : ''}
          </ul>
        </nav>
      </div>
      <div class="legal">
        <p>© ${new Date().getUTCFullYear()} ${siteName}. All rights reserved.</p>
        <p><a href="#top">Back to top ↑</a></p>
      </div>
    </div>
  </footer>
</body>
</html>`;
}

// ----------------------------------------------------------------- home --

const cover = (p, eager = false) => html`
  <img src="/covers/${p.id}.svg" alt="" width="1000" height="1000"
       ${eager ? raw('loading="eager" fetchpriority="high"') : raw('loading="lazy"')} decoding="async">`;

const metaLine = (p) => html`
  <p class="meta">
    <span>${p.author}</span>
    <time datetime="${isoDay(p.created_at)}">${fmtDate(p.created_at)}</time>
    <span>${readingMinutes(p.body)} min read</span>
  </p>`;

// One story, several shapes: lead, side, tall (portrait) and wide.
function story(p, variant) {
  const lengths = { lead: 210, tall: 130, wide: 150 };
  return html`
    <article class="story story-${variant}">
      <a class="story-media" href="/posts/${p.id}" tabindex="-1" aria-hidden="true">${cover(p)}</a>
      <div class="story-text">
        <p class="eyebrow"><a href="${catHref(p.category)}">${p.category}</a></p>
        <h3 class="story-title"><a href="/posts/${p.id}">${p.title}</a></h3>
        ${lengths[variant] ? html`<p class="excerpt">${plainExcerpt(p.body, lengths[variant])}</p>` : ''}
        ${metaLine(p)}
      </div>
    </article>`;
}

// An asymmetric arrangement: one large story, a stack of two beside it, then a row
// of portrait stories. Not every card is the same shape.
function editorial(posts) {
  if (!posts.length) return '';
  const [lead, ...rest] = posts;
  const stack = rest.slice(0, 2);
  const grid = rest.slice(2);
  const shape = (i) => (grid.length === 2 ? (i === 0 ? 'tall' : 'wide') : grid.length === 1 ? 'wide' : 'tall');
  return html`
    <div class="editorial">
      <div class="ed-top ${stack.length ? '' : 'solo'}">
        ${story(lead, 'lead')}
        ${stack.length ? html`<div class="ed-stack">${stack.map((p) => story(p, 'side'))}</div>` : ''}
      </div>
      ${grid.length ? html`<div class="ed-grid n${Math.min(grid.length, 3)}">${grid.map((p, i) => story(p, shape(i)))}</div>` : ''}
    </div>`;
}

function heroFeature(p, siteName) {
  return html`
    <section class="hero" aria-label="Introduction and featured story">
      <div class="hero-text">
        <p class="kicker">The latest edition</p>
        <h1>Notes on building software that <em>stays secure.</em></h1>
        <p class="lead">${siteName} publishes clear, practical writing on web security, engineering and the craft of learning to build.</p>
        <p class="hero-actions">
          <a class="button" href="#latest">Explore articles</a>
          <a class="text-link" href="/about">About ${siteName}</a>
        </p>
      </div>
      ${p ? html`
        <article class="hero-feature">
          <div class="hero-frame"><a class="hero-media" href="/posts/${p.id}" tabindex="-1" aria-hidden="true">${cover(p, true)}</a></div>
          <div class="hero-caption">
            <p class="eyebrow">Featured story · <a href="${catHref(p.category)}">${p.category}</a></p>
            <h2><a href="/posts/${p.id}">${p.title}</a></h2>
            ${metaLine(p)}
          </div>
        </article>` : ''}
    </section>`;
}

function pageHref(q, category, n) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (category) params.set('category', category);
  params.set('page', String(n));
  return `/?${params.toString()}#latest`;
}

function pagination({ page, pages, q, category }) {
  if (pages <= 1) return '';
  const nums = [];
  let last = 0;
  for (let n = 1; n <= pages; n += 1) {
    if (n === 1 || n === pages || Math.abs(n - page) <= 1) {
      if (last && n - last > 1) nums.push(html`<li class="gap" aria-hidden="true">…</li>`);
      nums.push(
        n === page
          ? html`<li><span class="current" aria-current="page">${n}</span></li>`
          : html`<li><a href="${pageHref(q, category, n)}" aria-label="Page ${n}">${n}</a></li>`,
      );
      last = n;
    }
  }
  return html`
    <nav class="pagination" aria-label="Pagination">
      ${page > 1
        ? html`<a class="step" rel="prev" href="${pageHref(q, category, page - 1)}">← Previous</a>`
        : html`<span class="step disabled">← Previous</span>`}
      <ul class="nums">${nums}</ul>
      <span class="status">Page ${page} of ${pages}</span>
      ${page < pages
        ? html`<a class="step" rel="next" href="${pageHref(q, category, page + 1)}">Next →</a>`
        : html`<span class="step disabled">Next →</span>`}
    </nav>`;
}

function topicTabs({ counts, category }) {
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  return html`
    <nav class="topics" aria-label="Filter by topic">
      <a href="/#latest" ${!category ? raw('aria-current="page"') : ''}>All <span>${all}</span></a>
      ${CATEGORIES.map((c) => html`
        <a href="${catHref(c)}" ${category === c ? raw('aria-current="page"') : ''}>${c} <span>${counts[c] || 0}</span></a>`)}
    </nav>`;
}

// The "desks": a typographic index of the publication's topics.
function topicIndex({ counts }) {
  return html`
    <section class="desks" id="topics" aria-labelledby="desks-title">
      <header class="section-head">
        <h2 id="desks-title">Browse by <em>topic</em></h2>
      </header>
      <ol>
        ${CATEGORIES.map((c, i) => html`
          <li>
            <a href="${catHref(c)}">
              <span class="desk-no">${String(i + 1).padStart(2, '0')}</span>
              <span class="desk-name">${c}</span>
              <span class="desk-desc">${DESCRIPTIONS[c]}</span>
              <span class="desk-count">${counts[c] || 0} ${(counts[c] || 0) === 1 ? 'article' : 'articles'} <span aria-hidden="true">→</span></span>
            </a>
          </li>`)}
      </ol>
    </section>`;
}

function home({ posts, q, category, page, pages, total, counts, siteName }) {
  const filtering = Boolean(q || category);
  const lead = !filtering && page === 1 && posts.length ? posts[0] : null;
  const rest = lead ? posts.slice(1) : posts;
  const noun = total === 1 ? 'article' : 'articles';
  const what = [category ? `in ${category}` : '', q ? `matching “${q}”` : ''].filter(Boolean).join(' ');
  const summary = filtering
    ? html`${total} ${noun} ${what} · <a href="/#latest">Clear filters</a>`
    : html`${total} ${noun}`;

  return html`
    ${filtering ? '' : heroFeature(lead, siteName)}
    <section id="latest" class="latest" aria-labelledby="latest-title">
      <header class="section-head">
        <h2 id="latest-title">${filtering ? (q ? html`Search <em>results</em>` : category) : html`Latest <em>stories</em>`}</h2>
        ${searchForm({ q, category })}
      </header>
      ${topicTabs({ counts, category })}
      <p class="muted count" aria-live="polite">${summary}</p>
      ${rest.length
        ? editorial(rest)
        : (lead ? '' : html`
            <div class="empty">
              <p>${filtering ? 'No articles match that search.' : 'No articles have been published yet.'}</p>
              ${filtering ? html`<p><a class="button secondary" href="/#latest">Show all articles</a></p>` : ''}
            </div>`)}
      ${pagination({ page, pages, q, category })}
    </section>
    ${filtering ? '' : topicIndex({ counts })}`;
}

// ------------------------------------------------------------ post pages --

function articleBody({ post, author, createdAt, updatedAt, preview = false }) {
  const { html: bodyHtml, toc } = renderBody(post.body);
  const edited = !preview && updatedAt && updatedAt !== createdAt;
  const showToc = toc.length >= 3;
  return html`
    <article class="article">
      <header class="article-head">
        <p class="eyebrow eyebrow-rule">${preview ? html`${post.category}` : html`<a href="${catHref(post.category)}">${post.category}</a>`}</p>
        <h1>${post.title}</h1>
        <p class="standfirst">${plainExcerpt(post.body, 190)}</p>
        <p class="byline">
          <span>By <strong>${author}</strong></span>
          <time datetime="${isoDay(createdAt)}">${fmtDate(createdAt)}</time>
          <span>${readingMinutes(post.body)} min read</span>
          ${edited ? html`<span>Updated ${fmtDate(updatedAt)}</span>` : ''}
        </p>
      </header>
      ${preview ? '' : html`<figure class="article-cover">${cover(post, true)}</figure>`}
      <div class="article-grid ${showToc ? 'has-toc' : ''}">
        ${showToc ? html`
          <nav class="toc" aria-label="In this article">
            <h2>In this article</h2>
            <ol>${toc.map((t) => html`<li><a href="#${t.id}">${t.text}</a></li>`)}</ol>
          </nav>` : ''}
        <div class="prose">${bodyHtml}</div>
      </div>
      <p class="end-mark" aria-hidden="true"><i></i></p>
    </article>`;
}

function postPage({ post, canModify, related = [] }) {
  return html`
    ${articleBody({ post, author: post.author, createdAt: post.created_at, updatedAt: post.updated_at })}
    <p class="actions article-actions">
      <a class="button secondary" href="/">← All articles</a>
      ${canModify ? html`
        <a class="button" href="/posts/${post.id}/edit">Edit</a>
        <a class="button danger" href="/posts/${post.id}/delete">Delete</a>` : ''}
    </p>
    ${related.length ? html`
      <section class="related" aria-labelledby="related-title">
        <header class="section-head"><h2 id="related-title">Continue <em>reading</em></h2></header>
        <div class="ed-grid n${related.length}">${related.map((p) => story(p, 'tall'))}</div>
      </section>` : ''}`;
}

function postForm({ mode, post, values, errors = {}, csrf }) {
  const editing = mode === 'edit';
  const action = editing ? `/posts/${post.id}` : '/posts';
  return html`
    <section class="editor">
      <div class="page-head">
        <p class="eyebrow">${editing ? 'Editing' : 'New article'}</p>
        <h1>${editing ? 'Edit the article' : 'Write an article'}</h1>
      </div>
      ${errors && Object.keys(errors).length ? html`
        <div class="flash flash-error" role="alert">Please fix the highlighted fields and try again.</div>` : ''}
      <form method="post" action="${action}" class="stack" novalidate>
        ${csrfField(csrf)}
        ${editing ? html`<input type="hidden" name="post_id" value="${post.id}">` : ''}
        <div class="field">
          <label for="title">Title</label>
          <input id="title" name="title" type="text" required maxlength="${LIMITS.titleMax}"
                 value="${values.title}" aria-describedby="title-error" ${errors.title ? raw('aria-invalid="true"') : ''}>
          ${fieldError('title-error', errors.title)}
        </div>
        <div class="field">
          <label for="category">Category</label>
          <select id="category" name="category" aria-describedby="category-error">
            ${CATEGORIES.map((c) => html`<option value="${c}" ${(values.category || DEFAULT_CATEGORY) === c ? raw('selected') : ''}>${c}</option>`)}
          </select>
          ${fieldError('category-error', errors.category)}
        </div>
        <div class="field">
          <label for="body">Article</label>
          <textarea id="body" name="body" rows="16" required maxlength="${LIMITS.bodyMax}"
                    aria-describedby="body-hint body-error" ${errors.body ? raw('aria-invalid="true"') : ''}>${values.body}</textarea>
          <p class="hint" id="body-hint">Leave a blank line between paragraphs. Optional formatting:
            <code>## Heading</code>, <code>&gt; quotation</code>, <code>- list item</code>,
            <code>**bold**</code>, <code>*italic*</code>, <code>[text](https://link)</code>.</p>
          ${fieldError('body-error', errors.body)}
        </div>
        <p class="actions">
          <button type="submit" formaction="/posts/preview" class="secondary">Preview</button>
          <button type="submit">${editing ? 'Save changes' : 'Publish'}</button>
          <a class="button secondary" href="${editing ? `/posts/${post.id}` : '/'}">Cancel</a>
        </p>
      </form>
    </section>`;
}

function previewPage({ mode, post, values, user, csrf }) {
  const editing = mode === 'edit';
  return html`
    <div class="preview-banner" role="status">Preview only. Nothing has been published yet.</div>
    ${articleBody({
      post: { title: values.title, body: values.body, category: values.category },
      author: user.username,
      createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      preview: true,
    })}
    <form method="post" action="${editing ? `/posts/${post.id}` : '/posts'}" class="actions article-actions">
      ${csrfField(csrf)}
      ${editing ? html`<input type="hidden" name="post_id" value="${post.id}">` : ''}
      <input type="hidden" name="title" value="${values.title}">
      <input type="hidden" name="category" value="${values.category}">
      <input type="hidden" name="body" value="${values.body}">
      <button type="submit">${editing ? 'Save changes' : 'Publish'}</button>
      <button type="submit" class="secondary" formaction="/posts/preview" name="_action" value="edit">Keep editing</button>
    </form>`;
}

function about({ siteName }) {
  return html`
    <article class="article about">
      <header class="article-head">
        <p class="eyebrow eyebrow-rule">About</p>
        <h1>A small publication with a careful eye for <em>detail.</em></h1>
        <p class="standfirst">${siteName} is an independent publication about building software that stays secure. We favour plain language, working examples and honest accounts of what went wrong as well as what went right.</p>
      </header>
      <div class="article-grid">
        <div class="prose">
          <h2>What you will find here</h2>
          <p>Four desks, each with its own voice. Browse them below, or read everything in the order it was written.</p>
          <blockquote><p>Treat every input as hostile, and every user as someone you want to keep.</p></blockquote>
          <h2 id="colophon">Colophon</h2>
          <p>The site is written by Ishan Wankhede as a web development internship project. Passwords are stored only as salted hashes, every form is protected against forgery, all text is escaped before it is shown, and permissions are checked on the server for every request. Contributors have either an editor role (write and manage their own articles) or an admin role (manage all articles and users).</p>
          <p>Headlines are set in Playfair Display, used under the SIL Open Font License. Cover art is generated for each article.</p>
          <h2>Write for ${siteName}</h2>
          <p>Contributor accounts are created by an administrator. If you have one, <a href="/login">log in</a> to start writing.</p>
        </div>
      </div>
      <p class="end-mark" aria-hidden="true"><i></i></p>
      <p class="actions article-actions"><a class="button" href="/#latest">Explore articles</a></p>
    </article>
    <section class="desks about-desks" aria-label="The four desks">
      <ol>
        ${CATEGORIES.map((c, i) => html`
          <li>
            <a href="${catHref(c)}">
              <span class="desk-no">${String(i + 1).padStart(2, '0')}</span>
              <span class="desk-name">${c}</span>
              <span class="desk-desc">${DESCRIPTIONS[c]}</span>
              <span class="desk-count">Read the desk <span aria-hidden="true">→</span></span>
            </a>
          </li>`)}
      </ol>
    </section>`;
}

function confirmDelete({ heading, detail, action, cancelHref, csrf }) {
  return html`
    <section class="narrow">
      <p class="eyebrow">Please confirm</p>
      <h1>${heading}</h1>
      <p class="lead-sm">${detail}</p>
      <form method="post" action="${action}" class="actions">
        ${csrfField(csrf)}
        <button type="submit" class="danger">Yes, delete</button>
        <a class="button secondary" href="${cancelHref}">Cancel</a>
      </form>
    </section>`;
}

// ------------------------------------------------------------------ auth --

function login({ csrf, error, username = '' }) {
  return html`
    <section class="narrow">
      <p class="eyebrow">Contributors</p>
      <h1>Log in</h1>
      ${error ? html`<div class="flash flash-error" role="alert">${error}</div>` : ''}
      <form method="post" action="/login" class="stack">
        ${csrfField(csrf)}
        <div class="field">
          <label for="username">Username</label>
          <input id="username" name="username" type="text" required maxlength="64"
                 autocomplete="username" autocapitalize="none" spellcheck="false" value="${username}">
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" required maxlength="${LIMITS.passwordMax}"
                 autocomplete="current-password">
        </div>
        <p class="actions"><button type="submit">Log in</button></p>
      </form>
    </section>`;
}

function account({ user, csrf, errors = {} }) {
  return html`
    <section class="narrow">
      <p class="eyebrow">Account</p>
      <h1>Your account</h1>
      <p class="muted">Signed in as <strong>${user.username}</strong> <span class="badge">${user.role}</span></p>
      <h2>Change password</h2>
      <form method="post" action="/account/password" class="stack">
        ${csrfField(csrf)}
        <div class="field">
          <label for="current">Current password</label>
          <input id="current" name="current" type="password" required autocomplete="current-password" maxlength="${LIMITS.passwordMax}">
          ${fieldError('current-error', errors.current)}
        </div>
        <div class="field">
          <label for="password">New password</label>
          <input id="password" name="password" type="password" required autocomplete="new-password" maxlength="${LIMITS.passwordMax}">
          <p class="hint">At least ${LIMITS.passwordMin} characters.</p>
          ${fieldError('password-error', errors.password)}
        </div>
        <div class="field">
          <label for="confirm">Confirm new password</label>
          <input id="confirm" name="confirm" type="password" required autocomplete="new-password" maxlength="${LIMITS.passwordMax}">
          ${fieldError('confirm-error', errors.confirm)}
        </div>
        <p class="actions"><button type="submit">Update password</button></p>
      </form>
      <p class="hint">Changing your password signs you out everywhere else.</p>
    </section>`;
}

// ----------------------------------------------------------------- admin --

function adminUsers({ users, me, csrf, errors = {}, values = {} }) {
  return html`
    <div class="page-head">
      <p class="eyebrow">Administration</p>
      <h1>Users</h1>
    </div>
    <section class="panel">
      <h2>Add a user</h2>
      <form method="post" action="/admin/users" class="stack">
        ${csrfField(csrf)}
        <div class="field">
          <label for="new-username">Username</label>
          <input id="new-username" name="username" type="text" required maxlength="${LIMITS.usernameMax}"
                 autocapitalize="none" spellcheck="false" value="${values.username || ''}">
          ${fieldError('new-username-error', errors.username)}
        </div>
        <div class="field">
          <label for="new-password">Temporary password</label>
          <input id="new-password" name="password" type="password" required autocomplete="new-password" maxlength="${LIMITS.passwordMax}">
          <p class="hint">At least ${LIMITS.passwordMin} characters. They can change it on their account page.</p>
          ${fieldError('new-password-error', errors.password)}
        </div>
        <div class="field">
          <label for="new-role">Role</label>
          <select id="new-role" name="role">
            <option value="editor" ${values.role !== 'admin' ? raw('selected') : ''}>Editor: can write and manage their own posts</option>
            <option value="admin" ${values.role === 'admin' ? raw('selected') : ''}>Admin: can manage all posts and users</option>
          </select>
          ${fieldError('new-role-error', errors.role)}
        </div>
        <p class="actions"><button type="submit">Create user</button></p>
      </form>
    </section>

    <ul class="users">
      ${users.map((u) => html`
        <li class="user">
          <div class="user-head">
            <strong>${u.username}</strong>
            <span class="badge">${u.role}</span>
            ${u.id === me.id ? html`<span class="muted">(you)</span>` : ''}
            <span class="muted">joined ${fmtDate(u.created_at)}</span>
          </div>
          ${u.id === me.id ? '' : html`
            <div class="user-actions">
              <form method="post" action="/admin/users/${u.id}/role" class="inline-form">
                ${csrfField(csrf)}
                <label class="sr-only" for="role-${u.id}">Role for ${u.username}</label>
                <select id="role-${u.id}" name="role">
                  <option value="editor" ${u.role === 'editor' ? raw('selected') : ''}>editor</option>
                  <option value="admin" ${u.role === 'admin' ? raw('selected') : ''}>admin</option>
                </select>
                <button type="submit" class="secondary">Set role</button>
              </form>
              <details>
                <summary>Reset password</summary>
                <form method="post" action="/admin/users/${u.id}/password" class="inline-form">
                  ${csrfField(csrf)}
                  <label class="sr-only" for="pw-${u.id}">New password for ${u.username}</label>
                  <input id="pw-${u.id}" name="password" type="password" required autocomplete="new-password" maxlength="${LIMITS.passwordMax}" placeholder="New password">
                  <button type="submit" class="secondary">Reset</button>
                </form>
              </details>
              <a class="button danger small" href="/admin/users/${u.id}/delete">Delete</a>
            </div>`}
        </li>`)}
    </ul>`;
}

// ---------------------------------------------------------------- errors --

function errorPage({ status, message }) {
  return html`
    <section class="error">
      <p class="error-code" aria-hidden="true">${status}</p>
      <p class="eyebrow eyebrow-rule">${status === 404 ? 'Not found' : 'Something went wrong'}</p>
      <h1>${message}</h1>
      <p class="muted">${status === 404 ? 'The page may have moved, or the address may be mistyped.' : 'Please try again in a moment.'}</p>
      ${status === 404 ? searchForm({ q: '', category: '', id: 'q-404', label: 'Search the archive' }) : ''}
      <p class="actions"><a class="button" href="/">Back to the front page</a></p>
    </section>`;
}

module.exports = {
  layout, home, postPage, postForm, previewPage, about, confirmDelete, login, account, adminUsers, errorPage,
};
