'use strict';
// Data layer on top of Node's built-in SQLite.
// SECURITY: every query is a prepared statement with bound parameters.
// User input is never concatenated into SQL, which rules out SQL injection.

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { newToken, sha256 } = require('./security');
const { escapeLike } = require('./validate');

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

    postCount: db.prepare('SELECT COUNT(*) AS n FROM posts'),
    postCountSearch: db.prepare(
      "SELECT COUNT(*) AS n FROM posts WHERE title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\'",
    ),
    postList: db.prepare(`
      SELECT p.id, p.title, p.body, p.author_id, p.created_at, p.updated_at, u.username AS author
      FROM posts p JOIN users u ON u.id = p.author_id
      ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`),
    postSearch: db.prepare(`
      SELECT p.id, p.title, p.body, p.author_id, p.created_at, p.updated_at, u.username AS author
      FROM posts p JOIN users u ON u.id = p.author_id
      WHERE p.title LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\'
      ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`),
    postGet: db.prepare(`
      SELECT p.id, p.title, p.body, p.author_id, p.created_at, p.updated_at, u.username AS author
      FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?`),
    postInsert: db.prepare('INSERT INTO posts (title, body, author_id) VALUES (?, ?, ?)'),
    postUpdate: db.prepare("UPDATE posts SET title = ?, body = ?, updated_at = datetime('now') WHERE id = ?"),
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
    countPosts: (q) => {
      if (!q) return sql.postCount.get().n;
      const like = likeParam(q);
      return sql.postCountSearch.get(like, like).n;
    },
    listPosts: ({ q, limit, offset }) => {
      if (!q) return sql.postList.all(limit, offset);
      const like = likeParam(q);
      return sql.postSearch.all(like, like, limit, offset);
    },
    getPost: (id) => sql.postGet.get(id),
    createPost: ({ title, body, authorId }) =>
      Number(sql.postInsert.run(title, body, authorId).lastInsertRowid),
    updatePost: (id, { title, body }) => sql.postUpdate.run(title, body, id),
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
