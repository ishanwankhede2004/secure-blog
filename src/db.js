'use strict';
// Data layer on top of Node's built-in SQLite.
// SECURITY: every query is a prepared statement with bound parameters.
// User input is never concatenated into SQL, which rules out SQL injection.

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { newToken, sha256 } = require('./security');
const { escapeLike } = require('./validate');

const POST_COLUMNS = 'p.id, p.title, p.body, p.category, p.author_id, p.created_at, p.updated_at, u.username AS author';

function createStore(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('admin', 'editor')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS posts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL,
      author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
      csrf       TEXT NOT NULL,
      flash      TEXT,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
  `);

  // ---- migration: posts.category (additive only; never drops or rewrites data) ----
  // Older databases have no category column. It is added with a default so every
  // existing post keeps working, and the internship diary posts are labelled once.
  const postColumns = db.prepare('PRAGMA table_info(posts)').all().map((c) => c.name);
  if (!postColumns.includes('category')) {
    db.exec(`
      ALTER TABLE posts ADD COLUMN category TEXT NOT NULL DEFAULT 'Ideas';
      UPDATE posts SET category = 'Internship Diary' WHERE title LIKE 'Task _: %';
    `);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_posts_category ON posts (category, created_at DESC)');

  const sql = {
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userList: db.prepare('SELECT id, username, role, created_at FROM users ORDER BY username'),
    userCount: db.prepare('SELECT COUNT(*) AS n FROM users'),
    adminCount: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"),
    userInsert: db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'),
    userRole: db.prepare('UPDATE users SET role = ? WHERE id = ?'),
    userPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    userDelete: db.prepare('DELETE FROM users WHERE id = ?'),
    reassignPosts: db.prepare('UPDATE posts SET author_id = ? WHERE author_id = ?'),

    categoryCounts: db.prepare('SELECT category, COUNT(*) AS n FROM posts GROUP BY category'),
    postRelated: db.prepare(`
      SELECT p.id, p.title, p.body, p.category, p.author_id, p.created_at, p.updated_at, u.username AS author
      FROM posts p JOIN users u ON u.id = p.author_id
      WHERE p.id != ?
      ORDER BY (p.category = ?) DESC, p.created_at DESC, p.id DESC LIMIT ?`),
    postGet: db.prepare(`
      SELECT p.id, p.title, p.body, p.category, p.author_id, p.created_at, p.updated_at, u.username AS author
      FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?`),
    postInsert: db.prepare('INSERT INTO posts (title, body, category, author_id) VALUES (?, ?, ?, ?)'),
    postUpdate: db.prepare("UPDATE posts SET title = ?, body = ?, category = ?, updated_at = datetime('now') WHERE id = ?"),
    postDelete: db.prepare('DELETE FROM posts WHERE id = ?'),

    sessionInsert: db.prepare(
      'INSERT INTO sessions (token_hash, user_id, csrf, expires_at) VALUES (?, ?, ?, ?)',
    ),
    sessionGet: db.prepare(`
      SELECT s.token_hash, s.csrf, s.expires_at, s.user_id, u.username, u.role
      FROM sessions s LEFT JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`),
    sessionDelete: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    sessionDeleteUser: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    sessionDeleteOthers: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?'),
    sessionPurge: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    flashSet: db.prepare('UPDATE sessions SET flash = ? WHERE token_hash = ?'),
    flashGet: db.prepare('SELECT flash FROM sessions WHERE token_hash = ?'),
  };

  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  const likeParam = (q) => `%${escapeLike(q)}%`;

  // Listing and counting share one WHERE clause built from fixed fragments only.
  // User input always travels as a bound parameter, never inside the SQL text.
  const cache = new Map();
  function filtered(kind, hasQ, hasCategory) {
    const key = `${kind}:${hasQ}:${hasCategory}`;
    if (!cache.has(key)) {
      const where = [];
      if (hasQ) where.push("(p.title LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\')");
      if (hasCategory) where.push('p.category = ?');
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      cache.set(key, db.prepare(kind === 'count'
        ? `SELECT COUNT(*) AS n FROM posts p ${clause}`
        : `SELECT ${POST_COLUMNS}
           FROM posts p JOIN users u ON u.id = p.author_id ${clause}
           ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`));
    }
    return cache.get(key);
  }
  const filterArgs = (q, category) => {
    const args = [];
    if (q) { const like = likeParam(q); args.push(like, like); }
    if (category) args.push(category);
    return args;
  };

  return {
    db,
    close: () => db.close(),

    // ---- users ----
    getUserByUsername: (username) => sql.userByName.get(username),
    getUserById: (id) => sql.userById.get(id),
    listUsers: () => sql.userList.all(),
    countUsers: () => sql.userCount.get().n,
    countAdmins: () => sql.adminCount.get().n,
    createUser: ({ username, passwordHash, role }) =>
      Number(sql.userInsert.run(username, passwordHash, role).lastInsertRowid),
    setUserRole: (id, role) => sql.userRole.run(role, id),
    setUserPassword: (id, passwordHash) => sql.userPassword.run(passwordHash, id),
    // Deleting an author keeps their posts: they are handed to another user first.
    deleteUser: (id, reassignTo) =>
      transaction(() => {
        sql.reassignPosts.run(reassignTo, id);
        sql.userDelete.run(id);
      }),

    // ---- posts ----
    countPosts: (q, category) =>
      filtered('count', Boolean(q), Boolean(category)).get(...filterArgs(q, category)).n,
    listPosts: ({ q, category, limit, offset }) =>
      filtered('list', Boolean(q), Boolean(category)).all(...filterArgs(q, category), limit, offset),
    categoryCounts: () => Object.fromEntries(sql.categoryCounts.all().map((r) => [r.category, r.n])),
    relatedPosts: (id, category, limit = 3) => sql.postRelated.all(id, category, limit),
    getPost: (id) => sql.postGet.get(id),
    createPost: ({ title, body, category = 'Ideas', authorId }) =>
      Number(sql.postInsert.run(title, body, category, authorId).lastInsertRowid),
    updatePost: (id, { title, body, category }) => {
      const current = sql.postGet.get(id);
      return sql.postUpdate.run(title, body, category || (current && current.category) || 'Ideas', id);
    },
    deletePost: (id) => sql.postDelete.run(id),

    // ---- sessions (only a SHA-256 of the token is stored, never the token) ----
    createSession: ({ userId, ttlMs }) => {
      const token = newToken();
      const csrf = newToken();
      const tokenHash = sha256(token);
      sql.sessionInsert.run(tokenHash, userId, csrf, Date.now() + ttlMs);
      return { token, tokenHash, csrf };
    },
    getSession: (token) => sql.sessionGet.get(sha256(token), Date.now()),
    deleteSession: (tokenHash) => sql.sessionDelete.run(tokenHash),
    deleteUserSessions: (userId) => sql.sessionDeleteUser.run(userId),
    deleteOtherSessions: (userId, keepHash) => sql.sessionDeleteOthers.run(userId, keepHash),
    purgeSessions: () => sql.sessionPurge.run(Date.now()),

    setFlash: (tokenHash, flash) => sql.flashSet.run(JSON.stringify(flash), tokenHash),
    takeFlash: (tokenHash) => {
      const row = sql.flashGet.get(tokenHash);
      if (!row || !row.flash) return null;
      sql.flashSet.run(null, tokenHash);
      try {
        const f = JSON.parse(row.flash);
        return f && typeof f.text === 'string' ? f : null;
      } catch {
        return null;
      }
    },
  };
}

module.exports = { createStore };
