'use strict';
// All HTML lives here. Because every template uses the escaping html`` tag,
// user-supplied text is always rendered as text, never as markup.

const { html, raw, escapeHtml } = require('./html');
const { LIMITS } = require('./validate');

const csrfField = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;

function fmtDate(sqlDate) {
  const d = new Date(`${String(sqlDate).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

const isoDay = (sqlDate) => String(sqlDate).slice(0, 10);

function excerpt(body, max = 180) {
  const text = body.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

// Plain text -> paragraphs. Escaped first, so it cannot inject markup.
function paragraphs(body) {
  return raw(
    body
      .split(/\n{2,}/)
      .map((p) => `<p>${p.split('\n').map(escapeHtml).join('<br>')}</p>`)
      .join('\n'),
  );
}

function fieldError(id, message) {
  return message ? html`<p class="field-error" id="${id}">${message}</p>` : '';
}

// ---------------------------------------------------------------- layout --

function layout({ siteName, user, csrf, flash, title, main }) {
  const flashHtml = flash
    ? html`<div class="flash ${flash.type === 'error' ? 'flash-error' : 'flash-ok'}" role="status">${flash.text}</div>`
    : '';

  const account = user
    ? html`
        <li><a href="/account">${user.username}</a> <span class="badge">${user.role}</span></li>
        <li>
          <form method="post" action="/logout" class="inline">
            ${csrfField(csrf)}
            <button type="submit" class="linklike">Log out</button>
          </form>
        </li>`
    : html`<li><a href="/login">Log in</a></li>`;

  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${title ? `${title} · ` : ''}${siteName}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/static/style.css">
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="bar">
      <a class="brand" href="/">${siteName}</a>
      <nav aria-label="Main">
        <ul>
          <li><a href="/">Posts</a></li>
          ${user ? html`<li><a href="/posts/new">Write</a></li>` : ''}
          ${user && user.role === 'admin' ? html`<li><a href="/admin/users">Users</a></li>` : ''}
          ${account}
        </ul>
      </nav>
    </div>
  </header>
  <main id="main">
    ${flashHtml}
    ${main}
  </main>
  <footer class="site-footer">
    <p>${siteName} · a small, secure blog.</p>
  </footer>
</body>
</html>`;
}

// ----------------------------------------------------------------- home --

function card(p) {
  return html`
    <li class="card">
      <article>
        <h2><a href="/posts/${p.id}">${p.title}</a></h2>
        <p class="meta">By ${p.author} · <time datetime="${isoDay(p.created_at)}">${fmtDate(p.created_at)}</time></p>
        <p>${excerpt(p.body)}</p>
        <a class="more" href="/posts/${p.id}" aria-label="Read ${p.title}">Read more →</a>
      </article>
    </li>`;
}

function pageHref(q, n) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  params.set('page', String(n));
  return `/?${params.toString()}`;
}

function pagination({ page, pages, q }) {
  if (pages <= 1) return '';
  const nums = [];
  let last = 0;
  for (let n = 1; n <= pages; n += 1) {
    if (n === 1 || n === pages || Math.abs(n - page) <= 1) {
      if (last && n - last > 1) nums.push(html`<li class="gap" aria-hidden="true">…</li>`);
      nums.push(
        n === page
          ? html`<li><span class="current" aria-current="page">${n}</span></li>`
          : html`<li><a href="${pageHref(q, n)}" aria-label="Page ${n}">${n}</a></li>`,
      );
      last = n;
    }
  }
  return html`
    <nav class="pagination" aria-label="Pagination">
      ${page > 1
        ? html`<a class="step" rel="prev" href="${pageHref(q, page - 1)}">← Previous</a>`
        : html`<span class="step disabled">← Previous</span>`}
      <ul class="nums">${nums}</ul>
      <span class="status">Page ${page} of ${pages}</span>
      ${page < pages
        ? html`<a class="step" rel="next" href="${pageHref(q, page + 1)}">Next →</a>`
        : html`<span class="step disabled">Next →</span>`}
    </nav>`;
}

function home({ posts, q, page, pages, total }) {
  const noun = total === 1 ? 'post' : 'posts';
  const summary = q
    ? html`${total} ${noun} matching “${q}” · <a href="/">Clear search</a>`
    : html`${total} ${noun}`;

  return html`
    <section class="hero">
      <h1>${q ? 'Search results' : 'Latest posts'}</h1>
      <form class="search" role="search" method="get" action="/">
        <label class="sr-only" for="q">Search posts</label>
        <input id="q" name="q" type="search" value="${q}" maxlength="${LIMITS.searchMax}"
               placeholder="Search titles and text…" autocomplete="off">
        <button type="submit">Search</button>
      </form>
      <p class="muted" aria-live="polite">${summary}</p>
    </section>
    ${posts.length
      ? html`<ul class="posts">${posts.map(card)}</ul>`
      : html`<p class="empty">${q ? 'No posts match your search.' : 'No posts yet.'}</p>`}
    ${pagination({ page, pages, q })}`;
}

// ------------------------------------------------------------ post pages --

function postPage({ post, canModify }) {
  const edited = post.updated_at !== post.created_at;
  return html`
    <article class="post">
      <h1>${post.title}</h1>
      <p class="meta">By ${post.author} · <time datetime="${isoDay(post.created_at)}">${fmtDate(post.created_at)}</time>${
        edited ? html` · updated ${fmtDate(post.updated_at)}` : ''}</p>
      <div class="post-body">${paragraphs(post.body)}</div>
      <p class="actions">
        <a class="button secondary" href="/">← All posts</a>
        ${canModify ? html`
          <a class="button" href="/posts/${post.id}/edit">Edit</a>
          <a class="button danger" href="/posts/${post.id}/delete">Delete</a>` : ''}
      </p>
    </article>`;
}

function postForm({ mode, post, values, errors = {}, csrf }) {
  const editing = mode === 'edit';
  const action = editing ? `/posts/${post.id}` : '/posts';
  return html`
    <h1>${editing ? 'Edit post' : 'New post'}</h1>
    <form method="post" action="${action}" class="stack" novalidate>
      ${csrfField(csrf)}
      <div class="field">
        <label for="title">Title</label>
        <input id="title" name="title" type="text" required maxlength="${LIMITS.titleMax}"
               value="${values.title}" aria-describedby="title-error" ${errors.title ? raw('aria-invalid="true"') : ''}>
        ${fieldError('title-error', errors.title)}
      </div>
      <div class="field">
        <label for="body">Body</label>
        <textarea id="body" name="body" rows="14" required maxlength="${LIMITS.bodyMax}"
                  aria-describedby="body-error" ${errors.body ? raw('aria-invalid="true"') : ''}>${values.body}</textarea>
        <p class="hint">Plain text. Leave a blank line between paragraphs.</p>
        ${fieldError('body-error', errors.body)}
      </div>
      <p class="actions">
        <button type="submit">${editing ? 'Save changes' : 'Publish'}</button>
        <a class="button secondary" href="${editing ? `/posts/${post.id}` : '/'}">Cancel</a>
      </p>
    </form>`;
}

function confirmDelete({ heading, detail, action, cancelHref, csrf }) {
  return html`
    <section class="narrow">
      <h1>${heading}</h1>
      <p>${detail}</p>
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
    <h1>Users</h1>
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
    <section class="narrow">
      <p class="error-code">${status}</p>
      <h1>${message}</h1>
      <p><a class="button" href="/">Back to the blog</a></p>
    </section>`;
}

module.exports = {
  layout, home, postPage, postForm, confirmDelete, login, account, adminUsers, errorPage,
};
